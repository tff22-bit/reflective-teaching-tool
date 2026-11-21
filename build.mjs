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
// Optional cloud save: public (browser-safe) Supabase settings come from environment variables at build time.
// Without them config.js is empty and the tool runs as a guest-only tool. Never put a service_role key here.
const url = (process.env.SUPABASE_URL || "").trim(), key = (process.env.SUPABASE_ANON_KEY || "").trim();
writeFileSync(pub("config.js"), `window.APP_CONFIG = ${JSON.stringify(url && key ? { supabaseUrl: url, supabaseAnonKey: key } : {})};\n`);
copyFileSync(new URL("./node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url), pub("supabase.js"));
console.log("built public/index.html, logos and " + (url && key ? "cloud config" : "empty cloud config (guest only)"));
