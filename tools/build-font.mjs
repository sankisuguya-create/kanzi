// 同梱の日本語フォント（最後の受け皿）を作る。端末に日本語フォントが1つもなくても中国語フォントに落ちないようにするため。
// Noto Sans JP（SIL Open Font License 1.1）から、常用漢字・人名用漢字・かな・英数字・アプリ内の文字だけを切り出して woff2 にする。
// 必要: python3 と fonttools・brotli（pip install fonttools brotli）。PYTHON=... で python を指定できる。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, '.cache', 'fonts');
const PY = process.env.PYTHON || 'python3';
fs.mkdirSync(CACHE, { recursive: true });

const chars = new Set();
const add = (s) => { for (const c of s) chars.add(c); };
// 常用漢字（辞書の grade 1〜6・8）と人名用漢字（9・10）
const dic = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'kanjidic2-json', 'KANJIS.json'), 'utf8'));
dic.filter((k) => k.grade >= 1 && k.grade <= 10).forEach((k) => add(k.literal));
// かな・英数字・記号
const range = (a, b) => { for (let i = a; i <= b; i++) chars.add(String.fromCodePoint(i)); };
range(0x20, 0x7e); range(0x3000, 0x303f); range(0x3041, 0x309f); range(0x30a0, 0x30ff); range(0xff01, 0xff5e); range(0xff61, 0xff9f);
add('、。・ー〜…‥「」『』（）【】〈〉《》！？：；＋－×÷＝≠＜＞○●◎□■△▲▽▼◇◆☆★→←↑↓々〆ヶ');
// アプリ内の文字（画面・データ）
for (const f of ['index.html', 'src/app.js', 'src/data.js', 'src/tree.js', 'src/ink.js', 'src/kana.js']) add(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const text = [...chars].filter((c) => c.codePointAt(0) >= 0x20).join('');
fs.writeFileSync(path.join(CACHE, 'subset.txt'), text);

for (const [w, name] of [['Regular', '400'], ['Bold', '700']]) {
  const src = path.join(CACHE, `NotoSansJP-${w}.otf`);
  if (!fs.existsSync(src)) {
    const res = await fetch(`https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-${w}.otf`);
    if (!res.ok) throw new Error(`Noto Sans JP ${w} の取得に失敗 ${res.status}`);
    fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }
  const out = path.join(ROOT, 'src', 'fonts', `mori-jp-${name}.woff2`);
  execFileSync(PY, ['-m', 'fontTools.subset', src, `--text-file=${path.join(CACHE, 'subset.txt')}`, '--flavor=woff2', `--output-file=${out}`,
    '--layout-features=*', '--no-hinting', '--desubroutinize', '--name-IDs=*', '--name-languages=*'], { stdio: 'inherit' });
  console.log(`${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
}
console.log(`文字数 ${[...text].length}`);
