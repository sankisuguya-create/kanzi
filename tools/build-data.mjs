// data-src/ の正本（学年ごとの words-gN.txt・order-gN.txt）と KanjiVG から src/data.js・src/strokes.js を生成し、同時に検査する。
// 検査に落ちたら書き出さずに終了コード1。警告（読みの自動照合の不一致）は目視確認用に表示するだけ。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GRADES = [1, 2, 3, 4, 5, 6].filter((g) => fs.existsSync(path.join(ROOT, 'data-src', `words-g${g}.txt`)));
const EXPECT_COUNT = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191 }; // 学年別漢字配当表（S2）
const KVG_CACHE = path.join(ROOT, '.cache', 'kanjivg');

const errors = [];
const warns = [];
const err = (m) => errors.push(m);

// ---- 辞書（学年・音訓・画数）
const dic = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'kanjidic2-json', 'KANJIS.json'), 'utf8'));
const byChar = new Map(dic.map((k) => [k.literal, k]));
const gradeOf = (c) => byChar.get(c)?.grade ?? 99;
for (const g of [1, 2, 3, 4, 5, 6]) {
  const n = dic.filter((k) => k.grade === g).length;
  if (n !== EXPECT_COUNT[g]) err(`辞書の${g}年の字数が${n}（期待${EXPECT_COUNT[g]}）`);
}

