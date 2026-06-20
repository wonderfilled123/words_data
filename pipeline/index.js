require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { RSS_SOURCES } = require('./config');
const { fetchAllRSS } = require('./rss');
const { parseArticleWithLLM } = require('./llm');

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const dbPath = path.join(__dirname, '../articlesDB.json');

// 读取本地文章数据库
function readLocalDB() {
  console.log(`[Database] 正在读取本地数据库: ${dbPath}`);
  try {
    if (fs.existsSync(dbPath)) {
      return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
  } catch (error) {
    console.error(`[Database] 读取本地数据库失败:`, error.message);
  }
  // 降级使用本地静态文章数据库做兜底，防止冷启动没有数据源
  try {
    const fallback = require('../../miniprogram-1/miniprogram/data/articlesDB.js');
    console.log(`[Database] 已成功载入备份种子数据`);
    return fallback;
  } catch (e) {
    console.error('[Database] 兜底数据载入失败，返回空数据库', e.message);
    return [];
  }
}

// 将更新后的文章数据库保存回本地
function saveLocalDB(updatedDB) {
  console.log(`[Database] 正在保存更新到本地数据库: ${dbPath}`);
  try {
    fs.writeFileSync(dbPath, JSON.stringify(updatedDB, null, 2), 'utf8');
    console.log('[Database] 本地数据库保存成功！');
    return true;
  } catch (error) {
    console.error('[Database] 本地数据库更新失败:', error.message);
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
  const currentDB = readLocalDB();
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

    // 5. 写入本地发布
    saveLocalDB(newDB);
  } else {
    console.log('[Pipeline] 今日无新增可用文章或抓取去重，数据库保持原样。');
  }

  console.log('================================================');
  console.log('[Pipeline] 内容生成管线运行结束。');
  console.log('================================================');
}

runPipeline();
