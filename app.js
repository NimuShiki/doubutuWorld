const HIRAGANA_RE = /^[\u3041-\u3096]$/;

function isWhitespace(ch) {
  return ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ';
}

function parseDictTsv(text) {
  const map1 = new Map(); // 1文字キー
  const map2 = new Map(); // 2文字キー

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line || line.startsWith('#')) continue;

    const tab = line.indexOf('\t');
    if (tab < 0) continue;

    const keyRaw = line.slice(0, tab).trim();
    const value = line.slice(tab + 1); // 値側は空白含んでもOK

    const key = keyRaw.normalize('NFC');
    const keyChars = Array.from(key); // コードポイント単位（日本語はこれでOK）

    if (keyChars.length === 1) {
      const k = keyChars[0];
      if (HIRAGANA_RE.test(k)) map1.set(k, value);
    } else if (keyChars.length === 2) {
      const k0 = keyChars[0], k1 = keyChars[1];
      if (HIRAGANA_RE.test(k0) && HIRAGANA_RE.test(k1)) map2.set(k0 + k1, value);
    } else {
      // 3文字以上は仕様外 → 無視
      continue;
    }
  }

  return { map1, map2 };
}

async function loadDict() {
  const res = await fetch('./dict.tsv', { cache: 'no-store' });
  if (!res.ok) throw new Error(`dict.tsv load failed: ${res.status}`);
  const text = await res.text();
  return parseDictTsv(text);
}

function convert(src, dict) {
  const s = src.normalize('NFC');
  const chars = Array.from(s);

  let out = '';
  const skipped = new Set();

  for (let i = 0; i < chars.length; ) {
    const ch = chars[i];

    if (isWhitespace(ch)) {
      out += ch;
      i++;
      continue;
    }

    // ひらがな以外は無視（要件通り）
    if (!HIRAGANA_RE.test(ch)) {
      i++;
      continue;
    }

    // 2文字最長一致（優先）
    if (i + 1 < chars.length && HIRAGANA_RE.test(chars[i + 1])) {
      const k2 = ch + chars[i + 1];
      const v2 = dict.map2.get(k2);
      if (v2 !== undefined) {
        out += v2;
        i += 2;
        continue;
      }
    }

    // 1文字
    const v1 = dict.map1.get(ch);
    if (v1 !== undefined) out += v1;
    else skipped.add(ch); // 未登録ひらがな（辞書追加のヒント）
    i++;
  }

  return { out, skipped };
}

(async function main() {
  const status = document.getElementById('status');
  const src = document.getElementById('src');
  const dst = document.getElementById('dst');
  const copy = document.getElementById('copy');

  let dict;
  try {
    dict = await loadDict();
    status.textContent = `辞書ロード完了：1文字${dict.map1.size}件 / 2文字${dict.map2.size}件`;
  } catch (e) {
    status.textContent = `辞書ロード失敗：${e.message}`;
    dict = { map1: new Map(), map2: new Map() };
  }

  function refresh() {
    const { out, skipped } = convert(src.value, dict);
    dst.value = out;

    const base = `辞書：1文字${dict.map1.size}件 / 2文字${dict.map2.size}件`;
    if (skipped.size > 0) {
      status.textContent = `${base} / 未登録：${[...skipped].join('')}`;
    } else {
      status.textContent = base;
    }
  }

  src.addEventListener('input', refresh);
  refresh();

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dst.value);
      status.textContent = `${status.textContent} / コピーした`;
    } catch {
      // 旧式フォールバック
      dst.focus();
      dst.select();
      document.execCommand('copy');
      status.textContent = `${status.textContent} / コピーした（旧式）`;
    }
  });
})();
