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
<style>[hidden]{display:none!important}html{color-scheme:only light;background:#f6f9fa}body{margin:0}</style>
${src.slice(0, cut)}</head>
<body>
${src.slice(cut)}</body>
</html>
`;
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
writeFileSync(new URL("./public/index.html", import.meta.url), html);
// Approved logos, served from the site itself (original files stay untouched in the repo root).
const pub = (f) => new URL("./public/" + f, import.meta.url);
copyFileSync(new URL("./KAU_logo.png", import.meta.url), pub("KAU_logo.png"));
copyFileSync(new URL("./Reflective Investigator Logo.png", import.meta.url), pub("reflective-investigator-logo.png"));
console.log("built public/index.html and logos");
