// Cloud save behaviour with an in-memory Supabase stand-in (shared by several browser contexts).
// This tests the app's logic only. Real Supabase RLS: test/real/supabase-rls.mjs. Real Google sign-in: manual.
// Run: NODE_PATH=$(npm root -g) node test/cloud-ui.test.cjs
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const { createBackend, MOCK_LIB } = require('./helpers/mock-supabase.cjs');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html');
const GUEST = 'muhaqqiq-taammuli-v2', ACC = 'muhaqqiq-account-v1', IMP = 'muhaqqiq-imported-v1';
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenario_physical_chemical.json'), 'utf8'));
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 7000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

(async () => {
  const b = await chromium.launch(); const be = createBackend(); const errs = [];
  const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'a@example.test' }, B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'b@example.test' };
  const device = async (user, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(e.message)); await pg.exposeFunction('__sb', (op, a, t) => be.handle(op, a, t));
    await pg.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.APP_CONFIG={supabaseUrl:"https://mock.supabase.co",supabaseAnonKey:"anon-public-key"};' }));
    await pg.route('**/supabase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: MOCK_LIB }));
    await pg.route('**/api/sessions', (r) => r.abort());
    await pg.addInitScript((u) => { window.__mockUser = u; }, user);
    await pg.goto(URL + (opts.query || '')); await pg.waitForSelector('#startBtn'); await pg.waitForTimeout(150); return pg;
  };
  const ls = (pg, k) => pg.evaluate((k) => localStorage.getItem(k), k);
  const guestFill = async (pg, text) => { await pg.click('#startBtn'); await pg.fill('#ans', text); await pg.waitForTimeout(50); };
  const rows = () => be.store.sessions;

  // ===== 1. guest use: no sign-in needed, local save, account entry offered, no cloud traffic
  let d1 = await device(A);
  ok(await d1.locator('#googleBtn').isVisible(), 'guest: "save with Google" is offered on the home page');
  ok((await d1.innerText('.acct')).includes('لا يمكن استرجاعها من جهاز آخر'), 'guest: note that unsynced reflections cannot be recovered elsewhere');
  ok(await d1.locator('#evalLi').count() === 1 && await d1.locator('#googleNav').count() === 1, 'guest: sidebar offers sign-in too');
  await guestFill(d1, 'جلسة ضيف');
  ok(JSON.parse(await ls(d1, GUEST)).answers.situation.text === 'جلسة ضيف', 'guest: answers saved locally');
  ok(await ls(d1, ACC) === null && be.store.calls === 0 && rows().length === 0, 'guest: nothing sent to the cloud, no account copy');
  ok((await d1.innerText('#saveNote')).includes('على هذا الجهاز') && !(await d1.innerText('#saveNote')).includes('حسابك'), 'guest: save note mentions this device only');

  // ===== 2. sign in: Google only, minimal scopes, lands on "تأملاتي السابقة", guest session untouched
  await d1.click('[data-go="home"]'); await d1.click('#googleBtn');
  await d1.waitForSelector('.mine-h');
  const oauth = await d1.evaluate(() => window.__oauth);
  ok(oauth.provider === 'google' && oauth.options.scopes === 'email profile' && !/gmail|drive|calendar/i.test(oauth.options.scopes), 'sign-in: provider google with basic scopes only (' + oauth.options.scopes + ')');
  const cfg = await d1.evaluate(() => window.__mockOpts.auth); ok(cfg.flowType === 'pkce', 'sign-in: PKCE flow');
  ok((await d1.innerText('.mine-who')).includes(A.email), 'account page shows the signed-in address');
  ok((await d1.innerText('.mine')).includes('لا توجد جلسات محفوظة'), 'account page: empty list for a new account');
  ok(JSON.parse(await ls(d1, GUEST)).answers.situation.text === 'جلسة ضيف', 'guest session is untouched after signing in');
  ok(rows().length === 0, 'nothing is uploaded automatically on sign-in');
  ok(await d1.locator('.mine-import').isVisible() && (await d1.innerText('.mine-import')).includes('ولن تُحذف'), 'import is offered with consent; the original stays');

  // ===== 3. import after consent: once, no duplicates, original kept
  await d1.click('#importBtn'); await until(() => rows().length === 1);
  ok(rows().length === 1 && rows()[0].answers.situation.text === 'جلسة ضيف' && rows()[0].user_id === A.id, 'import creates one cloud session for the account');
  await d1.waitForSelector('.mine-row'); ok(!(await d1.locator('.mine-import').count()), 'import offer disappears after importing');
  ok(JSON.parse(await ls(d1, GUEST)).answers.situation.text === 'جلسة ضيف', 'import keeps the original local session');
  await d1.evaluate(() => importGuest()); await sleep(300); ok(rows().length === 1, 'importing again does not create a duplicate');

  // ===== 4. account session: separate from guest, saved to cloud, status note
  await d1.click('#mineStart');                                     // new account session (empty working copy)
  await d1.waitForSelector('#ans').catch(() => {});
  if (!(await d1.locator('#ans').count())) { await d1.click('[data-go="session"]'); await d1.waitForSelector('#ans'); }
  await d1.fill('#ans', 'جلسة الحساب');
  ok((await d1.innerText('#saveNote')).length > 0, 'account: save note present');
  await until(() => rows().length === 2); const accRow = rows().find((r) => r.answers.situation && r.answers.situation.text === 'جلسة الحساب');
  ok(!!accRow && accRow.status === 'in_progress' && accRow.step === 0 && !!accRow.id && accRow.rev >= 1 && !!accRow.created_at && !!accRow.updated_at, 'account answers saved to the cloud with id, status, step and dates');
  ok(JSON.parse(await ls(d1, GUEST)).answers.situation.text === 'جلسة ضيف', 'guest copy is still separate from the account session');
  ok((await ls(d1, ACC)) && JSON.parse(await ls(d1, ACC)).uid === A.id, 'account working copy kept under its own key');
  ok(await d1.evaluate(() => /حسابك/.test(document.querySelector('#saveNote').textContent)), 'account: save note mentions the account');

  // ===== 5. restore on another device (separate browser context) with the same account
  const d2 = await device(A); ok(await d2.locator('#googleBtn').isVisible(), 'device 2 starts as guest');
  await d2.click('#googleBtn'); await d2.waitForSelector('.mine-row');
  ok(await d2.locator('.mine-row').count() === 2, 'device 2 sees the account sessions (2)');
  ok((await d2.innerText('.mine')).includes('غير مكتملة') && (await d2.innerText('.mine')).includes('جلسة الحساب'), 'list shows status and a preview');
  await d2.locator('.mine-row', { hasText: 'جلسة الحساب' }).locator('[data-open]').click();
  await d2.waitForSelector('#ans'); ok((await d2.inputValue('#ans')) === 'جلسة الحساب', 'device 2 opens and continues the incomplete session');
  ok(await ls(d2, GUEST) === null, 'device 2 guest storage not created or replaced by opening a cloud session');

  // ===== 6. conflict: device 2 edits, then device 1 edits the same session -> asked, never silent
  await d2.fill('#ans', 'نسخة الجهاز الثاني'); await until(() => rows().some((r) => r.answers.situation.text === 'نسخة الجهاز الثاني'));
  await d1.fill('#ans', 'نسخة الجهاز الأول'); await d1.waitForSelector('#keepLocal', { timeout: 8000 });
  ok(await d1.locator('#keepCloud').isVisible(), 'conflict: both choices are offered');
  ok(rows().some((r) => r.answers.situation.text === 'نسخة الجهاز الثاني') && !rows().some((r) => r.answers.situation.text === 'نسخة الجهاز الأول'), 'conflict: the newer cloud copy was not overwritten');
  await d1.click('#keepCloud'); await sleep(200); ok((await d1.inputValue('#ans')) === 'نسخة الجهاز الثاني', 'conflict: keeping the cloud copy loads it');
  await d1.fill('#ans', 'نسخة الجهاز الأول 2'); await until(() => rows().some((r) => r.answers.situation.text === 'نسخة الجهاز الأول 2'));
  ok(rows().some((r) => r.answers.situation.text === 'نسخة الجهاز الأول 2'), 'after resolving, saving continues normally');
  await d2.fill('#ans', 'الثاني مرة أخرى'); await d2.waitForSelector('#keepLocal', { timeout: 8000 }); await d2.click('#keepLocal');
  await until(() => rows().some((r) => r.answers.situation.text === 'الثاني مرة أخرى')); ok(rows().some((r) => r.answers.situation.text === 'الثاني مرة أخرى'), 'conflict: keeping this device overwrites the cloud copy on purpose');

  // ===== 7. complete session -> status, report from the list
  const done = JSON.parse(JSON.stringify(sc)); await d2.evaluate(([a]) => { state.answers = a; for (const q of QUESTIONS) ans(q); state.view = 'done'; state.step = 11; save(); render(); }, [done.answers]);
  await until(() => rows().some((r) => r.status === 'complete')); ok(rows().some((r) => r.status === 'complete' && r.step === 11), 'a finished session is saved as complete');
  await d2.click('[data-go="mine"]'); await d2.waitForSelector('.mine-row');
  ok(await d2.locator('.mine-row .chip:text-is("مكتملة")').count() === 1, 'list marks the finished session');
  await d2.locator('.mine-row:has(.chip:text-is("مكتملة"))').locator('[data-open]').click(); await d2.waitForSelector('.doc');
  ok(await d2.locator('.notes li').evaluateAll((e) => e.map((x) => x.dataset.rule).join()) === 'D4,A1,I1', 'opening a finished session shows its report (D4, A1, I1)');
  ok(!(await d2.locator('.doc').innerText()).includes(A.email), 'the report does not contain the account address');

  // ===== 8. another account never sees these sessions
  const d3 = await device(B); await d3.click('#googleBtn'); await d3.waitForSelector('.mine');
  ok(await d3.locator('.mine-row').count() === 0 && (await d3.innerText('.mine')).includes('لا توجد جلسات'), 'a different account sees none of the other account\'s sessions');
  const other = await d3.evaluate(async (id) => { const c = window.supabase.createClient(); const r = await c.from('reflection_sessions').select('*').eq('id', id).maybeSingle(); return r; }, rows()[0].id);
  ok(other.data === null, 'a different account cannot fetch another account\'s session by id');
  await d3.click('#mineStart'); await d3.waitForSelector('#ans'); await d3.fill('#ans', 'حساب ب'); await until(() => rows().some((r) => r.user_id === B.id));
  ok(JSON.parse(await ls(d3, ACC)).uid === B.id && rows().filter((r) => r.user_id === B.id).length === 1 && !rows().some((r) => r.user_id === A.id && r.answers.situation && r.answers.situation.text === 'حساب ب'), 'second account has its own working copy and its own cloud row');

  // ===== 9. delete
  await d2.click('[data-go="mine"]'); await d2.waitForSelector('.mine-row'); const before = rows().length;
  await d2.locator('.mine-row').first().locator('[data-del]').click(); ok(await d2.locator('[data-yes]').isVisible(), 'delete asks for confirmation');
  await d2.locator('[data-yes]').click(); await until(() => rows().length === before - 1); ok(rows().length === before - 1, 'delete removes the session from the account');

  // ===== 10. new session in an account keeps the old one
  const n0 = rows().length; await d2.evaluate(([a]) => { ui.page = null; state = { view: 'done', step: 11, answers: a, counted: true }; for (const q of QUESTIONS) ans(q); save(); render(); }, [done.answers]);
  await d2.waitForSelector('#resetBtn'); await d2.click('#resetBtn'); ok((await d2.innerText('#confirmBox')).includes('تبقى جلستك الحالية محفوظة في حسابك'), 'new-session confirmation explains the old one stays');
  await d2.click('#yesReset'); await d2.waitForSelector('#ans'); await d2.fill('#ans', 'جلسة جديدة تمامًا'); await until(() => rows().some((r) => r.answers.situation && r.answers.situation.text === 'جلسة جديدة تمامًا'));
  ok(rows().some((r) => r.answers.situation.text === 'جلسة جديدة تمامًا') && rows().length >= n0 + 1, 'a new account session becomes a new cloud row (old ones remain)');

  // ===== 11. cloud failure: tool keeps working, local copy kept, retried later
  await d2.fill('#ans', 'أثناء انقطاع'); be.store.fail = true; await d2.waitForFunction(() => /تعذر الحفظ/.test(document.querySelector('#saveNote').textContent), null, { timeout: 8000 });
  ok(JSON.parse(await ls(d2, ACC)).state.answers.situation.text === 'أثناء انقطاع', 'cloud failure: answers still saved on the device');
  ok((await d2.inputValue('#ans')) === 'أثناء انقطاع', 'cloud failure: the tool keeps working');
  be.store.fail = false; await d2.evaluate(() => scheduleSync(0)); await until(() => rows().some((r) => r.answers.situation && r.answers.situation.text === 'أثناء انقطاع')); ok(rows().some((r) => r.answers.situation && r.answers.situation.text === 'أثناء انقطاع'), 'cloud failure: saved once the connection returns');

  // ===== 12. sign out: account copy removed from the device, cloud kept, guest untouched
  await d2.fill('#ans', 'آخر تعديل'); be.store.fail = true; await d2.waitForTimeout(300);
  await d2.click('#logoutNav'); await d2.waitForSelector('#outAnyway', { timeout: 8000 });
  ok((await d2.innerText('#syncBanner')).includes('لم تُحفظ'), 'sign-out warns when the last edits are not in the cloud yet');
  await d2.click('#outCancel'); ok(await ls(d2, ACC) !== null, 'cancel keeps the account copy'); be.store.fail = false;
  await d2.evaluate(() => signOutFlow(false)); await d2.waitForSelector('#googleBtn', { timeout: 8000 });
  ok(await ls(d2, ACC) === null, 'sign-out removes the account copy from the device');
  ok(rows().some((r) => r.answers.situation && r.answers.situation.text === 'آخر تعديل'), 'sign-out saved the last edits to the cloud first, and cloud data remains');
  await d2.evaluate(() => { document.body.innerText; }); ok(!(await d2.locator('body').innerText()).includes('آخر تعديل'), 'no account data is shown after sign-out');
  // guest session of device 1 survives sign-out on device 1
  await d1.evaluate(() => signOutFlow(true)); await d1.waitForSelector('#googleBtn'); ok(JSON.parse(await ls(d1, GUEST)).answers.situation.text === 'جلسة ضيف' && await ls(d1, ACC) === null, 'guest session survives sign-out untouched');
  await d1.click('#startBtn'); ok((await d1.inputValue('#ans')) === 'جلسة ضيف', 'after sign-out the guest session is what the page shows');

  // ===== 13. sign-in error and no-config behaviour
  const d4 = await device(A, { query: '?error=access_denied&error_description=denied' });
  ok((await d4.innerText('.acct')).includes('تعذر تسجيل الدخول') && await d4.locator('#startBtn').isVisible(), 'sign-in error: calm message, tool stays usable');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((f) => console.log(' -', f)); await b.close(); process.exit(fail.length ? 1 : 0);
})();
