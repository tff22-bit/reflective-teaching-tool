// Light-only guarantee: the tool must look the same under a light or dark system setting, on screen and in PDF,
// and key text must keep enough contrast. Run: NODE_PATH=$(npm root -g) node test/theme.test.cjs (needs Playwright, Pillow, pdftoppm)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html'); const KEY = 'muhaqqiq-taammuli-v2';
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenario_physical_chemical.json'), 'utf8'));
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const tmp = fs.mkdtempSync('/tmp/theme-');
const py = (code) => cp.execFileSync('python3', ['-I', '-c', code], { encoding: 'utf8' }).trim();
const diff = (a, b) => parseFloat(py(`from PIL import Image,ImageChops;a=Image.open("${a}").convert("RGB");b=Image.open("${b}").convert("RGB");print(0 if a.size==b.size and ImageChops.difference(a,b).getbbox() is None else 1)`));
const stat = (f) => py(`from PIL import Image,ImageStat;im=Image.open("${f}").convert("L");w,h=im.size;c=[im.getpixel(p) for p in [(2,2),(w-3,2),(2,h-3),(w-3,h-3)]];print(round(ImageStat.Stat(im).mean[0],1),min(c),im.getextrema()[0])`).split(' ').map(Number);

const CONTRAST = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); const v = m[1].split(',').map(parseFloat); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lin = (x) => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); };
  const L = (c) => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b);
  const bgOf = (el) => { let layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a === 1) break; } }
    let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  return (sels) => sels.flatMap((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null && (e.textContent || e.placeholder || '').trim()).slice(0, 2).map((e) => {
    const cs = getComputedStyle(e); const fg = parse(e.matches('textarea') && !e.value ? getComputedStyle(e, '::placeholder').color : cs.color); const bg = bgOf(e);
    const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const l1 = L(mixed), l2 = L(bg); const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 600; const large = size >= 24 || (size >= 18.66 && bold);
    return { s, ratio: +ratio.toFixed(2), need: large ? 3 : 4.5 }; }));
})()`;

(async () => {
  const shots = {}; const reps = {};
  for (const scheme of ['light', 'dark']) for (const [vn, vp] of [['m360', { width: 360, height: 740 }], ['desk', { width: 1280, height: 800 }]]) {
    const b = await chromium.launch(); const pg = await (await b.newContext({ colorScheme: scheme, viewport: vp })).newPage(); await pg.route('**/api/sessions', (r) => r.abort());
    await pg.goto(URL); await pg.evaluate(() => document.fonts.ready);
    const cs = await pg.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
    ok(/light/.test(cs.scheme) && /only/.test(cs.scheme) && cs.bg === 'rgb(246, 249, 250)', `${scheme}/${vn}: light-only scheme and light page background (${cs.scheme}, ${cs.bg})`);
    const key = `${scheme}-${vn}`; const sh = (n) => { const f = `${tmp}/${key}-${n}.png`; shots[`${vn}-${n}`] = shots[`${vn}-${n}`] || {}; shots[`${vn}-${n}`][scheme] = f; return f; };
    const rows = []; const measure = async (sels) => pg.evaluate(`${CONTRAST}`.replace(/^/, '') && ((fn) => fn)(0) ? null : null);
    const runC = async (sels) => pg.evaluate(new Function('sels', 'return ' + CONTRAST + '(sels)'), sels);
    await pg.mouse.move(0, 0); await pg.screenshot({ path: sh('home') });
    rows.push(...await runC(['.home-main h2', '.home-main p', '.btn-primary', '.cr-l', '.cr-n', '.nav', '.nav[aria-current="page"]', '.nav:disabled .tag', '.dt']));
    await pg.click('#startBtn'); await pg.fill('#ans', 'نص تجريبي'); await pg.click('#nextBtn');            // Q2: choices + short text
    await pg.locator('.opt').nth(1).click(); await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.mouse.move(0, 0); await pg.waitForTimeout(250);
    await pg.screenshot({ path: sh('q2'), fullPage: true });
    rows.push(...await runC(['.phase', '.q', '.hint', '.opt', '.opt[aria-checked="true"]', '#ans', '.lbl', '.btn-ghost', '.btn-primary', '.saved', '.prog-row']));
    await pg.fill('#ans', ''); rows.push(...await runC(['#ans']));
    await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, sc]); await pg.reload(); await pg.evaluate(() => document.fonts.ready);
    rows.push(...await runC(['.dh-t p', '.dt h2', '.dt p', '.rh', '.field h4', '.ans', '.chip', '.insight h3', '.insight p', '.insights-note', '.stage > h3', '.rep-actions .btn']));
    await pg.locator('.doc').screenshot({ path: sh('report') });
    const bad = rows.filter((r) => r.ratio < r.need); ok(bad.length === 0, `${scheme}/${vn}: text contrast (${rows.length} checks)` + (bad.length ? ' FAILED ' + JSON.stringify(bad) : ''));
    if (scheme === 'dark' && vn === 'm360') {
      // print preview under a dark system setting: white page, dark text, same as light
      await pg.emulateMedia({ media: 'print', colorScheme: 'dark' });
      const pv = await pg.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, doc: getComputedStyle(document.querySelector('.doc')).backgroundColor, ink: getComputedStyle(document.querySelector('.doc')).color }));
      ok(pv.html === 'rgb(255, 255, 255)' && pv.body === 'rgb(255, 255, 255)' && pv.doc === 'rgb(255, 255, 255)', 'print preview (dark system): white page ' + JSON.stringify(pv));
    }
    // PDFs
    await pg.emulateMedia({ media: 'print', colorScheme: scheme });
    for (const bgp of [false, true]) { const f = `${tmp}/${key}-${bgp ? 'bg' : 'nobg'}.pdf`; await pg.pdf({ path: f, format: 'A4', preferCSSPageSize: true, printBackground: bgp });
      cp.execFileSync('pdftoppm', ['-r', '50', '-png', f, f.replace('.pdf', '')]); reps[`${vn}-${bgp}`] = reps[`${vn}-${bgp}`] || {}; reps[`${vn}-${bgp}`][scheme] = f.replace('.pdf', ''); }
    await b.close();
  }
  // identical rendering under light and dark system settings
  for (const [k, v] of Object.entries(shots)) ok(diff(v.light, v.dark) === 0, `screen ${k}: pixel-identical in light and dark system mode`);
  for (const [k, v] of Object.entries(reps)) {
    const pagesL = fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(v.light) + '-') && f.endsWith('.png')).sort();
    const pagesD = fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(v.dark) + '-') && f.endsWith('.png')).sort();
    ok(pagesL.length === pagesD.length && pagesL.length >= 2, `pdf ${k}: same page count light/dark (${pagesL.length}/${pagesD.length})`);
    pagesD.forEach((f, i) => { ok(diff(`${tmp}/${pagesL[i]}`, `${tmp}/${f}`) === 0, `pdf ${k} page ${i + 1}: identical in dark mode`); const [mean, corner, darkest] = stat(`${tmp}/${f}`); ok(corner >= 250 && mean > 235 && darkest < 90, `pdf ${k} page ${i + 1}: white page, dark text (mean ${mean}, corner ${corner}, darkest ${darkest})`); });
  }
  const built = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
  ok(!/prefers-color-scheme\s*:\s*dark|data-theme/.test(built), 'no dark-mode CSS left in the built page');
  ok(/<meta name="color-scheme" content="only light">/.test(built), 'meta color-scheme: only light');
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((x) => console.log(' -', x)); process.exit(fail.length ? 1 : 0);
})();
