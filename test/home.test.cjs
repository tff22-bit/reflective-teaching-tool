// Home page: credits at the bottom, centered title and button, not in header/side/report. Run with Playwright on public/index.html.
const { chromium } = require('playwright'); const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html'); const KEY = 'muhaqqiq-taammuli-v2';
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [n, vp] of [['desktop', { width: 1440, height: 800 }], ['tablet', { width: 768, height: 900 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 320, height: 640 }]]) {
    const pg = await (await b.newContext({ viewport: vp })).newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.route('**/api/sessions', (r) => r.abort());
    await pg.goto(URL); await pg.evaluate(() => document.fonts.ready);
    const t = (await pg.locator('.credits').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
    ok(JSON.stringify(t) === JSON.stringify(['إشراف:', 'د. داليه الغامدي', 'إعداد الطالبات:', 'فاطمه عمر القاسم', 'غدير خالد الزهراني', 'فاطمة علي المنتشري']), `${n}: credits text verbatim and in order`);
    ok(await pg.locator('.top .credits, .side .credits').count() === 0, `${n}: not inside header or side menu`);
    const g = await pg.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const m = document.querySelector('main').getBoundingClientRect();
      return { h2: r('.home-main h2'), btn: r('#startBtn'), cr: r('.credits'), main: m, vw: document.documentElement.clientWidth, hov: document.documentElement.scrollWidth > innerWidth,
        nameSize: parseFloat(getComputedStyle(document.querySelector('.cr-n')).fontSize), h2Size: parseFloat(getComputedStyle(document.querySelector('.home-main h2')).fontSize),
        font: getComputedStyle(document.querySelector('.cr-n')).fontFamily, border: getComputedStyle(document.querySelector('.credits')).borderTopWidth }; });
    ok(g.cr.top >= g.btn.bottom + 8, `${n}: credits sit below the button`);
    ok(!g.hov && g.cr.left >= 0 && g.cr.right <= g.vw + 0.5, `${n}: no overflow`);
    ok(g.nameSize < g.h2Size && g.nameSize >= 13, `${n}: names smaller than the title but readable (${g.nameSize}px)`);
    ok(/Alexandria/.test(g.font) && g.border === '1px', `${n}: Alexandria and a thin separator`);
    const cx = (r) => (r.left + r.right) / 2, mc = (g.main.left + g.main.right) / 2;
    ok(Math.abs(cx(g.h2) - mc) < 3 && Math.abs(cx(g.btn) - mc) < 3, `${n}: title and button stay centered`);
    if (n === 'desktop' || n === 'tablet') { const vc = (g.h2.top + g.btn.bottom) / 2, avail = (g.main.top + g.cr.top) / 2; ok(Math.abs(vc - (g.main.top + g.main.bottom - 0) / 2) < 140, `${n}: main block roughly centered vertically`); }
    await pg.screenshot({ path: `/tmp/shots/home-${n}.png` });
    // after starting, the credits are gone; the report does not contain them
    if (n === 'desktop') {
      await pg.click('#startBtn'); ok(await pg.locator('.credits').count() === 0, 'credits only on the home page');
      const full = { view: 'done', step: 11, counted: true, answers: { situation: { text: 'a' }, action: { sel: ['direct'], text: 'a' }, goal: { sel: ['understanding'] }, reason: { sel: ['judgment'], text: 'a' }, result: { sel: ['clear_improve'] }, blindspots: { sel: ['no_gap'], text: 'a' }, alternatives: { sel: ['consult'] }, evidence: { sel: ['observation'] }, step: { sel: ['new_strategy'], text: 'a' }, measure: { sel: ['participation'] }, learning: { text: 'a' }, reminder: { text: 'a' } } };
      await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, full]); await pg.reload();
      const doc = await pg.locator('#view').innerText(); ok(!/داليه|القاسم|الزهراني|المنتشري|إشراف/.test(doc), 'report (and its PDF) does not contain the credits');
      await pg.emulateMedia({ media: 'print' }); ok(await pg.locator('.credits').count() === 0, 'no credits element on the report page');
    }
  }
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((x) => console.log(' -', x)); await b.close(); process.exit(fail.length ? 1 : 0);
})();
