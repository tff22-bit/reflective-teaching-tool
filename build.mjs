// Wraps src/app.html in a full HTML document and writes public/index.html.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
const src = readFileSync(new URL("./src/app.html", import.meta.url), "utf8");
const cut = src.indexOf('<header class="top">');
if (cut < 0) throw new Error("header marker not found");
const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>[hidden]{display:none!important}html{color-scheme:light}body{margin:0}</style>
${src.slice(0, cut)}</head>
<body>
${src.slice(cut)}</body>
</html>
`;
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
writeFileSync(new URL("./public/index.html", import.meta.url), html);
// The approved banner is served from the site itself at /banner.png.
copyFileSync(new URL("./Reflective Teaching Tool Banner.png", import.meta.url), new URL("./public/banner.png", import.meta.url));
console.log("built public/index.html and public/banner.png");
