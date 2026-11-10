// Browser test of questions, answer types, completion rules and the analysis engine.
// Run: NODE_PATH=$(npm root -g) node test/session.test.cjs   (needs Playwright)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html');
const KEY = 'muhaqqiq-taammuli-v2';
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };

// ---- approved text (fixture) parsed independently of the page
const L = fs.readFileSync(path.join(__dirname, 'fixtures/questions_v2.txt'), 'utf8').split('\n').map((l) => l.trim());
const phases = [], Q = []; let cur = null, inO = false;
for (const l of L) {
  if (l.startsWith('المرحلة ')) { phases.push(l); continue; }
  if (/^السؤال \d+$/.test(l)) { cur = { phase: phases.length - 1, opts: [] }; Q.push(cur); inO = false; continue; }
  if (!cur) continue;
  if (l.startsWith('النص: ')) cur.q = l.slice(6);
  else if (l.startsWith('نوع الإجابة: ')) cur.type = l.slice(13);
  else if (l.startsWith('توجيه: ')) cur.hint = l.slice(7);
  else if (l === 'الخيارات:') inO = true;
  else if (l.startsWith('سؤال الكتابة: ')) { cur.writeQ = l.slice(14); inO = false; }
  else if (l.startsWith('- ') && inO) cur.opts.push(l.slice(2));
}
const KIND = { 'كتابة فقط.': 'text', 'كتابة قصيرة فقط.': 'text', 'اختيار واحد + كتابة قصيرة.': 'single_text', 'اختيار واحد فقط.': 'single', 'اختيار متعدد + كتابة قصيرة.': 'multi_text', 'اختيار متعدد فقط.': 'multi' };
const IDS = ['situation', 'action', 'goal', 'reason', 'result', 'blindspots', 'alternatives', 'evidence', 'step', 'measure', 'learning', 'reminder'];

