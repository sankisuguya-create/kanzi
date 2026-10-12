// れんしゅうプリントの問題文（data-src/tprint-gN.txt）を検査して src/tprint-data.js を作る。
// 書式: 1行1字 `字|文;文;...`。文の中の [字|よみ] が答えの四角（1字だけ。よみは四角のルビ）、
//   [字|よみ]<おくり> は送りがなの問題（四角の字＋送りがなを答える。問題では よみ＋送りがなを ひらがなで見せる）、
//   {字|よみ} は学年より上の字のルビ。
// 検査（通らない文は書き出さない。字ごとに四角の問題が1つも残らなければエラー）:
//   1. 四角の字はその行の字。文の中のほかの漢字は その学年までの配当漢字（それ以外は {字|よみ} でルビ）
//   2. 形態素解析（kuromoji・IPADIC）で、文が辞書の語だけで読め、四角の字の読みが ルビのよみ と合う
//   3. 答えが一意: 四角の字を、同じ読み（連濁・促音化も含む）を持つ ほかの配当漢字のうち その学年までに習う字に入れ替えて
//      （その学年の子が答えに書けるのは その学年までの字。たとえば1年の「□を見る（した）」に6年の 舌 は入らない）、
//      辞書の語だけで・元の文と同じ区切りと品詞で・同じ読みになる文が1つでもできれば、その文は使わない
//      （「あつい」の 暑い／熱い／厚い のように、どれも辞書の語になる文は文脈によらず除く。厳しめの基準）
//   4. 辞書の上では語になるが、文の意味から入らないと目で確かめた字は、文の後ろに !字 と書いて除ける
//      （例: 赤組に[負|ま]<ける>。!巻 ＝「巻ける」は語だが「赤組に巻ける」は文にならない）。
//      除けた字は docs/tprint-report.txt の「目視で除外」に全部出す（あとから見直せるように）。検査で引っかからない字を書いたら警告
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D = new Function(fs.readFileSync(path.join(ROOT, 'src/data.js'), 'utf8') + ';return KANZI_DATA;')();
const kuromoji = require('kuromoji');
const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji')), '..', 'dict') }).build((e, t) => (e ? rej(e) : res(t))));

const kata2hira = (s) => String(s).replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const KANJI = /[一-鿿々]/;
const VOICE = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const HALF = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
// 字の読み（ひらがな）。音はひらがなに、訓は送りがなの前まで。連濁・半濁・促音化の形も足す
const readCache = {};
function readingsOf(k) {
  if (readCache[k]) return readCache[k];
  const info = D.kanji[k], out = new Set();
  info.on.forEach((r) => out.add(kata2hira(r)));
  info.kun.forEach((r) => { out.add(r.split('.')[0].replace(/-/g, '')); });
  // 例語の中で その字が実際に読まれる形（連濁などを含む）
  info.w.forEach((w) => out.add(w[2]));
  for (const r of [...out]) {
    const h = r.charAt(0);
    if (VOICE[h]) out.add(VOICE[h] + r.slice(1));
    if (HALF[h]) out.add(HALF[h] + r.slice(1));
    if (/[つくちき]$/.test(r) && r.length > 1) out.add(r.slice(0, -1) + 'っ');
  }
  return (readCache[k] = out);
}
const ALL = Object.keys(D.kanji);
// よみ → その読みを持つ配当漢字
const byReading = {};
for (const k of ALL) for (const r of readingsOf(k)) (byReading[r] = byReading[r] || []).push(k);

function parse(s) {
  // → { pre, box, rt, okuri, post, surface, plain(ルビのよみつき表示用) }
  const m = s.match(/^(.*?)\[([^|\]]+)\|([^\]]+)\](?:<([ぁ-ゖ]+)>)?(.*)$/);
  if (!m || /\[/.test(m[5])) return null;
  return { pre: m[1], box: m[2], rt: m[3], okuri: m[4] || '', post: m[5] };
}
const strip = (s) => s.replace(/\{([^|}]+)\|[^}]+\}/g, '$1');
function readAll(surface) {
  const toks = tokenizer.tokenize(surface);
  return { known: toks.every((t) => t.word_type === 'KNOWN' || !KANJI.test(t.surface_form)), reading: kata2hira(toks.map((t) => t.reading || t.surface_form).join('')), toks,
    sig: toks.map((t) => t.surface_form.length + ':' + t.pos + ':' + t.pos_detail_1).join(' ') };
}

