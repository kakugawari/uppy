/*
 * 全ファイルを 1 枚の HTML にまとめる (テストプレイ用の Artifact にする)。
 *
 *   node build-single.js [出力先]      既定: ./single.html
 *
 * CSS・JS・アイコンをぜんぶ埋め込む。three.min.js と rapier.js が大きいので 5MB ほどになる。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const out = process.argv[2] || path.join(ROOT, 'single.html');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let html = read('index.html');

// <link rel="stylesheet"> を <style> に
html = html.replace(/<link rel="stylesheet" href="\.\/([^"]+)">/g, (_, f) => `<style>\n${read(f)}\n</style>`);

// アイコン: apple-touch-icon は data URI に、SVG のアイコンも
const png = fs.readFileSync(path.join(ROOT, 'apple-touch-icon.png')).toString('base64');
html = html.replace('<link rel="apple-touch-icon" href="./apple-touch-icon.png">', `<link rel="apple-touch-icon" href="data:image/png;base64,${png}">`);
const svg = Buffer.from(read('icon.svg')).toString('base64');
html = html.replace('<link rel="icon" href="./icon.svg" type="image/svg+xml">', `<link rel="icon" href="data:image/svg+xml;base64,${svg}" type="image/svg+xml">`);

// <script src> を埋め込みに。 "</script>" が中身にあると途中で閉じるので避ける
html = html.replace(/<script src="\.\/([^"]+)"><\/script>/g, (_, f) => {
  const body = read(f).replace(/<\/script/gi, '<\\/script');
  return `<script>\n${body}\n</script>`;
});

fs.writeFileSync(out, html);
console.log(`${out}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
