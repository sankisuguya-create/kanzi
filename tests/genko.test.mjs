// 説明文を書く（§28）の共通部品 src/genko.js の検査: 原稿用紙の組み方・見なおし・テンプレート・お手本
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const G = createRequire(import.meta.url)('../src/genko.js');
const Z = '　';

test('1マス1字・1行20マス・改行は次の行から', () => {
  const L = G.layout('あ'.repeat(25) + '\nい');
  assert.deepEqual([L.cells[19].col, L.cells[19].row], [0, 19]);
  assert.deepEqual([L.cells[20].col, L.cells[20].row], [1, 0], '21字目は次の行の頭');
  assert.deepEqual([L.cells[25].col, L.cells[25].row, L.cells[25].c], [2, 0, 'い'], '段落は新しい行から');
  assert.equal(L.cols, 3);
});
test('行頭禁則: 句読点・閉じかっこは前の行の最後のマスに入れる', () => {
  const L = G.layout('あ'.repeat(20) + '。い');
  const p = L.cells[20];
  assert.equal(p.c, '。'); assert.equal(p.hang, true); assert.deepEqual([p.col, p.row], [0, 19]);
  assert.deepEqual([L.cells[21].col, L.cells[21].row], [1, 0]);
  for (const c of '、」』') assert.equal(G.layout('あ'.repeat(20) + c).cells[20].hang, true, c);
});
test('行末禁則: 開きかっこは行の最後のマスに書かず、次の行へ', () => {
  const L = G.layout('あ'.repeat(19) + '「い」');
  assert.deepEqual([L.cells[19].c, L.cells[19].col, L.cells[19].row], ['「', 1, 0]);
});
test('小さい字は1マスで、印が付く', () => {
  const L = G.layout('はっぱ');
  assert.equal(L.cells[1].small, true); assert.equal(L.cells[1].row, 1);
  assert.ok(!L.cells[0].small);
});
test('カーソルの位置: 末尾・段落の終わり・行が満ちた所', () => {
  const L = G.layout('あい\nう');
  assert.deepEqual(L.pos[2], { col: 0, row: 2 }); // 1段落目の終わり
  assert.deepEqual(L.pos[4], { col: 1, row: 1 }); // 末尾
  const F = G.layout('あ'.repeat(20));
  assert.deepEqual(F.pos[20], { col: 0, row: 19, after: true });
});
test('名前の行: 下につめて、いちばん下は1マスあける', () => {
  const n = G.nameLine('高木　北子');
  assert.equal(n.length, 20); assert.ok(n.endsWith('北子' + Z)); assert.ok(n.startsWith(Z.repeat(14)));
});
test('見なおし: 題名・上をあける・名前・1マスあけ・穴', () => {
  assert.deepEqual(G.check(G.SAMPLE), [], 'お手本は指摘なし');
  const tags = (t) => G.check(t).map((f) => f.tag);
  assert.deepEqual(tags(G.template('はら　ゆうた')), ['あな']);
  assert.deepEqual(tags(G.template('')), ['名前', 'あな']);
  assert.deepEqual(tags('\n名前\n' + Z + 'ほんぶん'), ['題名']);
  assert.deepEqual(tags('題名\n名前\n' + Z + 'ほんぶん'), ['上を あける']);
  assert.deepEqual(tags(Z + Z + Z + '題名\n名前\nほんぶん\n' + Z + 'つぎ\n\n'), ['1マス あける']);
  assert.equal(G.check(Z + Z + Z + '題名\n名前\nほんぶん')[0].line, 2);
  assert.match(G.check(Z + Z + Z + '題名\n名前\n' + Z + 'あ\n\nいい')[0].msg, /^2番目の 段落/, '空の行は数えず、段落の番号で言う');
});
test('テンプレート: 穴は【食材】だけ（題名・はじめ・おわり）、中は空の段落3つ', () => {
  const t = G.template('');
  assert.equal((t.match(/【[^】]*】/g) || []).join(), '【食材】,【食材】,【食材】');
  assert.deepEqual(t.split('\n').slice(3, 6), ['', '', '']);
});
test('お手本: 自作の「すがたをかえる葉っぱ」が原稿用紙1枚に収まる', () => {
  assert.ok(G.SAMPLE.startsWith(Z + Z + Z + 'すがたをかえる葉っぱ\n'));
  assert.ok(G.SAMPLE.split('\n')[1].endsWith('高木　北子' + Z));
  assert.equal(G.pages(G.layout(G.SAMPLE).cols), 1);
});
test('全角にそろえる・作品の形をそろえる', () => {
  assert.equal(G.toZen('ab 1\r'), 'ａｂ　１');
  const w = G.normWork({ id: 'w1', text: 'x'.repeat(5000), show: 1, comments: { 2: 'よい', 9999: 'x', 3: '' } });
  assert.equal(w.text.length, G.MAX_CHARS); assert.equal(w.show, true); assert.equal(w.mode, 'tpl');
  assert.deepEqual(Object.keys(w.comments), ['2']); assert.equal(w.comments[2].t, 'よい');
});
test('段落の入れかえ: となりの段落と入れかえ、題名・名前の行は動かさない', () => {
  const t = ['題', '名', 'あ', 'い', 'う'].join('\n');
  const r = G.moveParagraph(t, 3, -1);
  assert.equal(r.text, ['題', '名', 'い', 'あ', 'う'].join('\n'));
  assert.deepEqual(r.map, { 2: 3, 3: 2 });
  assert.equal(G.moveParagraph(t, 2, -1), null, '本文の最初より前へは動かない');
  assert.equal(G.moveParagraph(t, 4, 1), null, '最後より後ろへは動かない');
  assert.equal(G.moveParagraph(t, 1, 1), null, '名前の行は動かさない');
});
test('段落の入れかえ: コメントの付け先も一緒に移る（続けて入れかえても合う）', () => {
  let m = G.composeMap({}, { 2: 3, 3: 2 }); // あ・い を入れかえ
  m = G.composeMap(m, { 3: 4, 4: 3 });     // 続けて あ（いま3）・う を入れかえ → い・う・あ
  assert.deepEqual(m, { 2: 4, 3: 2, 4: 3 });
  assert.deepEqual(G.remapComments({ 2: 'あへ', 4: 'うへ' }, m), { 4: 'あへ', 3: 'うへ' });
  assert.deepEqual(G.composeMap({ 2: 3, 3: 2 }, { 2: 3, 3: 2 }), {}, 'もとにもどせば移し方は空');
});
