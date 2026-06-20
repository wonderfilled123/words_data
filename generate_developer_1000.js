const fs = require('fs');
const path = require('path');
const https = require('https');

const itPath = path.join(__dirname, 'it.json');
const cet4Path = path.join(__dirname, 'cet4.json');
const bizPath = path.join(__dirname, 'business.json');
const localDevPath = 'c:/Users/wonderfilled/WeChatProjects/miniprogram-1/miniprogram/data/developer.json';
const targetDevPath = path.join(__dirname, 'developer.json');

const phoneticMap = {
  // 元音 (Vowels)
  "iː": "i-sound2", "ɪ": "i-sound", "i": "i-sound", "e": "e-sound", "æ": "an-sound",
  "ɜː": "er-sound", "ə": "e5E-sound", "ʌ": "5E-sound", "uː": "u-sound2", "ʊ": "u-sound",
  "ɔː": "o-sound2", "ɒ": "o-sound", "ɑː": "a-sound2", "eɪ": "ei", "ei": "ei",
  "aɪ": "ai", "ai": "ai", "ɔɪ": "oi", "ɔi": "oi", "aʊ": "ao", "əʊ": "eu",
  "ɪə": "ir", "iə": "ir", "eə": "er", "ʊə": "uer",
  // 辅音 (Consonants)
  "p": "p", "t": "t", "k": "k", "b": "b", "d": "d", "g": "g", "ɡ": "g",
  "f": "f", "s": "s", "ʃ": "ss", "θ": "si", "h": "h", "v": "v", "z": "z",
  "ʒ": "n3", "ð": "qq", "r": "r", "tʃ": "tss", "tr": "tr", "ts": "ts",
  "dʒ": "d3", "dr": "dr", "dz": "dz", "m": "m", "n": "n", "ŋ": "ng",
  "l": "l", "j": "j", "w": "w"
};

const sortedPhonemes = Object.keys(phoneticMap).sort((a, b) => b.length - a.length);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchUrl(url, retries = 3, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        };
        https.get(options, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Status ${res.statusCode}`));
          }
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data));
        }).on('error', reject)
          .on('timeout', () => reject(new Error('Timeout')));
      });
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(delayMs);
    }
  }
}

function splitPhonetic(phonetic_full) {
  let clean = phonetic_full
    .replace(/[\/\[\]]/g, '')
    .replace(/[ˈˌ\.]/g, '')
    .replace(/[ːː]/g, 'ː')
    .trim();
  
  const parts = [];
  let i = 0;
  while (i < clean.length) {
    let matched = false;
    for (const phoneme of sortedPhonemes) {
      if (clean.substring(i).startsWith(phoneme)) {
        parts.push(phoneme);
        i += phoneme.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const char = clean[i];
      if (/[a-zA-Z]/.test(char)) {
        parts.push(char);
      }
      i++;
    }
  }
  return parts;
}

function parseWordData(word, json) {
  let phonetic_full = '';
  let meaning = '';
  let word_audio_url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=1`;

  let ukphone = '';
  let usphone = '';

  if (json.ec && json.ec.word && json.ec.word[0]) {
    const w = json.ec.word[0];
    ukphone = w.ukphone;
    usphone = w.usphone;
    if (w.ukspeech) {
      word_audio_url = `https://dict.youdao.com/dictvoice?audio=${w.ukspeech}`;
    }
    if (w.trs) {
      const parts = [];
      for (const trObj of w.trs) {
        if (trObj.tr && trObj.tr[0] && trObj.tr[0].l && trObj.tr[0].l.i) {
          parts.push(trObj.tr[0].l.i[0]);
        }
      }
      meaning = parts.join('；');
    }
  }

  if (!ukphone && json.simple && json.simple.word && json.simple.word[0]) {
    const w = json.simple.word[0];
    ukphone = w.ukphone;
    usphone = w.usphone;
    if (w.ukspeech) {
      word_audio_url = `https://dict.youdao.com/dictvoice?audio=${w.ukspeech}`;
    }
  }

  if (!meaning) {
    if (json.web_trans && json.web_trans['web-translation']) {
      const transList = json.web_trans['web-translation'];
      if (Array.isArray(transList)) {
        const parts = [];
        for (const trans of transList) {
          if (trans.trans && trans.trans[0] && trans.trans[0].value) {
            parts.push(trans.trans[0].value);
          }
        }
        meaning = parts.join('；');
      }
    }
  }

  const phone = ukphone || usphone;
  if (phone) {
    phonetic_full = `/${phone.replace(/[\/\[\]]/g, '')}/`;
  } else {
    phonetic_full = '//';
  }

  if (!meaning) {
    meaning = '暂无释义';
  }

  return {
    word: word,
    phonetic_full: phonetic_full,
    word_audio_url: word_audio_url,
    phonetic_parts: splitPhonetic(phonetic_full),
    meaning: meaning
  };
}