(async () => {
  ok(Q.length === 12 && phases.length === 4, 'fixture parsed');
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/api/sessions', (r) => r.abort());
  await pg.goto(URL);
  const html = await pg.content();
  ok(!/helpBtn|FOLLOW|followFor|followKey/.test(html), 'no help button or old follow-up code left');

  // old (v1) saved data must be ignored
  await pg.evaluate(() => localStorage.setItem('muhaqqiq-taammuli-v1', JSON.stringify({ view: 'done', step: 11, answers: { 0: { text: 'x', choice: 1 } } })));
  await pg.reload(); ok(await pg.locator('#startBtn').innerText() === 'ابدئي جلسة التأمل', 'v1 data ignored (fresh start)');
  await pg.click('#startBtn');

  // ---- walk all 12 questions
  for (let i = 0; i < 12; i++) {
    const q = Q[i], kind = KIND[q.type], id = IDS[i];
    ok((await pg.innerText('.q')).trim() === q.q, `Q${i + 1} text`);
    ok((await pg.innerText('.phase')).trim() === phases[q.phase], `Q${i + 1} phase`);
    const hint = await pg.locator('.hint').count() ? (await pg.innerText('.hint')).replace(/^توجيه:\s*/, '').trim() : '';
    ok(hint === (q.hint || ''), `Q${i + 1} hint`);
    ok(await pg.locator('#helpBtn').count() === 0, `Q${i + 1} no help button`);
    const labels = (await pg.locator('.opt').allInnerTexts()).map((t) => t.trim());
    ok(JSON.stringify(labels) === JSON.stringify(q.opts), `Q${i + 1} options verbatim`);
    const isChoice = kind !== 'text', multi = kind.startsWith('multi'), write = kind === 'text' || kind.endsWith('_text');
    ok((await pg.locator('#ans').count() === 1) === write, `Q${i + 1} write field presence`);
    if (kind.endsWith('_text')) ok((await pg.innerText('label[for=ans]')).trim() === q.writeQ, `Q${i + 1} write prompt`);
    if (kind === 'text') ok((await pg.locator('.opt').count()) === 0, `Q${i + 1} no options`);
    ok((await pg.locator('#other').count() === 1) === (isChoice && q.opts.some((o) => /(آخر|أخرى)\.$/.test(o))), `Q${i + 1} other field exists only with an other option`);
    if (isChoice) {
      const n = labels.length; const chk = async () => pg.locator('.opt[aria-checked="true"]').count();
      ok(await chk() === 0, `Q${i + 1} nothing preselected`);
      await pg.locator('.opt').nth(0).click(); await pg.locator('.opt').nth(1).click();
      if (!multi) ok(await chk() === 1, `Q${i + 1} single keeps one choice`);
      else { ok(await chk() === 2, `Q${i + 1} multi allows two`); await pg.locator('.opt').nth(1).click(); ok(await chk() === 1, `Q${i + 1} multi toggles off`); }
      if (id === 'blindspots') {
        await pg.locator('.opt').nth(5).click(); ok(await chk() === 1 && await pg.locator('.opt').nth(5).getAttribute('aria-checked') === 'true', 'blindspots: "no gap" excludes others');
        await pg.locator('.opt').nth(2).click(); ok(await pg.locator('.opt').nth(5).getAttribute('aria-checked') === 'false', 'blindspots: picking another clears "no gap"');
      }
      const oi = q.opts.findIndex((o) => /(آخر|أخرى)\.$/.test(o));
      if (oi >= 0) {
        ok(!(await pg.locator('#otherBox').isVisible()) || oi <= 1, `Q${i + 1} other hidden unless chosen`);
        await pg.locator('.opt').nth(oi).click(); ok(await pg.locator('#otherBox').isVisible(), `Q${i + 1} other box appears`);
        await pg.fill('#other', 'توضيح'); await pg.locator('.opt').nth(0).click();
        if (!multi) { ok(!(await pg.locator('#otherBox').isVisible()), `Q${i + 1} other hides on switch`); await pg.locator('.opt').nth(oi).click(); ok((await pg.inputValue('#other')) === '', `Q${i + 1} other text cleared`); await pg.locator('.opt').nth(0).click(); }
      }
    }
    if (write) await pg.fill('#ans', 'نص ' + (i + 1));
    if (i < 11) await pg.click('#nextBtn');
  }
  // ---- persistence and back navigation
  await pg.reload(); await pg.waitForTimeout(150);
  ok((await pg.innerText('.prog-row')).includes('السؤال 12'), 'reload keeps step');
  ok((await pg.inputValue('#ans')) === 'نص 12', 'reload keeps text');
  for (let i = 0; i < 6; i++) await pg.click('#prevBtn');
  ok((await pg.innerText('.q')).trim() === Q[5].q, 'back navigation reaches Q6');
  ok(await pg.locator('.opt[aria-checked="true"]').count() >= 1 && (await pg.inputValue('#ans')) === 'نص 6', 'Q6 choice and text kept');

  // ---- completion rules through saved state
  const full = () => ({ view: 'done', step: 11, counted: true, answers: {
    situation: { text: 'a' }, action: { sel: ['direct'], text: 'a' }, goal: { sel: ['understanding'] }, reason: { sel: ['judgment'], text: 'a' },
    result: { sel: ['clear_improve'] }, blindspots: { sel: ['no_gap'], text: 'a' }, alternatives: { sel: ['consult'] }, evidence: { sel: ['observation'] },
    step: { sel: ['new_strategy'], text: 'a' }, measure: { sel: ['participation'] }, learning: { text: 'a' }, reminder: { text: 'a' } } });
  const load = async (st) => { await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, st]); await pg.reload(); await pg.waitForTimeout(100); };
  const body = async () => pg.innerText('#view');
  await load(full()); ok((await body()).includes('تقريري التأملي'), 'complete session shows the report');
  for (let i = 0; i < 12; i++) {
    const s = full(); const id = IDS[i], a = s.answers[id];
    if (a.text) { a.text = '   '; } else a.sel = [];
    await load(s); const t = await body();
    ok(t.includes('تقريرك التأملي لم يكتمل بعد'), `incomplete when ${id} missing`);
    await pg.click('#contBtn'); ok((await pg.innerText('.q')).trim() === Q[i].q, `continue goes to ${id}`);
  }
  // choice+text needs both parts; choice-only needs no text; multi needs at least one
  let s = full(); s.answers.action.sel = []; await load(s); ok((await body()).includes('لم يكتمل'), 'single_text needs the choice');
  s = full(); s.answers.step.text = ''; await load(s); ok((await body()).includes('لم يكتمل'), 'single_text needs the text');
  s = full(); s.answers.goal.sel = ['understanding']; await load(s); ok((await body()).includes('تقريري'), 'single choice alone completes goal');
  s = full(); s.answers.alternatives.sel = ['consult', 'other']; s.answers.alternatives.other = ''; await load(s); ok((await body()).includes('تقريري'), 'other details are optional');
  // stale "other" text is dropped when "other" is not selected
  s = full(); s.answers.alternatives.sel = ['consult']; s.answers.alternatives.other = 'قديم'; await load(s); ok(!(await body()).includes('قديم'), 'stale other text not shown');
  // report shows no old fields
  await load(full()); const rep = await body();
  ok(!/مؤشر المتابعة|عند مواجهة موقف مشابه|ما الدليل الذي سأبحث عنه/.test(rep), 'no old report fields');
  ok(rep.includes('ما الذي سأفعله؟') && rep.includes('كيف سأطبقه؟') && rep.includes('كيف سأتحقق من أثره؟'), 'plan rows present');
  ok(await pg.locator('#evalLi a').count() === 1, 'feedback link when complete');

  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((f) => console.log(' -', f));
  await b.close(); process.exit(fail.length ? 1 : 0);
})();
