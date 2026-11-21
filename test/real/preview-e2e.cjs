// REAL end-to-end test of a deployed preview against the real Supabase project.
// Google's consent screen needs a person, so sessions are created for TEMPORARY test users with the admin API and
// placed in the browser storage exactly where Supabase Auth keeps a signed-in session. Everything after that
// (saving, restoring on a second browser context, import, conflict-free saves, sign-out, isolation) is the real app,
// real Netlify build and real database. The test users and their rows are deleted at the end.
// Env: PREVIEW_URL, SB_URL, SB_ANON, SB_SERVICE (never printed).
const { chromium } = require('playwright'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { PREVIEW_URL, SB_URL, SB_ANON, SB_SERVICE } = process.env;
if (!PREVIEW_URL || !SB_URL || !SB_ANON || !SB_SERVICE) { console.error('missing env'); process.exit(2); }
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/scenario_physical_chemical.json'), 'utf8'));
const REF = new URL(SB_URL).host.split('.')[0], AUTH_KEY = `sb-${REF}-auth-token`;
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
const api = async (p, { method = 'GET', token, body, key = SB_ANON } = {}) => { const r = await fetch(SB_URL + p, { method, headers: { apikey: key, Authorization: 'Bearer ' + (token || key), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j }; };
const adminApi = (p, o = {}) => api(p, { ...o, token: SB_SERVICE, key: SB_SERVICE });
const mkUser = async (tag) => {
  const email = `e2e-${tag}-${crypto.randomBytes(4).toString('hex')}@example.org`, password = crypto.randomBytes(18).toString('base64url');
  const c = await adminApi('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
  const t = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!c.json || !c.json.id || !t.json || !t.json.access_token) throw new Error('cannot create test user');
  return { id: c.json.id, email, session: t.json };
};
const rowsOf = async (uid) => (await adminApi(`/rest/v1/reflection_sessions?user_id=eq.${uid}&select=*&order=created_at.asc`)).json || [];

(async () => {
  const users = []; let b;
  try {
    const A = await mkUser('a'); users.push(A); const B = await mkUser('b'); users.push(B);
    b = await chromium.launch(); const errs = [];
    const device = async (user, guest) => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.addInitScript(([k, s, g, gk]) => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); if (s) { localStorage.setItem(k, JSON.stringify(s)); sessionStorage.setItem('muhaqqiq-login-pending', '1'); } if (g) localStorage.setItem(gk, JSON.stringify(g)); } } catch (e) {} }, [AUTH_KEY, user && user.session, guest, 'muhaqqiq-taammuli-v2']);
      await pg.goto(PREVIEW_URL + '/'); await pg.waitForTimeout(1500); return pg;
    };
    const ls = (pg, k) => pg.evaluate((k) => localStorage.getItem(k), k);
    const guest = { view: 'session', step: 0, counted: true, answers: { situation: { sel: [], text: 'جلسة ضيف على الجهاز', other: '', extra: '' } } };

    // 1. guest: tool works without an account on the real deployment
    const g = await device(null); await g.waitForSelector('#startBtn');
    ok(await g.locator('#googleBtn').isVisible(), 'preview, guest: sign-in is offered but optional');
    await g.click('#startBtn'); await g.fill('#ans', 'ضيف بلا حساب'); await g.waitForTimeout(400);
    ok(JSON.parse(await ls(g, 'muhaqqiq-taammuli-v2')).answers.situation.text === 'ضيف بلا حساب', 'preview, guest: answers saved locally without an account');
    ok(!(await adminApi('/rest/v1/reflection_sessions?select=id')).json.length, 'preview, guest: nothing reaches the database');

    // 2. signed-in device 1 (with a guest session on the device)
    const d1 = await device(A, guest); await d1.waitForSelector('.mine-h', { timeout: 15000 });
    ok((await d1.innerText('.mine-who')).includes(A.email), 'real Supabase session recognised; account page opens');
    ok(await d1.locator('.mine-import').isVisible(), 'guest session on the device is offered for import (not uploaded automatically)');
    ok((await rowsOf(A.id)).length === 0, 'nothing uploaded before consent');
    await d1.click('#importBtn'); ok(await until(async () => (await rowsOf(A.id)).length === 1), 'import (after consent) creates exactly one cloud session');
    await d1.waitForSelector('.mine-row'); await d1.evaluate(() => importGuest()); await sleep(800); ok((await rowsOf(A.id)).length === 1, 'importing twice does not duplicate');
    ok(JSON.parse(await ls(d1, 'muhaqqiq-taammuli-v2')).answers.situation.text === 'جلسة ضيف على الجهاز', 'original guest session still on the device');

    // 3. save a new account session, then restore it on another device
    await d1.click('#mineStart'); await d1.waitForSelector('#ans'); await d1.fill('#ans', 'تأمل الحساب - الجهاز الأول');
    ok(await until(async () => (await rowsOf(A.id)).some((r) => r.answers.situation && r.answers.situation.text === 'تأمل الحساب - الجهاز الأول')), 'account answers saved to the real database');
    const row = (await rowsOf(A.id)).find((r) => r.answers.situation.text.startsWith('تأمل الحساب'));
    ok(row.status === 'in_progress' && row.user_id === A.id && row.rev >= 1 && !!row.created_at && !!row.updated_at, 'row has owner, status, revision and dates');
    ok(JSON.parse(await ls(d1, 'muhaqqiq-account-v1')).uid === A.id && JSON.parse(await ls(d1, 'muhaqqiq-taammuli-v2')).answers.situation.text === 'جلسة ضيف على الجهاز', 'account copy and guest copy are separate');

    const d2 = await device({ ...A, session: (await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: A.session.refresh_token } })).json });
    await d2.waitForSelector('.mine-row', { timeout: 15000 }); ok(await d2.locator('.mine-row').count() === 2, 'device 2 (separate browser context) lists both sessions');
    await d2.locator('.mine-row', { hasText: 'تأمل الحساب' }).locator('[data-open]').click(); await d2.waitForSelector('#ans');
    ok((await d2.inputValue('#ans')) === 'تأمل الحساب - الجهاز الأول', 'device 2 restores the incomplete session and can continue it');
    ok(await ls(d2, 'muhaqqiq-taammuli-v2') === null, 'device 2 guest storage untouched');

    // 4. complete it on device 2 -> complete in the cloud, report restorable
    await d2.evaluate(([a]) => { state.answers = a; for (const q of QUESTIONS) ans(q); state.view = 'done'; state.step = 11; save(); render(); }, [sc.answers]);
    ok(await until(async () => (await rowsOf(A.id)).some((r) => r.status === 'complete' && r.step === 11)), 'completed session saved as complete');
    await d1.evaluate(() => go('mine')); await d1.waitForSelector('.mine-row .chip:text-is("مكتملة")', { timeout: 10000 });
    await d1.locator('.mine-row:has(.chip:text-is("مكتملة"))').locator('[data-open]').click(); await d1.waitForSelector('.doc');
    ok(await d1.locator('.notes li').evaluateAll((e) => e.map((x) => x.dataset.rule).join()) === 'D4,A1,I1', 'device 1 opens the completed report restored from the cloud (D4, A1, I1)');

    // 5. another account sees nothing of A
    const d3 = await device(B); await d3.waitForSelector('.mine-h', { timeout: 15000 }); await d3.waitForTimeout(1500);
    ok(await d3.locator('.mine-row').count() === 0 && (await d3.innerText('.mine')).includes('لا توجد جلسات'), 'second account sees none of the first account\'s sessions');

    // 6. sign out on device 1: account copy leaves the device, cloud keeps it, guest session stays
    const before = (await rowsOf(A.id)).length;
    await d1.click('#logoutNav'); await d1.waitForSelector('#googleNav', { timeout: 15000 });
    ok(await ls(d1, 'muhaqqiq-account-v1') === null, 'sign-out removes the account copy from the device');
    ok(JSON.parse(await ls(d1, 'muhaqqiq-taammuli-v2')).answers.situation.text === 'جلسة ضيف على الجهاز', 'guest session untouched by sign-out');
    ok((await rowsOf(A.id)).length === before, 'sessions remain in the cloud after sign-out');
    ok(!(await d1.locator('body').innerText()).includes('تأمل الحساب'), 'no account data is shown after sign-out');
    ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  } catch (e) { fail.push('aborted: ' + e.message); }
  finally {
    if (b) await b.close();
    for (const u of users) await adminApi(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
    const left = (await adminApi('/rest/v1/reflection_sessions?select=id')).json;
    console.log('cleanup: test users deleted; remaining rows:', Array.isArray(left) ? left.length : left);
  }
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((f) => console.log(' -', f)); process.exit(fail.length ? 1 : 0);
})();
