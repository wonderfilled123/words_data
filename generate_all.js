const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const CONFIG = {
  cet4: {
    limit: 4538,
    localPath: path.join(__dirname, 'cet4.json'),
    sourceUrl: 'https://cdn.jsdelivr.net/gh/KyleBing/english-vocabulary@8814e02b40f69a2a6e016dbde087010304fcedfc/json/3-CET4-%E9%A1%BA%E5%BA%8F.json',
    parseSource: (data) => {
      const json = JSON.parse(data);
      return json.map(item => item.word);
    }
  },
  business: {
    limit: 1000,
    localPath: path.join(__dirname, 'business.json'),
    sourceUrl: 'https://cdn.jsdelivr.net/gh/KyleBing/english-vocabulary@8814e02b40f69a2a6e016dbde087010304fcedfc/json_original/json-simple/BEC_2.json',
    parseSource: (data) => {
      const json = JSON.parse(data);
      return json.map(item => item.word);
    }
  },
  it: {
    limit: 1000,
    localPath: path.join(__dirname, 'it.json'),
    sourceUrl: 'https://cdn.jsdelivr.net/gh/lpmi-13/machine_readable_wordlists@master/Discipline-Specific/CSWL/CSWL.json',
    parseSource: (data) => {
      const json = JSON.parse(data);
      return json.headwords || [];
    }
  }
};

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

// Helper for HTTP requests with retry logic
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

// Split phonetic transcription into parts
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

// Parse Youdao response to construct standard word item
function parseWordData(word, json) {
  let phonetic_full = '';
  let meaning = '';
  let word_audio_url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=1`; // Default UK

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

// Parallel pool implementation
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

// Process single vocabulary category
async function processCategory(name, info) {
  console.log(`\n==================== Processing Category: ${name} ====================`);
  const limit = info.limit || 1000;
  
  // 1. Read existing local words to preserve them
  let localWords = [];
  if (fs.existsSync(info.localPath)) {
    try {
      localWords = JSON.parse(fs.readFileSync(info.localPath, 'utf8'));
      console.log(`Loaded ${localWords.length} existing words from local ${name}.json`);
    } catch (e) {
      console.warn(`Failed to parse local ${name}.json, starting from scratch.`);
    }
  }

  const existingWordsSet = new Set(localWords.map(w => w.word.toLowerCase()));
  const finalWordList = [...localWords];

  // 2. Fetch source list from jsDelivr
  console.log(`Fetching word list candidates from source URL...`);
  const rawSourceData = await fetchUrl(info.sourceUrl);
  const candidateWords = info.parseSource(rawSourceData);
  console.log(`Found ${candidateWords.length} candidate words from remote source.`);

  // 3. Fill up to limit words
  const wordsToFetch = [];
  for (const rawWord of candidateWords) {
    if (finalWordList.length >= limit) break;
    const word = rawWord.trim();
    // Exclude special strings, empty strings, and duplicates
    if (!word || /[^a-zA-Z\s\-\']/.test(word) || existingWordsSet.has(word.toLowerCase())) {
      continue;
    }
    existingWordsSet.add(word.toLowerCase());
    wordsToFetch.push(word);
  }

  const newWordsNeeded = limit - finalWordList.length;
  console.log(`Already have ${finalWordList.length} words. Need to fetch ${newWordsNeeded} new words.`);
  
  if (newWordsNeeded <= 0) {
    console.log(`Category ${name} already has ${limit} words. Skipping details fetch.`);
    return;
  }

  // Slice to fetch exactly what is needed
  const wordsToProcess = wordsToFetch.slice(0, newWordsNeeded);
  console.log(`Starting to fetch details for ${wordsToProcess.length} words...`);

  let completedCount = 0;

  // Process words in parallel pool (concurrency: 5, with 150ms delay between starts)
  const fetchWordDetail = async (word) => {
    if (finalWordList.length >= limit) return; // Stop if we reach limit
    await delay(150); // safety throttle
    const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
    try {
      const responseBody = await fetchWithRetry(url);
      const json = JSON.parse(responseBody);
      const wordItem = parseWordData(word, json);
      finalWordList.push(wordItem);
      
      completedCount++;
      if (completedCount % 50 === 0 || completedCount === wordsToProcess.length) {
        console.log(`Progress: [${completedCount}/${wordsToProcess.length}] words processed.`);
      }
    } catch (e) {
      console.error(`Failed to fetch details for word "${word}": ${e.message}`);
      // Fallback object to prevent data gaps
      finalWordList.push({
        word: word,
        phonetic_full: '//',
        word_audio_url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=1`,
        phonetic_parts: [],
        meaning: '暂无释义'
      });
    }
  };

  await pool(wordsToProcess, 5, fetchWordDetail);

  // 4. Save results back to local file
  fs.writeFileSync(info.localPath, JSON.stringify(finalWordList, null, 2), 'utf8');
  console.log(`Successfully saved ${finalWordList.length} words to local ${name}.json!`);
}

async function run() {
  const startTime = Date.now();
  try {
    await processCategory('cet4', CONFIG.cet4);
    await processCategory('business', CONFIG.business);
    await processCategory('it', CONFIG.it);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 All categories processed successfully in ${duration}s!`);
  } catch (e) {
    console.error("Critical error in pipeline:", e);
  }
}

// Wrapper for retry logic on fetch
async function fetchWithRetry(url, retries = 3, delayMs = 500) {
  return fetchUrl(url, retries, delayMs);
}

run();
