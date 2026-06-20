module.exports = {
  // Gist 数据库配置
  GIST_ID: '73fc13607882b5bd76af77a548d6b4bc',
  GIST_FILE_NAME: 'articlesDB.json',

  // RSS 源配置：选取各领域活跃、高质量的英文 Feed
  RSS_SOURCES: [
    {
      category: '🤖 人工智能',
      icon: '⚡',
      url: 'https://techcrunch.com/category/artificial-intelligence/feed/'
    },
    {
      category: '🎮 游戏电竞',
      icon: '🎯',
      url: 'https://www.gamespot.com/feeds/news/'
    },
    {
      category: '🎵 独立音乐',
      icon: '🎸',
      url: 'https://pitchfork.com/feed/feed/'
    }
  ],

  // 单词分级评估参数
  LEVEL_MAP: {
    low: '⭐ 入门',
    medium: '⭐⭐ 中级',
    high: '⭐⭐⭐ 高级'
  }
};
