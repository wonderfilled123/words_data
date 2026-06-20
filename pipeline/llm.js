const axios = require('axios');

const SYSTEM_PROMPT = `
You are an expert English-to-Chinese translator and curriculum designer.
Analyze the provided English news article and generate a structured JSON object for English learners, strictly following the schema described below.

Your output must be a single, raw, valid JSON object. DO NOT wrap the output in markdown block like \`\`\`json or add any explanation.

JSON Schema structure:
{
  "title": "Clean English Title of the Article",
  "title_zh": "中文翻译的文章标题",
  "level": "⭐⭐ 入门" | "⭐⭐ 中级" | "⭐⭐⭐ 高级",
  "time": "X 分钟阅读",
  "paragraphs": [
    {
      "p_id": 1,
      "sentences": [
        {
          "s_id": "1-1",
          "en": "English sentence.",
          "zh": "该句子的中文翻译。",
          "grammar": "【语法要点】简短分析该句子的核心语法，若该句极为简单，此字段为空字符串 \"\"。",
          "words": [
            {
              "word": "difficult_word",
              "meaning": "词性. 中文释义",
              "phonetic": "/ipa_phonetic_of_the_word/"
            }
          ]
        }
      ]
    }
  ],
  "active_recall": {
    "mc_quiz": {
      "question": "A multiple-choice question in English testing global comprehension of the article.",
      "options": [
        "A. First choice",
        "B. Second choice",
        "C. Third choice",
        "D. Fourth choice"
      ],
      "answer": 0, // 0-based index of the correct option (0, 1, 2, or 3)
      "hint": "提示：引导用户在文章中寻找关键线索的中文提示文案。"
    },
    "translation_task": {
      "en": "Select ONE signature complex sentence from the article for the user to translate.",
      "zh": "该核心句子的官方中文参考翻译。",
      "valuable_point": "考察了该长难句中的核心翻译技巧或特殊结构。"
    }
  }
}

Strict requirements:
1. "paragraphs" must contain 2 to 3 paragraphs. Each paragraph should have 2 to 4 sentences. Make sure to split sentences properly and tag them as "1-1", "1-2", "2-1", etc.
2. Select 3-6 core/difficult vocabulary words across the whole article, and extract them under their respective sentences. Do not populate too many words. Give each word a clean phonetic spelling in standard IPA and brief translation.
3. The "translation_task.en" sentence MUST be chosen from one of the sentences in the paragraphs above.
4. Ensure the output is valid JSON, escaping double quotes properly.
`;

async function parseArticleWithLLM(rawArticle, apiKey) {
  if (!apiKey) {
    throw new Error('Missing ZHIPU_API_KEY environment variable');
  }

  const endpoint = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const postData = {
    model: 'glm-4',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Please analyze this article:\nTitle: ${rawArticle.title}\nCategory: ${rawArticle.category}\nContent:\n${rawArticle.content}` }
    ],
    temperature: 0.3
  };

  console.log(`[LLM] 正在向大模型发起解析请求: ${rawArticle.title}`);
  try {
    const response = await axios.post(endpoint, postData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 60000 // 60s timeout for LLM generation
    });

    const resultText = response.data?.choices?.[0]?.message?.content;
    if (!resultText) {
      throw new Error('LLM returned an empty response');
    }

    // 清洗大模型可能自带的 markdown block 标记
    let cleanJSONText = resultText.trim();
    if (cleanJSONText.startsWith('```json')) {
      cleanJSONText = cleanJSONText.substring(7);
    }
    if (cleanJSONText.startsWith('```')) {
      cleanJSONText = cleanJSONText.substring(3);
    }
    if (cleanJSONText.endsWith('```')) {
      cleanJSONText = cleanJSONText.substring(0, cleanJSONText.length - 3);
    }
    cleanJSONText = cleanJSONText.trim();

    const articleJSON = JSON.parse(cleanJSONText);
    
    // 补齐分类相关的静态属性（如 id，category，icon）
    articleJSON.id = 'article_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    articleJSON.category = rawArticle.category;
    articleJSON.icon = rawArticle.icon;

    // 自检与修复 translation_task 字段名称规范
    // 原有的 contracts 在 active_recall 中有时是 mc_quiz, 有时是 quiz_task
    // 我们的前端在阅读详情里读取的是:
    // articleData.active_recall.mc_quiz (主旨)
    // articleData.active_recall.translation_task (翻译)
    // 在 reading.wxml 里面对应:
    // {{currentTask.quiz.question}} -> 这是在 js 里面做了转换，转换在 reading.js：
    // let mc = articleData.active_recall.mc_quiz;
    // let trans = articleData.active_recall.translation_task;
    // 我们在这里双重兼容：
    if (articleJSON.active_recall) {
      if (articleJSON.active_recall.mc_quiz && !articleJSON.active_recall.quiz) {
        // 双向备份确保前端渲染稳定
        articleJSON.active_recall.quiz = articleJSON.active_recall.mc_quiz;
      }
    }

    return articleJSON;
  } catch (error) {
    console.error(`[LLM] 大模型解析发生错误: ${rawArticle.title}`, error.message);
    if (error.response?.data) {
      console.error(`[LLM] API 错误细节:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

module.exports = {
  parseArticleWithLLM
};
