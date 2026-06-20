const fs = require('fs');
const path = require('path');
const https = require('https');

const itJsonPath = path.join(__dirname, 'it.json');

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
  console.log("==================== Expanding IT Vocabulary to 1000 Words (Robust Version) ====================");
  
  // 1. Load existing it.json words (which has 675 words now)
  let localWords = [];
  if (fs.existsSync(itJsonPath)) {
    try {
      localWords = JSON.parse(fs.readFileSync(itJsonPath, 'utf8'));
      console.log(`Loaded ${localWords.length} existing IT words from local it.json`);
    } catch (e) {
      console.error("Failed to load local it.json");
    }
  }

  const existingWordsSet = new Set(localWords.map(w => w.word.toLowerCase()));
  const finalWordList = [...localWords];

  // 2. Download and parse Ephraim Duncan's developer dictionary terms
  console.log("Fetching Ephraim Duncan's developer dictionary...");
  const devDictUrl = 'https://cdn.jsdelivr.net/gh/ephraimduncan/awesome-developer-dictionary@master/README.md';
  const devDictData = await fetchUrl(devDictUrl);
  const devDictLines = devDictData.split('\n');
  const devTerms = [];
  for (const line of devDictLines) {
    const match = line.match(/^-\s+\*\*([^*]+)\*\*/);
    if (match) {
      let term = match[1].trim();
      const cleanMatch = term.match(/^([a-zA-Z\s\-\']+)/);
      if (cleanMatch) {
        term = cleanMatch[1].trim();
        if (term.includes('/')) {
          term.split('/').forEach(t => {
            const cleanT = t.trim();
            if (cleanT && cleanT.length > 2) devTerms.push(cleanT);
          });
        } else {
          if (term.length > 2) devTerms.push(term);
        }
      }
    }
  }
  console.log(`Parsed ${devTerms.length} candidate developer terms.`);

  // 3. Download and parse SEEC.json words using robust parsing
  let seecWords = [];
  try {
    console.log("Fetching SEEC.json word list...");
    const seecUrl = 'https://cdn.jsdelivr.net/gh/lpmi-13/machine_readable_wordlists@master/Discipline-Specific/SEEC/SEEC.json';
    const seecData = await fetchUrl(seecUrl);
    const seecJson = JSON.parse(seecData);
    
    if (Array.isArray(seecJson)) {
      seecWords = seecJson.map(w => typeof w === 'string' ? w : (w.word || w.headword));
    } else if (seecJson.headwords) {
      seecWords = seecJson.headwords;
    } else {
      const values = Object.values(seecJson);
      for (const val of values) {
        if (Array.isArray(val)) {
          seecWords = seecWords.concat(val.map(w => typeof w === 'string' ? w : (w.word || w.headword)));
        }
      }
    }
    console.log(`Loaded ${seecWords.length} candidate SEEC words.`);
  } catch(e) {
    console.warn("Could not fetch or parse SEEC.json. Proceeding with backups.");
  }

  // 4. Merge candidates
  const wordsToFetch = [];
  
  // Try developer dictionary terms
  for (const w of devTerms) {
    if (finalWordList.length + wordsToFetch.length >= 1000) break;
    const cleanW = w.trim();
    if (cleanW && !/[^a-zA-Z\s\-\']/.test(cleanW) && !existingWordsSet.has(cleanW.toLowerCase())) {
      existingWordsSet.add(cleanW.toLowerCase());
      wordsToFetch.push(cleanW);
    }
  }

  // Try SEEC words
  for (const w of seecWords) {
    if (finalWordList.length + wordsToFetch.length >= 1000) break;
    const cleanW = w.trim();
    if (cleanW && !/[^a-zA-Z\s\-\']/.test(cleanW) && !existingWordsSet.has(cleanW.toLowerCase())) {
      existingWordsSet.add(cleanW.toLowerCase());
      wordsToFetch.push(cleanW);
    }
  }

  // 5. If we still need more words to reach 1000, download CET6 as academic backup
  let remainingNeeded = 1000 - (finalWordList.length + wordsToFetch.length);
  if (remainingNeeded > 0) {
    console.log(`Still need ${remainingNeeded} words. Fetching CET-6 vocabulary as backup...`);
    try {
      const cet6Url = 'https://cdn.jsdelivr.net/gh/KyleBing/english-vocabulary@8814e02b40f69a2a6e016dbde087010304fcedfc/json/4-CET6-%E9%A1%BA%E5%BA%8F.json';
      const cet6Data = await fetchUrl(cet6Url);
      const cet6Json = JSON.parse(cet6Data);
      
      for (const item of cet6Json) {
        if (finalWordList.length + wordsToFetch.length >= 1000) break;
        const w = item.word.trim();
        if (w && !/[^a-zA-Z\s\-\']/.test(w) && !existingWordsSet.has(w.toLowerCase())) {
          existingWordsSet.add(w.toLowerCase());
          wordsToFetch.push(w);
        }
      }
    } catch(e) {
      console.error("Failed to fetch CET-6 backup list:", e.message);
    }
  }

  const newWordsNeeded = 1000 - finalWordList.length;
  console.log(`Already have ${finalWordList.length} words. Adding ${wordsToFetch.length} new words to reach exactly 1000.`);

  if (newWordsNeeded <= 0 || wordsToFetch.length === 0) {
    console.log("Already reached 1000 words. Done.");
    return;
  }

  // 6. Fetch details from Youdao API
  let completedCount = 0;
  const fetchWordDetail = async (word) => {
    await delay(150); // safety throttle
    const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
    try {
      const responseBody = await fetchUrl(url);
      const json = JSON.parse(responseBody);
      const wordItem = parseWordData(word, json);
      finalWordList.push(wordItem);
      
      completedCount++;
      if (completedCount % 50 === 0 || completedCount === wordsToFetch.length) {
        console.log(`Progress: [${completedCount}/${wordsToFetch.length}] words processed.`);
      }
    } catch (e) {
      console.error(`Failed to fetch details for "${word}": ${e.message}`);
      finalWordList.push({
        word: word,
        phonetic_full: '//',
        word_audio_url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=1`,
        phonetic_parts: [],
        meaning: '暂无释义'
      });
    }
  };

  await pool(wordsToFetch, 5, fetchWordDetail);

  // 7. Write final result back to it.json
  fs.writeFileSync(itJsonPath, JSON.stringify(finalWordList, null, 2), 'utf8');
  console.log(`Successfully completed and saved 1000 words to local it.json!`);
}

run();
