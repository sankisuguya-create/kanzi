// data-src/setsumei.txt の正本から src/setsumei-data.js を生成し、同時に検査する（設計書 §27）。
// 検査に落ちたら書き出さずに終了コード1。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const SM = require(path.join(ROOT, 'src', 'setsumei.js'));
const SRC = path.join(ROOT, 'data-src', 'setsumei.txt');
const OUT = path.join(ROOT, 'src', 'setsumei-data.js');

const KANZI_DATA = (0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'data.js'), 'utf8') + '; KANZI_DATA');
const KANJI_MAX_GRADE = 3; // 3年に合わせる（利用者の決定 2026-10）。4年以上・配当外は {字|よみ}
const kanjiGrade = (c) => KANZI_DATA.kanji[c] && KANZI_DATA.kanji[c].g;
const isKanji = (c) => /[㐀-鿿々]/.test(c);

// 型ごとの約束: a・b の種類、c（いちばん つたえたい こと）の置き場
const TYPE = {
  '問い': { a: 'toi', b: 'kotae', c: 'おわり' },
  '尾括': { a: 'wadai', b: 'rei', c: 'おわり' },
  '双括': { a: 'kangae', b: 'wake', c: '両方' },
  '頭括': { a: 'kangae', b: 'wake', c: 'はじめ' },
};

const errors = [];
const texts = [];
let cur = null;

function finish() {
  if (!cur) return;
  const t = cur, E = (m) => errors.push(`${t.id}: ${m}`);
  const n = t.paras.length;
  if (n < 6 || n > 7) E(`段落が ${n}（6〜7にする）`);
  t.paras.forEach((p, i) => { if (!p) E(`${i + 1}段落めがない`); });
  if (!t.cut) { E('切= がない'); return; }
  const [h, m] = t.cut;
  if (!(h >= 1 && m > h && m < n)) E(`切= が はじめ・中・おわり に分かれていない (${h},${m},${n})`);
  const part = (pi) => (pi <= h ? 'はじめ' : pi <= m ? '中' : 'おわり');
  const sentOk = (ref) => { const [p, s] = ref.split('.').map(Number); return t.paras[p - 1] && s >= 1 && s <= t.paras[p - 1].length; };
  const pOf = (ref) => +ref.split('.')[0];
  for (const k of ['a', 'b', 'c']) {
    if (!t[k]) { E(`${k}= がない`); continue; }
    t[k].g.forEach((g) => g.forEach((r) => { if (!sentOk(r)) E(`${k} の文 ${r} がない`); }));
  }
  const rule = TYPE[t.type];
  if (!rule) { E(`型 ${t.type} が不明`); return; }
  if (t.a && t.a.k !== rule.a) E(`a の種類は ${rule.a}（${t.type}）`);
  if (t.b && t.b.k !== rule.b) E(`b の種類は ${rule.b}（${t.type}）`);
  if (t.a) {
    if (t.a.g.length !== 1) E('a は1つ');
    t.a.g.flat().forEach((r) => { if (part(pOf(r)) !== 'はじめ') E(`a の文 ${r} が はじめ にない`); });
  }
  if (t.b) {
    // 中の段落ごとに ちょうど1つのまとまり
    const want = []; for (let p = h + 1; p <= m; p++) want.push(p);
    const got = t.b.g.map((g) => { const ps = new Set(g.map(pOf)); if (ps.size !== 1) E(`b のまとまり ${g.join('/')} が段落をまたぐ`); return pOf(g[0]); });
    if (got.join() !== want.join()) E(`b は中の段落 ${want.join(',')} に1つずつ（いま ${got.join(',')}）`);
  }
  if (t.c) {
    const parts = t.c.g.map((g) => { const ps = new Set(g.map((r) => part(pOf(r)))); if (ps.size !== 1) E(`c のまとまり ${g.join('/')} が部分をまたぐ`); return part(pOf(g[0])); });
    if (parts.includes('中')) E('c が 中 にある');
    const has = (x) => parts.includes(x);
    if (rule.c === 'おわり' && (!has('おわり') || has('はじめ'))) E('c は おわり だけ');
    if (rule.c === 'はじめ' && (!has('はじめ') || has('おわり'))) E('c は はじめ だけ');
    if (rule.c === '両方' && !(has('はじめ') && has('おわり'))) E('c は はじめ と おわり の両方');
    if (rule.c !== 'おわり' && t.a && !t.c.g.some((g) => g.includes(t.a.g[0][0]))) E('考えの文（a）が c に入っていない');
  }
  // 漢字（ルビの外は3年配当まで）とルビの書式
  t.paras.forEach((p, pi) => (p || []).forEach((s, si) => {
    const where = `${pi + 1}.${si + 1}`;
    if (/[{}|]/.test(s.replace(/\{[^|{}]+\|[^|{}]+\}/g, ''))) E(`${where}: {字|よみ} の書き方`);
    for (const mm of s.matchAll(/\{([^|}]+)\|([^}]+)\}/g)) {
      if (!/^[ぁ-ゖー]+$/.test(mm[2])) E(`${where}: ルビ「${mm[2]}」は ひらがな`);
      if ([...mm[1]].every((c) => kanjiGrade(c) <= KANJI_MAX_GRADE)) E(`${where}: {${mm[1]}} は${KANJI_MAX_GRADE}年までの字なのでルビ不要`);
    }
    for (const c of s.replace(/\{[^|}]+\|[^}]+\}/g, '')) {
      if (isKanji(c) && !(kanjiGrade(c) <= KANJI_MAX_GRADE)) E(`${where}: 「${c}」は${kanjiGrade(c) ? kanjiGrade(c) + '年' : '配当外'}の字 → {${c}|よみ}`);
    }
  }));
  // 画面に収まるか
  const cols = (t.paras.filter(Boolean)).reduce((a, p) => a + SM.layout(p).length, 0);
  if (cols > SM.MAX_COLS) E(`行が ${cols}（${SM.MAX_COLS}まで）`);
  t.cols = cols;
  texts.push(t);
}

