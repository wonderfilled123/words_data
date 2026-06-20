const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'description']
  }
});

// 清洗 HTML 标签，只保留纯文本，并限制长度以减少大模型 Token 消耗
function cleanContent(html, maxLength = 800) {
  if (!html) return '';
  // 替换各种 HTML 标签
  let text = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  return text;
}

async function fetchLatestFromRSS(source) {
  console.log(`[RSS] 正在从源拉取内容: ${source.category} -> ${source.url}`);
  try {
    const feed = await parser.parseURL(source.url);
    if (!feed.items || feed.items.length === 0) {
      console.warn(`[RSS] 源未返回任何文章: ${source.category}`);
      return null;
    }

    // 寻找第一篇有实质内容的文章
    for (const item of feed.items) {
      // 提取正文内容，TechCrunch 等通常放在 content:encoded 或 content 中
      const rawContent = item['content:encoded'] || item.content || item.description || '';
      const textContent = cleanContent(rawContent);

      if (textContent.length > 200) { // 确保有足够长内容供大模型分析
        return {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate || item.isoDate,
          content: textContent,
          category: source.category,
          icon: source.icon
        };
      }
    }
    
    console.warn(`[RSS] 筛选后未找到足够长内容的文章: ${source.category}`);
    return null;
  } catch (error) {
    console.error(`[RSS] 拉取源报错: ${source.category}`, error.message);
    return null;
  }
}

async function fetchAllRSS(sources) {
  const articles = [];
  for (const src of sources) {
    const art = await fetchLatestFromRSS(src);
    if (art) {
      articles.push(art);
    }
  }
  return articles;
}

module.exports = {
  fetchAllRSS
};
