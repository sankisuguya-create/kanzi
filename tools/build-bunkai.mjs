// data-src/bunkai.txt の正本から src/bunkai-data.js を生成し、同時に問題データを検査する。
// 検査に落ちたら書き出さずに終了コード1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'data-src', 'bunkai.txt');
const OUT = path.join(ROOT, 'src', 'bunkai-data.js');

const ROLE = new Set(['主', '述', '修', '接', '独']);
const TARGET_OK = new Set(['主', '述', '修']); // 係り先にできるのは主語・述語・修飾語だけ

// 問題文の漢字は3年配当まで（利用者の決定 2026-10）。{字|よみ} の外の文節にも漢字は書けない（全てルビつきにする）
const KANZI_DATA = (0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'data.js'), 'utf8') + '; KANZI_DATA');
const KANJI_MAX_GRADE = 3;
const kanjiGrade = (c) => KANZI_DATA.kanji[c] && KANZI_DATA.kanji[c].g;
const isKanji = (c) => /[㐀-鿿々]/.test(c);

const errors = [];
const err = (m) => errors.push(m);

const problems = [];
const seen = new Set();
const lines = fs.readFileSync(SRC, 'utf8').split('\n');
lines.forEach((raw, li) => {
  const line = raw.trim();
  const no = li + 1;
  if (!line || line.startsWith('#')) return;
  const parts = line.split(/\s+/);
  const id = parts.shift();
  if (!/^b\d+$/.test(id)) { err(`${no}行目: id が bNN の形ではない (${id})`); return; }
  if (seen.has(id)) { err(`${no}行目: id が重複 (${id})`); return; }
  seen.add(id);

  const segs = parts.map((p, si) => {
    const m = p.match(/^(.+?)=(主|述|修|接|独)(?:>(\d+))?$/);
    if (!m) { err(`${no}行目 ${si + 1}番目の文節: 書式が不正 (${p})`); return null; }
    const [, t, r, mo] = m;
    if (!t) err(`${no}行目 ${si + 1}番目: 文節の字がない`);
    // 漢字は {字|よみ} の中にだけ書け、3年配当まで。よみは ひらがなだけ
    t.replace(/\{([^|}]*)\|([^}]*)\}|./gs, (_, rb, rt, off) => {
      const inside = rb !== undefined;
      const s = inside ? rb : _;
      for (const ch of s) {
        if (!isKanji(ch)) continue;
        if (!inside) err(`${no}行目 ${si + 1}番目 (${t}): 漢字「${ch}」は {字|よみ} の中に書く`);
        else if (!(kanjiGrade(ch) <= KANJI_MAX_GRADE)) err(`${no}行目 ${si + 1}番目 (${t}): 「${ch}」は${kanjiGrade(ch) || '配当外'}の字（${KANJI_MAX_GRADE}年まで）`);
      }
      if (inside && !/^[ぁ-ゖー]+$/.test(rt)) err(`${no}行目 ${si + 1}番目 (${t}): ルビ「${rt}」は ひらがなにする`);
      return '';
    });
    if (r === '修' && !mo) err(`${no}行目 ${si + 1}番目 (${t}): 修飾語に係り先番号がない`);
    if (r !== '修' && mo) err(`${no}行目 ${si + 1}番目 (${t}): ${r}に係り先は付けられない`);
    return { t, r, m: mo ? +mo : 0 };
  });
  if (segs.some((s) => !s)) return;
  if (segs.length < 2 || segs.length > 8) err(`${no}行目: 文節の数が 2〜8 でない (${segs.length})`);
  if (segs.filter((s) => s.r === '述').length !== 1) err(`${no}行目: 述語がちょうど1つではない`);
  if (segs.filter((s) => s.r === '主').length > 1) err(`${no}行目: 主語が2つ以上ある`);
  segs.forEach((s, si) => {
    if (!s.m) return;
    if (s.m < 1 || s.m > segs.length) { err(`${no}行目 ${si + 1}番目 (${s.t}): 係り先番号 ${s.m} が範囲外`); return; }
    if (s.m === si + 1) err(`${no}行目 ${si + 1}番目 (${s.t}): 自分自身に係っている`);
    else if (!TARGET_OK.has(segs[s.m - 1].r)) err(`${no}行目 ${si + 1}番目 (${s.t}): 係り先が ${segs[s.m - 1].r} (係れるのは主・述・修)`);
  });
  problems.push({ id, segs: segs.map((s) => ({ t: s.t, r: s.r, m: s.m })) });
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
fs.writeFileSync(OUT, '// 自動生成（tools/build-bunkai.mjs ← data-src/bunkai.txt）。手で直さない。\nvar KANZI_BUNKAI = ' + JSON.stringify(problems, null, 1) + ';\n');
console.log(`${problems.length}件の問題 → src/bunkai-data.js`);