async function pool(array, limit, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (limit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

async function run() {
  console.log("==================== Expanding Developer Vocabulary to 1000 Words ====================");
  
  const finalWordList = [];
  const wordsSet = new Set();

  // Load existing dictionaries as a lookup database
  const itWords = JSON.parse(fs.readFileSync(itPath, 'utf8'));
  const cet4Words = JSON.parse(fs.readFileSync(cet4Path, 'utf8'));
  const bizWords = JSON.parse(fs.readFileSync(bizPath, 'utf8'));

  const cacheDb = new Map();
  cet4Words.forEach(w => cacheDb.set(w.word.toLowerCase(), w));
  bizWords.forEach(w => cacheDb.set(w.word.toLowerCase(), w));
  itWords.forEach(w => cacheDb.set(w.word.toLowerCase(), w));

  // Helper to add word object
  const addWordObject = (wordObj) => {
    const w = wordObj.word.trim();
    if (!w || /[^a-zA-Z\s\-\']/.test(w)) return false;
    const lower = w.toLowerCase();
    if (wordsSet.has(lower)) return false;
    
    wordsSet.add(lower);
    finalWordList.push(wordObj);
    return true;
  };

  // Helper to check and add word string
  const candidateWords = [];

  // 1. Add existing 50 words from developer.json (keep exact definitions)
  if (fs.existsSync(localDevPath)) {
    const localDev = JSON.parse(fs.readFileSync(localDevPath, 'utf8'));
    console.log(`Loading existing developer.json: ${localDev.length} words`);
    localDev.forEach(w => {
      addWordObject(w);
    });
  }

  // 2. Fetch Awesome Developer Dictionary terms
  console.log("Fetching awesome-developer-dictionary README.md...");
  try {
    const data = await fetchUrl('https://cdn.jsdelivr.net/gh/ephraimduncan/awesome-developer-dictionary@master/README.md');
    const lines = data.split('\n');
    for (const line of lines) {
      const match = line.match(/^-\s+\*\*([^*]+)\*\*/);
      if (match) {
        let term = match[1].trim();
        const cleanMatch = term.match(/^([a-zA-Z\s\-\']+)/);
        if (cleanMatch) {
          term = cleanMatch[1].trim();
          if (term.includes('/')) {
            term.split('/').forEach(t => {
              const cleanT = t.trim();
              if (cleanT && cleanT.length > 2) candidateWords.push(cleanT);
            });
          } else {
            if (term.length > 2) candidateWords.push(term);
          }
        }
      }
    }
    console.log(`Loaded awesome developer candidates: ${candidateWords.length}`);
  } catch (e) {
    console.error("Failed to fetch awesome developer dict:", e.message);
  }

  // 3. Fetch Wei-Xia repository filenames
  console.log("Fetching Wei-Xia most-frequent-technology-english-words _posts...");
  try {
    const html = await fetchUrl('https://github.com/Wei-Xia/most-frequent-technology-english-words/tree/master/_posts');
    const regex = /"name"\s*:\s*"([^"]+\.md)"/g;
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null) {
      const filename = match[1];
      const wordPart = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '').trim().replace(/-/g, ' ');
      if (wordPart && wordPart.length > 2) {
        candidateWords.push(wordPart);
        count++;
      }
    }
    console.log(`Loaded Wei-Xia candidates: ${count}`);
  } catch (e) {
    console.error("Failed to fetch Wei-Xia filenames:", e.message);
  }

  // Deduplicate candidates and build unique queue
  const uniqueQueue = [];
  candidateWords.forEach(w => {
    const lower = w.toLowerCase();
    if (!wordsSet.has(lower) && !uniqueQueue.includes(lower)) {
      uniqueQueue.push(lower);
    }
  });

  console.log(`Unique candidate words queue size: ${uniqueQueue.length}`);

  // Try to populate from cacheDb first, otherwise queue for Youdao API fetch
  const toFetch = [];
  uniqueQueue.forEach(wLower => {
    if (cacheDb.has(wLower)) {
      addWordObject(cacheDb.get(wLower));
    } else {
      // Find the original casing from candidate list
      const original = candidateWords.find(cw => cw.toLowerCase() === wLower) || wLower;
      toFetch.push(original);
    }
  });

  console.log(`Populated from local caches. Current final list count: ${finalWordList.length}`);
  console.log(`Remaining words to fetch from Youdao API: ${toFetch.length}`);

  // Fetch missing details in parallel
  if (toFetch.length > 0) {
    console.log("Fetching new words from Youdao API...");
    let completedCount = 0;
    const fetchWordDetail = async (word) => {
      if (finalWordList.length >= 1000) return; // Stop if we reach 1000
      await delay(150); // safety throttle
      const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
      try {
        const responseBody = await fetchUrl(url);
        const json = JSON.parse(responseBody);
        const wordItem = parseWordData(word, json);
        addWordObject(wordItem);
        completedCount++;
        if (completedCount % 20 === 0 || completedCount === toFetch.length) {
          console.log(`Youdao Progress: [${completedCount}/${toFetch.length}] words processed.`);
        }
      } catch (e) {
        console.error(`Failed to fetch Youdao details for "${word}": ${e.message}`);
        addWordObject({
          word: word,
          phonetic_full: '//',
          word_audio_url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=1`,
          phonetic_parts: [],
          meaning: '暂无释义'
        });
      }
    };

    await pool(toFetch, 5, fetchWordDetail);
  }

  // 4. Fill up to exactly 1000 words using IT words from it.json
  if (finalWordList.length < 1000) {
    console.log(`Still need ${1000 - finalWordList.length} words to reach 1000. Filling from it.json...`);
    for (const itWordObj of itWords) {
      if (finalWordList.length >= 1000) break;
      addWordObject(itWordObj);
    }
  }

  // Trim to exactly 1000 words in case it exceeded
  const final1000 = finalWordList.slice(0, 1000);
  console.log(`Completed collection! Total words in developer list: ${final1000.length}`);

  // Save to both target locations
  fs.writeFileSync(targetDevPath, JSON.stringify(final1000, null, 2), 'utf8');
  fs.writeFileSync(localDevPath, JSON.stringify(final1000, null, 2), 'utf8');
  console.log(`Successfully saved 1000 developer words to:\n  - ${targetDevPath}\n  - ${localDevPath}`);
}

run();
