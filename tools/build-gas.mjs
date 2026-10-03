// index.html と src/ から GAS 用の gas/Index.html（CSS・JSを埋め込んだ1ファイル）と gas/Scheduler.js を作る。
// gas/ を clasp push すればそのまま動く。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// クライアント（Index.html のメタ）とサーバー（Scheduler.js の Sched.VER）に同じ版を埋め込み、
// 開いた時にずれていれば古い方で動き続けないようにする（design.md §24）
let VER;
try { VER = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); }
catch { VER = String(Math.floor(Date.now() / 1000)); }
let html = read('index.html');
// 同梱フォントの @font-face は GAS では参照できないので外し、同じ Noto Sans JP を Google Fonts から受け皿として読む
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=block">';
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => {
  const css = read(f).replace(/\/\* @mori-font-start[\s\S]*?@mori-font-end \*\/\n?/, '');
  if (css.includes('fonts/mori-jp')) throw new Error('同梱フォントの指定が残っている');
  return `${FONT_LINK}\n<style>\n${css}</style>`;
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => {
  const js = read(f);
  if (js.includes('</script')) throw new Error(`${f} に </script が含まれる`);
  return `<script>\n${js}</script>`;
});
html = html.replace('</head>', `<meta name="kanzi-ver" content="${VER}">\n</head>`);
fs.writeFileSync(path.join(ROOT, 'gas', 'Index.html'), html);
fs.writeFileSync(path.join(ROOT, 'gas', 'Scheduler.js'), '// 自動生成（tools/build-gas.mjs）。正本は src/scheduler.js\n' + read('src/scheduler.js') + `\n// GAS 版ずれ検知の版（tools/build-gas.mjs が埋め込む）\nSched.VER = ${JSON.stringify(VER)};\n`);
console.log(`gas/Index.html ${(html.length / 1024).toFixed(0)}KB`);
