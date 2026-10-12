/*
 * 全ファイルを 1 枚の HTML にまとめる (テストプレイ用の Artifact にする)。
 *
 *   node build-single.js [出力先]              既定: ./single.html (ふつうの 1 枚 HTML)
 *   node build-single.js [出力先] --artifact   Artifact 用 (外側の <html><head><body> を外す)
 *
 * CSS・JS・アイコンをぜんぶ埋め込む。three.min.js と rapier.js が大きいので 5MB ほどになる。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const args = process.argv.slice(2);
const artifact = args.includes('--artifact');
const out = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'single.html');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let html = read('index.html');

// <link rel="stylesheet"> を <style> に (CSS の中の title.jpg は data URI にする)
const bgJpg = fs.readFileSync(path.join(ROOT, 'bg.jpg')).toString('base64');
const menuJpg = fs.readFileSync(path.join(ROOT, 'menu.jpg')).toString('base64');
const towerJpg = fs.readFileSync(path.join(ROOT, 'tower.jpg')).toString('base64');
const resultJpg = fs.readFileSync(path.join(ROOT, 'result.jpg')).toString('base64');
const extraImgs = ['result-win.jpg', 'result-lose.jpg', 'result-solo.jpg', 'result-solo2.jpg'].map((f) => [f, fs.readFileSync(path.join(ROOT, f)).toString('base64')]);
const iconsPng = fs.readFileSync(path.join(ROOT, 'result-icons.png')).toString('base64');
const titleJpg = fs.readFileSync(path.join(ROOT, 'title.jpg')).toString('base64');
html = html.replace(/<link rel="stylesheet" href="\.\/([^"]+)">/g, (_, f) =>
  `<style>\n${read(f).replace('url("./title.jpg")', `url("data:image/jpeg;base64,${titleJpg}")`).replace('url("./bg.jpg")', `url("data:image/jpeg;base64,${bgJpg}")`).replace('url("./menu.jpg")', `url("data:image/jpeg;base64,${menuJpg}")`).replace('url("./tower.jpg")', `url("data:image/jpeg;base64,${towerJpg}")`).replace('url("./result.jpg")', `url("data:image/jpeg;base64,${resultJpg}")`).replace(/url\("\.\/(result-(?:win|lose|solo2?)\.jpg)"\)/g, (_, f) => `url("data:image/jpeg;base64,${extraImgs.find((e) => e[0] === f)[1]}")`).replace('url("./result-icons.png")', `url("data:image/png;base64,${iconsPng}")`)}\n</style>`);

// アイコン: apple-touch-icon は data URI に、SVG のアイコンも
const png = fs.readFileSync(path.join(ROOT, 'apple-touch-icon.png')).toString('base64');
html = html.replace('<link rel="apple-touch-icon" href="./apple-touch-icon.png">', `<link rel="apple-touch-icon" href="data:image/png;base64,${png}">`);
const svg = fs.readFileSync(path.join(ROOT, 'icon.png')).toString('base64');
html = html.replace('<link rel="icon" href="./icon.png" type="image/png">', `<link rel="icon" href="data:image/png;base64,${svg}" type="image/png">`);

// <script src> を埋め込みに。 "</script>" が中身にあると途中で閉じるので避ける
html = html.replace(/<script src="\.\/([^"]+)"><\/script>/g, (_, f) => {
  const body = read(f).replace(/<\/script/gi, '<\\/script');
  return `<script>\n${body}\n</script>`;
});

if (artifact) {
  // Artifact は公開のときに <!doctype><html><head><body> を自分で巻く。二重にならないよう、
  // 外側のタグと <meta>・<link> (アイコンは公開時に別に渡す) を外し、<title> と中身だけにする。
  // 画面は 100vh ではなく 100% で測る (外側が安全域ぶんの余白を持つため)。
  html = html
    .replace(/<!DOCTYPE html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta [^>]*>\s*/gi, '')
    .replace(/<link [^>]*>\s*/gi, '')
    .replace('height: 100vh;\n  position: relative;', 'height: 100%;\n  position: relative;');
  if (html.includes('100vh')) throw new Error('100vh が残っている');
}

fs.writeFileSync(out, html);
console.log(`${out}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
