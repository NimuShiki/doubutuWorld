// ひらがな（U+3041..U+3096）
const HIRAGANA_RE = /^[\u3041-\u3096]$/;

function isWhitespace(ch) {
  return ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ';
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// TSV: key \t value
// key は 1文字 or 2文字（ひらがなのみ）
function parseDictTsv(text) {
  const map1 = new Map(); // 1文字キー
  const map2 = new Map(); // 2文字キー

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const tab = line.indexOf('\t');
    if (tab < 0) continue;

    const keyRaw = line.slice(0, tab).trim();
    const value = line.slice(tab + 1);

    const key = keyRaw.normalize('NFC');
    const chars = Array.from(key);

    if (chars.length === 1) {
      const k = chars[0];
      if (HIRAGANA_RE.test(k)) map1.set(k, value);
    } else if (chars.length === 2) {
      const k0 = chars[0], k1 = chars[1];
      if (HIRAGANA_RE.test(k0) && HIRAGANA_RE.test(k1)) map2.set(k0 + k1, value);
    }
  }

  return { map1, map2 };
}

async function loadDictText() {
  const res = await fetch('./dict.tsv', { cache: 'no-store' });
  if (!res.ok) throw new Error(`dict.tsv load failed: ${res.status}`);
  return await res.text();
}

// 変換（2文字最長一致）
// 未登録ひらがな・ひらがな以外は無視。空白/改行は保持。
function convert(src, dict) {
  const s = src.normalize('NFC');
  const chars = Array.from(s);

  let out = '';
  const skipped = new Set();

  for (let i = 0; i < chars.length; ) {
    const ch = chars[i];

    if (isWhitespace(ch)) { out += ch; i++; continue; }

    if (!HIRAGANA_RE.test(ch)) {
      skipped.add(ch);
      i++;
      continue;
    }

    // 2文字優先
    if (i + 1 < chars.length && HIRAGANA_RE.test(chars[i + 1])) {
      const k2 = ch + chars[i + 1];
      const v2 = dict.map2.get(k2);
      if (v2 !== undefined) { out += v2; i += 2; continue; }
    }

    // 1文字
    const v1 = dict.map1.get(ch);
    if (v1 !== undefined) out += v1;
    else skipped.add(ch);

    i++;
  }

  return { out, skipped };
}

// 入力ハイライトHTML生成（変換と同じ最長一致で「辞書無し」を赤）
function buildHighlightHtml(src, dict) {
  const s = src.normalize('NFC');
  const chars = Array.from(s);
  const mark = new Array(chars.length).fill('good');

  for (let i = 0; i < chars.length; ) {
    const ch = chars[i];

    if (isWhitespace(ch)) { mark[i] = 'space'; i++; continue; }

    if (!HIRAGANA_RE.test(ch)) { mark[i] = 'bad'; i++; continue; }

    // 2文字一致なら両方good
    if (i + 1 < chars.length && HIRAGANA_RE.test(chars[i + 1])) {
      const k2 = ch + chars[i + 1];
      if (dict.map2.has(k2)) {
        mark[i] = 'good';
        mark[i + 1] = 'good';
        i += 2;
        continue;
      }
    }

    // 1文字一致
    mark[i] = dict.map1.has(ch) ? 'good' : 'bad';
    i++;
  }

  let html = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const esc = escapeHtml(ch === '\t' ? '    ' : ch);
    html += (mark[i] === 'bad') ? `<span class="bad">${esc}</span>` : esc;
  }
  return html;
}

function setStatus(el, dict, skippedSet) {
  const base = `辞書：1文字${dict.map1.size}件 / 2文字${dict.map2.size}件`;
  if (skippedSet && skippedSet.size > 0) {
    const skipped = [...skippedSet].filter(ch => HIRAGANA_RE.test(ch)).join('');
    el.textContent = skipped ? `${base} / 未登録：${skipped}` : base;
  } else {
    el.textContent = base;
  }
}

(async function main() {
  const status = document.getElementById('status');
  const src = document.getElementById('src');
  const hl  = document.getElementById('srcHighlight');
  const dst = document.getElementById('dst');

  const copyOut = document.getElementById('copyOut');

  const dictView = document.getElementById('dictView');
  const copyDict = document.getElementById('copyDict');

  let dictText = '';
  let dict = { map1: new Map(), map2: new Map() };

  try {
    dictText = await loadDictText();
    dict = parseDictTsv(dictText);
    dictView.value = dictText;
    status.textContent = `辞書ロード完了：1文字${dict.map1.size}件 / 2文字${dict.map2.size}件`;
  } catch (e) {
    status.textContent = `辞書ロード失敗：${e.message}`;
    dictView.value = '';
  }

  function refresh() {
    const { out, skipped } = convert(src.value, dict);
    dst.value = out;

    hl.innerHTML = buildHighlightHtml(src.value, dict);

    // スクロール同期
    hl.scrollTop = src.scrollTop;
    hl.scrollLeft = src.scrollLeft;

    setStatus(status, dict, skipped);
  }

  src.addEventListener('input', refresh);
  src.addEventListener('scroll', () => {
    hl.scrollTop = src.scrollTop;
    hl.scrollLeft = src.scrollLeft;
  });

  copyOut.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dst.value);
      status.textContent = `${status.textContent} / コピーした`;
    } catch {
      dst.focus();
      dst.select();
      document.execCommand('copy');
      status.textContent = `${status.textContent} / コピーした（旧式）`;
    }
  });

  refresh();
})();
