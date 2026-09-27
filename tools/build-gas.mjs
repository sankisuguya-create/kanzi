// index.html と src/ から GAS 用の gas/Index.html（CSS・JSを埋め込んだ1ファイル）と gas/Scheduler.js を作る。
// gas/ を clasp push すればそのまま動く。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${read(f)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => {
  const js = read(f);
  if (js.includes('</script')) throw new Error(`${f} に </script が含まれる`);
  return `<script>\n${js}</script>`;
});
fs.writeFileSync(path.join(ROOT, 'gas', 'Index.html'), html);
fs.writeFileSync(path.join(ROOT, 'gas', 'Scheduler.js'), '// 自動生成（tools/build-gas.mjs）。正本は src/scheduler.js\n' + read('src/scheduler.js'));
console.log(`gas/Index.html ${(html.length / 1024).toFixed(0)}KB`);