const groups = (s) => s.split(',').map((g) => g.split('/'));
fs.readFileSync(SRC, 'utf8').split('\n').forEach((raw, li) => {
  const line = raw.trim(), no = li + 1;
  if (!line || line.startsWith('#')) return;
  let mm;
  if ((mm = line.match(/^@(s\d+)\s+型=(\S+)\s+難=([ABC])\s+題=(.+)$/))) {
    finish();
    if (texts.some((t) => t.id === mm[1])) errors.push(`${no}行目: id が重複 ${mm[1]}`);
    cur = { id: mm[1], type: mm[2], level: mm[3], title: mm[4].trim(), paras: [] };
    return;
  }
  if (!cur) { errors.push(`${no}行目: @ の行より前`); return; }
  if ((mm = line.match(/^切=(\d+)-(\d+)\|(\d+)-(\d+)\|(\d+)(?:-(\d+))?$/))) {
    const [, a1, a2, b1, b2, c1] = mm.map(Number);
    if (a1 !== 1 || b1 !== a2 + 1 || c1 !== b2 + 1) errors.push(`${cur.id}: 切= が続いていない`);
    cur.cut = [a2, b2];
  } else if ((mm = line.match(/^切=(\d+)\|(\d+)-(\d+)\|(\d+)(?:-(\d+))?$/))) {
    const [, a2, b1, b2, c1] = mm.map(Number);
    if (b1 !== a2 + 1 || c1 !== b2 + 1) errors.push(`${cur.id}: 切= が続いていない`);
    cur.cut = [a2, b2];
  } else if ((mm = line.match(/^([ab])=(\w+):([\d./,]+)$/))) cur[mm[1]] = { k: mm[2], g: groups(mm[3]) };
  else if ((mm = line.match(/^c=([\d./,]+)$/))) cur.c = { g: groups(mm[1]) };
  else if ((mm = line.match(/^(\d+) (.+)$/))) {
    const pi = +mm[1];
    if (pi !== cur.paras.length + 1) errors.push(`${cur.id}: 段落番号 ${pi} が順でない`);
    const body = mm[2].trim();
    if (!body.endsWith('。')) errors.push(`${cur.id} ${pi}段落: 「。」で終わっていない`);
    cur.paras.push(body.split(/(?<=。)/).map((s) => s.trim()).filter(Boolean));
  } else errors.push(`${no}行目: 読めない行 (${line})`);
});
finish();

if (texts.length !== 20) errors.push(`文章が ${texts.length}（20にする）`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const out = texts.map((t) => ({
  id: t.id, type: t.type, level: t.level, title: t.title, cut: t.cut,
  a: t.a, b: t.b, c: t.c,
  paras: t.paras.map((p) => p.map((s) => s.replace(/ /g, ''))), // 半角空白は画面では消す
}));
fs.writeFileSync(OUT, '// 自動生成（tools/build-setsumei.mjs ← data-src/setsumei.txt）。手で直さない。\nvar KANZI_SETSUMEI = ' + JSON.stringify(out, null, 1) + ';\n');
console.log(`${out.length}本 → src/setsumei-data.js（行数 ${Math.min(...texts.map((t) => t.cols))}〜${Math.max(...texts.map((t) => t.cols))}）`);
