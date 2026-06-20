require('dotenv').config();
const axios = require('axios');
const { GIST_ID, GIST_FILE_NAME, RSS_SOURCES } = require('./config');
const { fetchAllRSS } = require('./rss');
const { parseArticleWithLLM } = require('./llm');

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // 需具备 gist 权限

// 从 GitHub Gist 获取当前已有的文章库
async function fetchCurrentDB() {
  console.log(`[Database] 正在拉取云端 Gist 数据库: ${GIST_ID}`);
  const url = `https://api.github.com/gists/${GIST_ID}`;
  try {
    const headers = {};
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    }
    const response = await axios.get(url, { headers });
    const file = response.data?.files?.[GIST_FILE_NAME];
    if (file && file.content) {
      return JSON.parse(file.content);
    }
    console.warn(`[Database] 在 Gist 中未找到文件 ${GIST_FILE_NAME}，准备创建新数据库。`);
    return [];
  } catch (error) {
    console.error(`[Database] 拉取 Gist 失败:`, error.message);
    // 降级使用本地静态文章数据库做兜底，防止冷启动没有数据源
    try {
      const fallback = require('../../miniprogram-1/miniprogram/data/articlesDB.js');
      console.log(`[Database] 已成功载入本地静态 articlesDB 作为备份种子数据`);
      return fallback;
    } catch (e) {
      console.error('[Database] 本地兜底数据载入失败，返回空数据库', e.message);
      return [];
    }
  }
}

// 将更新后的文章库推送到云端 Gist
async function saveToGist(updatedDB) {
  if (!GITHUB_TOKEN) {
    console.warn('[Database] 未配置 GITHUB_TOKEN，跳过更新云端 Gist 步骤，打印部分数据以供预览：');
    console.log(JSON.stringify(updatedDB.slice(0, 1), null, 2));
    return false;
  }

  console.log(`[Database] 正在推送更新到 GitHub Gist: ${GIST_ID}`);
  const url = `https://api.github.com/gists/${GIST_ID}`;
  const patchData = {
    description: 'Auto-generated English Learning Articles DB - Unmanned Engine',
    files: {
      [GIST_FILE_NAME]: {
        "content": JSON.stringify(updatedDB, null, 2)
      }
    }
  };

  try {
    const response = await axios.patch(url, patchData, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (response.status === 200) {
      console.log('[Database] 云端 Gist 数据库热更新成功！');
      return true;
    }
    throw new Error(`HTTP 状态码: ${response.status}`);
  } catch (error) {
    console.error('[Database] 云端 Gist 更新失败:', error.message);
    if (error.response?.data) {
      console.error(`[Database] Gist 错误详情:`, JSON.stringify(error.response.data));
    }
    return false;
  }
}

async function runPipeline() {
  console.log('================================================');
  console.log(`[Pipeline] 开始执行无人驾驶内容生成管线 ${new Date().toISOString()}`);
  console.log('================================================');

  if (!ZHIPU_API_KEY) {
    console.error('[Pipeline] 错误: 环境变量 ZHIPU_API_KEY 未设置！退出管线。');
    process.exit(1);
  }

  // 1. 获取已存在的文章数据库
  const currentDB = await fetchCurrentDB();
  console.log(`[Pipeline] 当前库中已有文章数: ${currentDB.length}`);

  // 2. 抓取最新的 RSS 资讯
  const latestRSSArticles = await fetchAllRSS(RSS_SOURCES);
  console.log(`[Pipeline] RSS 抓取完毕，共捕获新文章 ${latestRSSArticles.length} 篇`);

  // 3. 开始文章比对、去重及大模型处理
  const processedArticles = [];
  
  for (const rawArticle of latestRSSArticles) {
    // 根据标题排重
    const isDuplicate = currentDB.some(item => 
      item.title.toLowerCase().trim() === rawArticle.title.toLowerCase().trim()
    );

    if (isDuplicate) {
      console.log(`[Pipeline] 过滤排重文章: ${rawArticle.title}，跳过 LLM 拆解。`);
      continue;
    }

    // 调用 LLM 分析拆解
    const parsedObj = await parseArticleWithLLM(rawArticle, ZHIPU_API_KEY);
    if (parsedObj) {
      // 基础 Schema 完整性自检，防止模型生成格式残缺的脏数据入库
      if (parsedObj.title && parsedObj.paragraphs && parsedObj.active_recall) {
        processedArticles.push(parsedObj);
        console.log(`[Pipeline] 成功清洗拆解新文章: ${parsedObj.title}`);
      } else {
        console.warn(`[Pipeline] 新生成文章结构残损，已安全丢弃: ${rawArticle.title}`);
      }
    }
  }

  // 4. 合并入库并限制列表最大容量（保持最大 25 篇，避免包体积无限增大）
  if (processedArticles.length > 0) {
    console.log(`[Pipeline] 开始将 ${processedArticles.length} 篇新文章并入数据库头部...`);
    // 最新的排在最前面
    let newDB = processedArticles.concat(currentDB);
    if (newDB.length > 25) {
      newDB = newDB.slice(0, 25);
      console.log(`[Pipeline] 数据库已超出 25 篇最大容量上限，执行修剪过滤。`);
    }

    // 5. 写入 Gist 云端发布
    await saveToGist(newDB);
  } else {
    console.log('[Pipeline] 今日无新增可用文章或抓取去重，数据库保持原样。');
  }

  console.log('================================================');
  console.log('[Pipeline] 内容生成管线运行结束。');
  console.log('================================================');
}

runPipeline();
