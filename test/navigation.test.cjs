// "Next" gating, navigation guards and the optional evidence field of question 5.
// Run: NODE_PATH=$(npm root -g) node test/navigation.test.cjs   (needs Playwright; uses public/index.html)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html'); const KEY = 'muhaqqiq-taammuli-v2';
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenario_physical_chemical.json'), 'utf8'));
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const IDS = ['situation', 'action', 'goal', 'reason', 'result', 'blindspots', 'alternatives', 'evidence', 'step', 'measure', 'learning', 'reminder'];
const EVID_Q = 'ما الدليل الذي اعتمدتِ عليه للحكم على نتيجة تصرفك؟';
const EVID_NOTE = 'اختياري — يمكنك ذكر ملاحظة صفية أو نتيجة تقويم أو استجابة من الطالبات';

(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (st, vp = { width: 1280, height: 900 }) => { const pg = await (await b.newContext({ viewport: vp })).newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.route('**/api/sessions', (r) => r.abort());
    await pg.goto(URL); if (st) { await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, st]); await pg.reload(); } await pg.waitForTimeout(80); return pg; };
  const nextOff = (pg) => pg.locator('#nextBtn').isDisabled();
  const qNo = async (pg) => +(await pg.innerText('.prog-row')).match(/السؤال (\d+)/)[1];
  const stateOf = (pg) => pg.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY);

  // ---- 1. text-only question: empty / whitespace -> disabled; real text -> enabled immediately
  let pg = await open(null); await pg.click('#startBtn');
  ok(await nextOff(pg), 'Q1 empty: next is disabled');
  await pg.locator('#nextBtn').click({ force: true }).catch(() => {}); ok(await qNo(pg) === 1, 'Q1 empty: clicking next does not move');
  await pg.fill('#ans', '   \n  '); ok(await nextOff(pg), 'Q1 spaces only: still disabled');
  await pg.fill('#ans', 'موقف'); ok(!(await nextOff(pg)), 'Q1 text: enabled at once');
  await pg.fill('#ans', ''); ok(await nextOff(pg), 'Q1 text deleted: disabled again');
  await pg.fill('#ans', 'موقف'); await pg.click('#nextBtn'); ok(await qNo(pg) === 2, 'Q1 -> Q2');

  // ---- 2. choice + text (Q2): only the choice -> disabled; then the text -> enabled
  ok(await nextOff(pg), 'Q2 nothing: disabled');
  await pg.locator('.opt').nth(0).click(); ok(await nextOff(pg), 'Q2 choice only: disabled');
  await pg.fill('#ans', 'نص'); ok(!(await nextOff(pg)), 'Q2 choice + text: enabled');
  await pg.fill('#ans', ''); await pg.fill('#ans', 'x'); await pg.click('#nextBtn');
  // ---- Q3 single choice only: enabled by the choice alone
  ok(await qNo(pg) === 3 && await nextOff(pg), 'Q3 single: disabled before choosing'); await pg.locator('.opt').nth(1).click(); ok(!(await nextOff(pg)), 'Q3 single: enabled after one choice');
  // an "other" detail box never gates progress
  await pg.locator('.opt').nth(5).click(); ok(await pg.locator('#otherBox').isVisible() && !(await nextOff(pg)), 'Q3 "other" details are optional');
  await pg.click('#nextBtn');   // Q4 choice+text
  await pg.locator('.opt').nth(1).click(); await pg.fill('#ans', 'سبب'); await pg.click('#nextBtn');   // -> Q5

  // ---- Q5: result + optional evidence field
  ok(await qNo(pg) === 5 && await nextOff(pg), 'Q5: disabled before choosing');
  ok(!(await pg.locator('#extraBox').isVisible()), 'Q5: evidence field hidden until a result is chosen');
  await pg.locator('.opt').nth(2).click();
  ok(await pg.locator('#extraBox').isVisible(), 'Q5: evidence field appears after the choice');
  ok((await pg.innerText('label[for=extra]')).trim() === EVID_Q, 'Q5: evidence question text is verbatim');
  ok((await pg.innerText('#extraBox .opt-note')).trim() === EVID_NOTE, 'Q5: small optional note is verbatim');
  ok((await pg.locator('#extra').evaluate((e) => e.tagName === 'TEXTAREA' && e.classList.contains('sm'))), 'Q5: evidence is a short multi-line textarea');
  const order = await pg.evaluate(() => { const o = document.querySelector('.opts').getBoundingClientRect(), e = document.querySelector('#extraBox').getBoundingClientRect(); return e.top >= o.bottom; });
  ok(order, 'Q5: evidence field sits below the options');
  ok(!(await nextOff(pg)), 'Q5: next enabled with the evidence field left empty');
  ok((await pg.locator('.opt').allInnerTexts()).length === 6 && (await pg.innerText('.q')).trim() === 'ماذا كانت نتيجة تصرفك؟', 'Q5: question and six options unchanged');
  await pg.fill('#extra', 'ملاحظة صفية: بقي ثلاث طالبات دون مشاركة.\nوالسطر الثاني.');
  ok(!(await nextOff(pg)), 'Q5: still enabled with the evidence written');
  let st = await stateOf(pg); ok(st.answers.result.extra === 'ملاحظة صفية: بقي ثلاث طالبات دون مشاركة.\nوالسطر الثاني.' && st.answers.result.sel.join() === 'no_change', 'Q5: evidence saved with the session');
  await pg.reload(); await pg.waitForTimeout(80); ok(await qNo(pg) === 5 && (await pg.inputValue('#extra')).includes('بقي ثلاث طالبات'), 'Q5: evidence restored after reload');
  await pg.click('#prevBtn'); await pg.click('#nextBtn'); ok((await pg.inputValue('#extra')).includes('والسطر الثاني'), 'Q5: evidence kept when navigating away and back');

  // ---- 3. multiple choice (Q6): nothing -> disabled; one option -> enabled (text still required)
  await pg.click('#nextBtn'); ok(await qNo(pg) === 6 && await nextOff(pg), 'Q6: disabled with nothing selected');
  await pg.locator('.opt').nth(1).click(); ok(await nextOff(pg), 'Q6: one option but no text: disabled');
  await pg.fill('#ans', 'ك'); ok(!(await nextOff(pg)), 'Q6: option + text: enabled'); await pg.locator('.opt').nth(1).click(); ok(await nextOff(pg), 'Q6: option removed: disabled');
  await pg.locator('.opt').nth(1).click(); await pg.click('#nextBtn');
  // Q7 multi only
  ok(await qNo(pg) === 7 && await nextOff(pg), 'Q7 multi: disabled'); await pg.locator('.opt').nth(0).click(); ok(!(await nextOff(pg)), 'Q7 multi: one option is enough');
  await pg.locator('.opt').nth(0).click(); ok(await nextOff(pg), 'Q7 multi: deselect -> disabled');

  // ---- 4. other ways to move: side menu, saved position, report links, reload
  await pg.click('[data-go="home"]'); await pg.click('[data-go="session"]'); ok(await qNo(pg) === 7, 'side menu returns to the current (incomplete) question only');
  await pg.click('[data-go="results"]'); ok((await pg.innerText('#view')).includes('لم يكتمل بعد'), 'results link is blocked while incomplete');
  await pg.click('#contBtn'); ok(await qNo(pg) === 7, '"continue" goes to the first incomplete question');
  // forged saved position far ahead is clamped to the first incomplete question
  st = await stateOf(pg); st.step = 11; st.view = 'session'; await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, st]); await pg.reload(); await pg.waitForTimeout(80);
  ok(await qNo(pg) === 7 && await nextOff(pg), 'a saved position beyond the first incomplete question is clamped'); 
  ok((await stateOf(pg)).step === 6, 'clamped position is saved');
  ok(await pg.locator('[data-goto], .stages, .phase-btn').count() === 0, 'no phase buttons or shortcuts on the question screen');
  // back navigation keeps answers
  for (let i = 0; i < 6; i++) await pg.click('#prevBtn'); ok(await qNo(pg) === 1 && (await pg.inputValue('#ans')) === 'موقف', 'back to Q1 keeps the answer'); ok(await pg.locator('#prevBtn').isDisabled(), 'no previous on Q1');

  // ---- 5. complete session: walk forward, edit an earlier answer to empty, cannot pass it again
  await pg.close(); pg = await open({ view: 'session', step: 11, counted: true, answers: sc.answers });
  ok(await qNo(pg) === 12 && !(await nextOff(pg)), 'complete session: Q12 next enabled (finish)');
  for (let i = 0; i < 8; i++) await pg.click('#prevBtn');           // Q4
  ok(await qNo(pg) === 4, 'went back to Q4'); await pg.fill('#ans', ''); ok(await nextOff(pg), 'Q4 emptied: next disabled');
  await pg.click('#prevBtn'); await pg.click('#nextBtn'); ok(await qNo(pg) === 4 && await nextOff(pg), 'cannot pass Q4 again after emptying it');
  await pg.click('[data-go="results"]'); ok((await pg.innerText('#view')).includes('لم يكتمل'), 'report blocked after emptying Q4');
  await pg.click('#contBtn'); ok(await qNo(pg) === 4, 'continue returns to Q4');
  await pg.fill('#ans', 'سبب جديد'); ok(!(await nextOff(pg)), 'Q4 refilled: enabled again');
  await pg.evaluate(() => { state.step = 11; render(); }); ok(await qNo(pg) === 12, 'with everything complete, later questions are reachable again');
  ok((await stateOf(pg)).answers.reason.text === 'سبب جديد', 'edits are saved automatically');

  // ---- 6. report: evidence shown verbatim after the result only when written; no extra page; order kept
  const base = JSON.parse(JSON.stringify(sc)); base.answers.result = { sel: ['undetermined'] };
  pg = await open(base); let rep = await pg.locator('.doc').innerText();
  ok(!rep.includes('الدليل على النتيجة'), 'report: no evidence item when the field is empty');
  const withE = JSON.parse(JSON.stringify(base)); const E = 'لاحظتُ ثلاث إجابات متقاربة\nفي ورقة العمل، ولم يُجرَ تقويم رسمي.'; withE.answers.result = { sel: ['undetermined'], extra: E };
  pg = await open(withE); rep = await pg.locator('.doc').innerText();
  ok(rep.split('الدليل على النتيجة').length === 2 && rep.includes(E.replace('\n', '\n')), 'report: evidence shown once, verbatim');
  const pos = await pg.evaluate(() => { const labels = [...document.querySelectorAll('.rsec:first-of-type .field h4')].map((h) => h.textContent); return labels; });
  ok(pos.join('|') === 'تصرفي|الهدف من التصرف|نتيجة التصرف|الدليل على النتيجة|أسباب اتخاذ القرار', 'report: evidence comes right after the result in section 01: ' + pos);
  ok((await pg.locator('.rh').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()).join('|') === '01 موقفي وقراري|02 ماذا تعلمت من الموقف؟|03 خطتي للتحسين|04 رؤى تربوية مقترحة', 'report: four sections unchanged');
  await pg.emulateMedia({ media: 'print' }); const tmp = fs.mkdtempSync('/tmp/nav-'); await pg.pdf({ path: tmp + '/a.pdf', format: 'A4', preferCSSPageSize: true });
  const pages = (fs.readFileSync(tmp + '/a.pdf').toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length; ok(pages === 2, 'report with evidence still prints on 2 pages (' + pages + ')');
  // ---- 7. analysis unaffected by the evidence text
  const ins = (st) => open(st).then((p) => p.locator('.notes li').evaluateAll((e) => e.map((x) => x.dataset.rule).join()));
  const kw = JSON.parse(JSON.stringify(base)); kw.answers.result = { sel: ['undetermined'], extra: 'مشاعر افتراض سابق ضيق الوقت لم يتغير الموقف تقويم استشارة' };
  ok(await ins(base) === 'D4,A1,I1' && await ins(kw) === 'D4,A1,I1' && await ins(withE) === 'D4,A1,I1', 'analysis identical with or without evidence text (D4,A1,I1)');
  // older saved sessions (no extra field) load and still complete
  const old = JSON.parse(JSON.stringify(sc)); delete (old.answers.result || {}).extra; pg = await open(old); ok((await pg.innerText('#view')).includes('تقريري التأملي'), 'saved sessions without the new field still open the report');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((x) => console.log(' -', x)); await b.close(); process.exit(fail.length ? 1 : 0);
})();