const out = {}, report = [];
let total = 0, kept = 0;
for (let g = 1; g <= 6; g++) {
  const file = path.join(ROOT, 'data-src', `tprint-g${g}.txt`);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const line of lines) {
    const [c, body] = line.split('|').length >= 2 ? [line.slice(0, line.indexOf('|')), line.slice(line.indexOf('|') + 1)] : [null, null];
    if (!c || !D.kanji[c]) { report.push(`g${g}: 行の字が配当漢字ではない: ${line}`); continue; }
    if (D.kanji[c].g !== g) report.push(`g${g}: ${c} は ${D.kanji[c].g}年の字`);
    const list = [];
    for (const raw0 of body.split(';').map((x) => x.trim()).filter(Boolean)) {
      total++;
      const ex = raw0.match(/!([^\s!]+)$/), raw = ex ? raw0.slice(0, ex.index).trim() : raw0, allow = new Set(ex ? [...ex[1]] : []);
      const p = parse(raw), why = [];
      if (!p) { report.push(`${c}: 書式: ${raw}`); continue; }
      if (p.box !== c) why.push('四角の字が行の字と違う');
      const ctx = strip(p.pre) + strip(p.post);
      for (const ch of ctx) if (KANJI.test(ch) && !(D.kanji[ch] && D.kanji[ch].g <= g)) {
        // ルビつきなら よい
        if (!new RegExp('\\{' + ch + '\\|').test(p.pre + p.post)) why.push(`${ch} は${g}年までに習わない（{字|よみ}でルビ）`);
      }
      const surface = strip(p.pre) + c + p.okuri + strip(p.post);
      if ([...surface].length < 3) why.push('短すぎる（3字以上の短文にする）');
      const orig = readAll(surface);
      if (!orig.known) why.push('辞書にない語がある: ' + orig.toks.filter((t) => t.word_type !== 'KNOWN').map((t) => t.surface_form).join('/'));
      // 四角の字の読みが ルビと合うか（その字をふくむ語の読みに ルビが入っているか）
      let pos = strip(p.pre).length, acc = 0, cover = null;
      for (const t of orig.toks) { if (pos >= acc && pos < acc + t.surface_form.length) { cover = t; break; } acc += t.surface_form.length; }
      const cr = cover ? kata2hira(cover.reading || cover.surface_form) : '';
      // 1字だけの語（土・目）は 解析の読みが ぶれる（土＝ど）ので、ルビを正とする
      const single = cover && cover.surface_form === c;
      if (!single && !cr.includes(p.rt)) why.push(`読みが合わない（解析: ${cover && cover.surface_form}=${cr}、ルビ: ${p.rt}）`);
      // 一意性
      if (!why.length) {
        const alts = new Set();
        for (const r of [p.rt]) (byReading[r] || []).forEach((k) => { if (k !== c && D.kanji[k].g <= g) alts.add(k); });
        const hit = [];
        for (const k of alts) {
          const a = readAll(strip(p.pre) + k + p.okuri + strip(p.post));
          // 同じ区切り・同じ品詞で、辞書の語だけで、同じ読みになる文 ＝ 別の字でも答えになる
          // （「間ける」のように 字が別の語に分かれてしまう入れ替えは 語にならないので数えない）
          // 解析が 1字の語を ちがう読みで読んでも見のがさないよう、入れ替えた字の語の読みに ルビのよみ が入る時も数える
          let acc2 = 0, ac = null;
          for (const t of a.toks) { if (pos >= acc2 && pos < acc2 + t.surface_form.length) { ac = t; break; } acc2 += t.surface_form.length; }
          const acr = ac ? kata2hira(ac.reading || ac.surface_form) : '';
          if (a.known && a.sig === orig.sig && (a.reading === orig.reading || acr.includes(p.rt))) hit.push(k);
        }
        const bad = hit.filter((k) => !allow.has(k));
        if (bad.length) why.push(`一意でない（${bad.join('')}でも読める）`);
        else if (allow.size) {
          [...allow].filter((k) => !hit.includes(k)).forEach((k) => report.push(`警告 ${c}: ${raw} の !${k} は不要（検査で引っかからない）`));
          if (hit.length) report.push(`目視で除外 ${c}: ${raw} … ${hit.join('')}`);
        }
      }
      if (why.length) { report.push(`${c}: ${raw} … ${why.join('・')}`); continue; }
      kept++;
      list.push([p.pre, p.rt, p.post, p.okuri]);
    }
    if (!list.some((x) => !x[3])) report.push(`★ ${c}: 四角の問題が1つも残らない`);
    out[c] = list;
  }
}
const missing = ALL.filter((k) => !out[k] || !out[k].some((x) => !x[3]));
fs.writeFileSync(path.join(ROOT, 'docs', 'tprint-report.txt'), report.join('\n') + '\n');
console.log(`文 ${kept}/${total} を採用。四角の問題が無い字 ${missing.length}（docs/tprint-report.txt）`);
if (process.argv.includes('--check')) process.exit(0);
if (missing.length) { console.error('四角の問題が無い字: ' + missing.join('')); process.exit(1); }
fs.writeFileSync(path.join(ROOT, 'src', 'tprint-data.js'),
  '// 自動生成（tools/build-tprint.mjs）。正本は data-src/tprint-gN.txt。\n// { 字: [[四角の前, 四角のよみ, 四角の後, 送りがな], ...] }。前・後の {字|よみ} はルビ\nvar KANZI_TPRINT = ' + JSON.stringify(out) + ';\n');
