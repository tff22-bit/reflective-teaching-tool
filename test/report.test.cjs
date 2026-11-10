// Report layout, content integrity and A4 print output.
// Run: NODE_PATH=$(npm root -g) node test/report.test.cjs   (needs Playwright; page counts need no extra tools)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html');
const KEY = 'muhaqqiq-taammuli-v2';
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenario_physical_chemical.json'), 'utf8'));
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const pages = (f) => (fs.readFileSync(f).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
const text = (f, n) => { try { return cp.execFileSync('pdftotext', ['-f', String(n), '-l', String(n), f, '-'], { encoding: 'utf8' }); } catch (e) { return null; } };
const LONG = ' وهذه جملة إضافية طويلة لاختبار التفاف الأسطر وبقاء التقرير مقروءًا عندما تكون الإجابة أطول من المعتاد بكثير.'.repeat(6);

(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (st, vp) => { const pg = await (await b.newContext({ viewport: vp })).newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.route('**/api/sessions', (r) => r.abort());
    await pg.goto(URL); await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, st]); await pg.reload(); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(200); return pg; };
  const pg = await open(sc, { width: 1280, height: 900 });

  // ---- content: every answer once, in the right place; engine result D4, A1, I1
  const rules = await pg.locator('.notes li').evaluateAll((e) => e.map((x) => x.dataset.rule));
  ok(rules.join() === 'D4,A1,I1', 'scenario insights D4, A1, I1: ' + rules);
  const body = await pg.locator('.doc').innerText();
  const count = (t) => body.split(t).length - 1;
  for (const k of ['situation', 'action', 'reason', 'blindspots', 'step', 'learning', 'reminder']) ok(count(sc.answers[k].text) === 1, `free text of ${k} appears exactly once (${count(sc.answers[k].text)})`);
  const labels = await pg.evaluate(() => { const L = {}; for (const q of QUESTIONS) for (const o of q.opts || []) L[q.id + '.' + o.id] = o.label; return L; });
  for (const [k, a] of Object.entries(sc.answers)) for (const id of a.sel || []) ok(count(labels[k + '.' + id]) >= 1, `choice ${k}.${id} is shown`);
  ok(count(labels['alternatives.short_assessment']) === 1 && count(labels['step.short_assessment']) === 1, 'the same word in two questions is shown once per question');
  const heads = await pg.locator('.rh').allInnerTexts();
  ok(JSON.stringify(heads.map((h) => h.replace(/\s+/g, ' ').trim())) === JSON.stringify(['01 موقفي وقراري', '02 ماذا تعلمت من الموقف؟', '03 خطتي للتحسين', '04 رؤى تربوية مقترحة']), 'four numbered sections in order: ' + heads);
  ok((await pg.locator('.dt h2').innerText()) === 'تقريري التأملي' && (await pg.locator('.dt p').innerText()) === 'توثيق الممارسة والتفكير في فرص التحسين', 'title and subtitle');
  ok((await pg.locator('.insights-note').innerText()) === 'رؤى مقترحة بناءً على اختياراتك، لدعم التفكير التأملي وليست تقييمًا لأدائك التدريسي.', 'insights note');
  ok((await pg.locator('.insight h3').allInnerTexts()).join('|') === 'قراءة القرار التدريسي|البدائل والأدلة|توجيه التحسين وقياس الأثر', 'three insight cards in order');
  ok((await pg.locator('.dh-t p').allInnerTexts()).join('|') === 'جامعة الملك عبدالعزيز|كلية التربية|قسم المناهج وطرق التدريس|ماجستير المناهج وطرق التدريس', 'academic letterhead texts');
  const imgs = await pg.locator('.dh img').evaluateAll((e) => e.map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]));
  ok(imgs.length === 2 && imgs.every((x) => x[1]) && imgs[0][0] === 'KAU_logo.png' && imgs[1][0] === 'reflective-investigator-logo.png', 'both logos load from site files');
  ok(!/\d+\s*%|درجة|\/\s*10/.test(body), 'no scores or percentages in the report');
  const ratio = await pg.locator('.dh-uni img').evaluate((i) => +(i.getBoundingClientRect().width / i.getBoundingClientRect().height).toFixed(3));
  ok(ratio === 0.786, 'university logo keeps its proportions: ' + ratio);
  ok(await pg.locator('.doc').evaluate((e) => getComputedStyle(e).direction === 'rtl'), 'RTL direction');

  // ---- screen: desktop and mobile without horizontal overflow; long answers stay readable
  for (const [n, vp] of [['desktop', { width: 1280, height: 900 }], ['tablet', { width: 768, height: 900 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 320, height: 640 }]]) {
    const L = JSON.parse(JSON.stringify(sc)); for (const k of ['situation', 'action', 'reason', 'blindspots', 'step', 'learning', 'reminder']) L.answers[k].text += LONG;
    L.answers.alternatives = { sel: ['other', 'change_method'], other: 'ن'.repeat(250) };
    const p2 = await open(L, vp);
    ok(!(await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${n}: no horizontal scroll with long answers`);
    ok(await p2.locator('.doc *').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)), `${n}: nothing sticks out of the page`);
    await p2.context().close();
  }

  // ---- print: A4, 2 pages for the scenario, UI hidden, no blank page, long text does not break content
  await pg.emulateMedia({ media: 'print' });
  const hidden = await pg.evaluate(() => ['.top', '.side', '.rep-actions'].map((s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; }));
  ok(hidden.every(Boolean), 'print hides header, side menu and buttons');
  const tmp = fs.mkdtempSync('/tmp/reptest-'); const f1 = tmp + '/n.pdf', f2 = tmp + '/l.pdf', f3 = tmp + '/n-bg.pdf';
  await pg.pdf({ path: f1, format: 'A4', preferCSSPageSize: true, printBackground: false });
  await pg.pdf({ path: f3, format: 'A4', preferCSSPageSize: true, printBackground: true });
  ok(pages(f1) === 2 && pages(f3) === 2, 'scenario prints on 2 A4 pages (' + pages(f1) + '/' + pages(f3) + ')');
  ok(/MediaBox\s*\[\s*0\s+0\s+59[45]\.\d+\s+841\.\d+/.test(fs.readFileSync(f1).toString('latin1')), 'page size is A4');
  const Lg = JSON.parse(JSON.stringify(sc)); for (const k of ['situation', 'action', 'reason', 'blindspots', 'step', 'learning', 'reminder']) Lg.answers[k].text += LONG;
  const p3 = await open(Lg, { width: 1280, height: 900 }); await p3.pdf({ path: f2, format: 'A4', preferCSSPageSize: true, printBackground: false });
  ok(pages(f2) >= 3 && pages(f2) <= 4, 'longer answers use 3-4 pages (' + pages(f2) + ')');
  for (const [f, n] of [[f1, pages(f1)], [f2, pages(f2)]]) { const last = text(f, n); if (last !== null) ok(last.replace(/\s+/g, '').length > 80, 'last page is not blank (' + path.basename(f) + ')'); }
  const t1 = text(f1, 1), t2 = text(f1, 2);
  if (t1 !== null) { ok(!/لم يكتمل|تعديل إجاباتي|طباعة التقرير|بدء تأمل جديد/.test(t1 + t2), 'no UI buttons in the PDF text'); ok(t1.includes('جامعة الملك عبدالعزيز') && t1.includes('01'), 'page 1 carries the letterhead and section 01'); }
  else console.log('note: pdftotext not available, PDF text checks skipped');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length, '| scenario pages:', pages(f1), '| long-answer pages:', pages(f2)); fail.forEach((x) => console.log(' -', x));
  await b.close(); process.exit(fail.length ? 1 : 0);
})();