// ---- 正本の読み込み
const lines = (f) => fs.readFileSync(path.join(ROOT, 'data-src', f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const soften = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const half = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
// 連濁・半濁・促音化を許して、辞書の読みに一致するか。一致したら on/kun を返す
function readingType(ch, r) {
  const k = byChar.get(ch);
  const on = (k.readings.ja_on || []).map(kata2hira);
  const kun = (k.readings.ja_kun || []).flatMap((s) => { const b = s.replace(/^-|-$/g, ''); return [b.split('.')[0], b.replace('.', '')]; });
  const variants = (base) => {
    const v = new Set([base]);
    const f = base[0];
    if (soften[f]) v.add(soften[f] + base.slice(1));
    if (half[f]) v.add(half[f] + base.slice(1));
    if (/[つくちき]$/.test(base)) v.add(base.slice(0, -1) + 'っ');
    [...v].forEach((x) => { if (/[つくちき]$/.test(x)) v.add(x.slice(0, -1) + 'っ'); });
    if (f === 'じ') v.add('ぢ' + base.slice(1));
    return v;
  };
  const onRaw = k.readings.ja_on || [];
  const kunRaw = (k.readings.ja_kun || []).flatMap((s) => { const b = s.replace(/^-|-$/g, ''); return [b, b]; });
  let i = on.findIndex((b) => variants(b).has(r));
  if (i >= 0) return { t: 'on', base: onRaw[i] };
  i = kun.findIndex((b) => variants(b).has(r));
  if (i >= 0) return { t: 'kun', base: kunRaw[i] };
  return null;
}

const entries = new Map();
const readings = new Map();
const orders = {};
for (const GRADE of GRADES) {
const gradeChars = dic.filter((k) => k.grade === GRADE).map((k) => k.literal); // 辞書の並び（JIS順）＝配当表の音順にほぼ同じ
const of = `order-g${GRADE}.txt`;
const order = fs.existsSync(path.join(ROOT, 'data-src', of)) ? [...lines(of).join('').replace(/\s/g, '')] : gradeChars.slice();
if (order.length !== gradeChars.length || new Set(order).size !== order.length || !order.every((c) => gradeOf(c) === GRADE))
  err(`${of} が${GRADE}年の${gradeChars.length}字の並べ替えになっていない（${order.length}字）`);
orders[GRADE] = order;
const seen = new Set();
for (const line of lines(`words-g${GRADE}.txt`)) {
  const [ch, rest] = line.split('|');
  if (entries.has(ch)) err(`${ch}: 重複`);
  const words = rest.split(',').map((s) => s.split(':'));
  const out = [];
  const on = [], kun = [];
  for (const [w, kk, r] of words) {
    if (!w || !kk || !r) { err(`${ch}: 書式エラー「${line}」`); continue; }
    const [k, ...alts] = kk.split('/');
    if (!w.includes(ch)) err(`${ch}: 例語「${w}」に字が含まれない`);
    for (const c of w) if (/\p{Script=Han}/u.test(c) && gradeOf(c) > GRADE) err(`${ch}: 例語「${w}」に${GRADE}年より上の字「${c}」`);
    if (!k.includes(r)) err(`${ch}: 例語「${w}」のよみ「${k}」に字のよみ「${r}」が含まれない`);
    const m = readingType(ch, r);
    if (!m) { err(`${ch}: よみ「${r}」が辞書の音訓に一致しない`); continue; }
    const t = m.t;
    const list = t === 'on' ? on : kun;
    // 提示用の読み: 音は辞書の元の形（連濁前）。訓は辞書の語幹＋例語の実際の送り仮名（温かい→あたた.かい）
    let base = m.base;
    if (t === 'kun') {
      const stem = m.base.split('.')[0];
      const okuri = (w.slice(w.indexOf(ch) + 1).match(/^[\u3041-\u3096]+/) || [''])[0];
      base = m.base.includes('.') && okuri ? stem + '.' + okuri : stem;
    }
    // 同じ語幹は最初の1つだけ（持つ／持ち物 → も.つ のみ）
    if (!list.some((x) => x.split('.')[0] === base.split('.')[0])) list.push(base);
    out.push(alts.length ? [w, k, r, t, alts] : [w, k, r, t]);
  }
  entries.set(ch, out);
  readings.set(ch, { on, kun });
  seen.add(ch);
  if (gradeOf(ch) !== GRADE) err(`${ch}: ${GRADE}年の字ではない`);
}
for (const c of gradeChars) if (!seen.has(c)) err(`${c}: 例語がない（${GRADE}年）`);
}

// ---- 例語全体のよみを形態素解析で照合（警告のみ）
const kuromoji = require('kuromoji');
const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji')), '..', 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
for (const [ch, ws] of entries) for (const [w, k, , , alts] of ws) {
  const guess = kata2hira(tokenizer.tokenize(w).map((t) => t.reading || t.surface_form).join(''));
  if (guess !== k && !(alts || []).includes(guess)) warns.push(`${ch}: 「${w}」 正本=${k} 解析=${guess}`);
}

// ---- KanjiVG（筆順）
// 座標を小数1桁に丸め、要らない区切りを省く（109x109 の枠で誤差0.05以下。判定・表示に影響しない大きさ）。
// 画面の読み込みが約2割軽くなる（GAS では1ファイルに埋め込むので、その分そのまま速くなる）
function compactPath(d) {
  // 命令の文字と数に分けてから、数を丸めて つなぎ直す（数と数の間は、次が負なら区切りなし、そうでなければ ,）
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
  let out = '', prevNum = false;
  for (const t of toks) {
    if (/^[a-zA-Z]$/.test(t)) { out += t; prevNum = false; continue; }
    const v = Math.round(parseFloat(t) * 10) / 10 || 0; // -0 は 0
    const str = String(v);
    out += (prevNum && v >= 0 ? ',' : '') + str;
    prevNum = true;
  }
  return out;
}
fs.mkdirSync(KVG_CACHE, { recursive: true });
const strokes = {};
const allChars = GRADES.flatMap((g) => orders[g]);
for (const c of allChars) {
  const fn = c.codePointAt(0).toString(16).padStart(5, '0') + '.svg';
  const fp = path.join(KVG_CACHE, fn);
  if (!fs.existsSync(fp)) {
    const res = await fetch(`https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${fn}`);
    if (!res.ok) { err(`${c}: KanjiVG取得失敗 ${res.status}`); continue; }
    fs.writeFileSync(fp, await res.text());
  }
  const svg = fs.readFileSync(fp, 'utf8');
  const ps = [...svg.matchAll(/<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*?\sd="([^"]+)"/g)]
    .map((m) => [Number(m[1]), m[2].replace(/\s+/g, ' ').trim()])
    .sort((a, b) => a[0] - b[0]);
  if (ps.some((p, i) => p[0] !== i + 1)) err(`${c}: KanjiVGの画番号が連番でない`);
  const expect = byChar.get(c).strokeCounts[0];
  if (ps.length !== expect) err(`${c}: KanjiVGの画数${ps.length}が辞書の画数${expect}と違う`);
  strokes[c] = ps.map((p) => compactPath(p[1]));
}

// ---- ひらがな・カタカナ（1年。清音46字ずつ。漢字ではないが、見る・かくを同じ形で学習する）
// 正本は data-src/kana-hira.txt・kana-kata.txt（字|画数|例語）。画数は教科書の標準で、KanjiVG の画数と一致することを検査する
const KANA = { h: { file: 'kana-hira.txt', re: /^[ぁ-ゖー]+$/ }, k: { file: 'kana-kata.txt', re: /^[ァ-ヶー]+$/ } };
const kana = {};
for (const s of Object.keys(KANA)) {
  const rows = lines(KANA[s].file).map((l) => l.split('|'));
  if (rows.length !== 46 || new Set(rows.map((r) => r[0])).size !== 46) err(`${KANA[s].file}: 46字ちょうど・重複なしでない（${rows.length}行）`);
  KANA[s].order = rows.map((r) => r[0]).join('');
  for (const [c, n, word] of rows) {
    if (!KANA[s].re.test(c) || c.length !== 1) { err(`${KANA[s].file}: ${c} が1字の${s === 'h' ? 'ひらがな' : 'カタカナ'}でない`); continue; }
    if (word && (!KANA[s].re.test(word) || !word.includes(c))) err(`${KANA[s].file}: ${c} の例語「${word}」がその字を含む${s === 'h' ? 'ひらがな' : 'カタカナ'}だけのことばでない`);
    const fn = c.codePointAt(0).toString(16).padStart(5, '0') + '.svg', fp = path.join(KVG_CACHE, fn);
    if (!fs.existsSync(fp)) {
      const res = await fetch(`https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${fn}`);
      if (!res.ok) { err(`${c}: KanjiVG取得失敗 ${res.status}`); continue; }
      fs.writeFileSync(fp, await res.text());
    }
    const ps = [...fs.readFileSync(fp, 'utf8').matchAll(/<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*?\sd="([^"]+)"/g)]
      .map((m) => [Number(m[1]), m[2].replace(/\s+/g, ' ').trim()]).sort((a, b) => a[0] - b[0]);
    if (ps.length !== Number(n)) err(`${c}: KanjiVGの画数${ps.length}が教科書の画数${n}と違う`);
    strokes[c] = ps.map((p) => compactPath(p[1]));
    // 例語: [ことば, ことばの ひらがな, この字の ひらがな, 'kana']（漢字の例語と同じ並び。カタカナは ひらがなに直した読みを持つ）
    const w = word ? [[word, kata2hira(word), kata2hira(c), 'kana']] : [];
    kana[c] = { s, n: ps.length, w, on: [], kun: [] };
  }
}

if (warns.length) console.log(`--- 目視確認（形態素解析と正本のよみが違う ${warns.length}件。多くは解析側の揺れ）\n` + warns.join('\n'));
if (errors.length) { console.error(`--- エラー ${errors.length}件\n` + errors.join('\n')); process.exit(1); }

// ---- 書き出し
const kanji = {};
for (const g of GRADES) for (const c of orders[g]) kanji[c] = { g, n: strokes[c].length, w: entries.get(c), on: readings.get(c).on, kun: readings.get(c).kun };
const grades = {};
for (const g of GRADES) grades[g] = { order: orders[g].join('') };
for (const s of Object.keys(KANA)) grades[s] = { order: KANA[s].order }; // h＝ひらがな・k＝カタカナ
const head = '// 自動生成（tools/build-data.mjs）。直接編集しない。正本は data-src/。\n';
fs.writeFileSync(path.join(ROOT, 'src', 'data.js'), head + `var KANZI_DATA = ${JSON.stringify({ grades, kanji, kana })};\n`);
fs.writeFileSync(path.join(ROOT, 'src', 'strokes.js'),
  head + '// 筆順データ: KanjiVG (c) Ulrich Apel ほか, CC BY-SA 3.0 https://kanjivg.tagaini.net/\n' +
  '// 各画の SVG path（109x109 座標、書く順）。\n' +
  `var KANZI_STROKES = ${JSON.stringify(strokes)};\n`);
console.log(`OK: ひらがな46字・カタカナ46字、${GRADES.map((g) => g + '年' + orders[g].length + '字').join('・')}、例語${[...entries.values()].reduce((a, w) => a + w.length, 0)}語`);
