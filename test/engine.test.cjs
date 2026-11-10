// Tests of the three-level analysis engine against the approved rules file (test/fixtures/analysis_rules_v3.txt).
// The fixture is parsed here independently of the app; labels are mapped to option ids using the app's own QUESTIONS.
// Run: NODE_PATH=$(npm root -g) node test/engine.test.cjs   (needs Playwright)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../public/index.html');
const KEY = 'muhaqqiq-taammuli-v2';
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };

const L = fs.readFileSync(path.join(__dirname, 'fixtures/analysis_rules_v3.txt'), 'utf8').split('\n').map((l) => l.trim());
const TITLE = { 'المستوى الأول': 'decision', 'المستوى الثاني': 'alternatives', 'المستوى الثالث': 'improvement' };

(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/api/sessions', (r) => r.abort());
  await pg.goto(URL);
  const QS = await pg.evaluate(() => QUESTIONS.map((q) => ({ id: q.id, opts: (q.opts || []).map((o) => ({ id: o.id, label: o.label })) })));
  const idOf = (n, label) => { const o = QS[n - 1].opts.find((x) => x.label === label); if (!o) throw new Error('label is not an option of Q' + n + ': ' + label); return o.id; };

  // ---- parse the approved file
  const levels = []; let lv = null, rule = null;
  const leaf = (part) => { const n = +part.match(/^\s*السؤال (\d+)/)[1]; const labels = [...part.matchAll(/«([^»]+)»/g)].map((m) => m[1]); return { n, q: QS[n - 1].id, pick: labels.map((x) => idOf(n, x)) }; };
  const parseCond = (c) => {
    if (c.includes('، أو السؤال')) return { any: c.split('، أو ').map(leaf) };
    if (c.includes('، والسؤال')) return { all: c.split(/،\s*و(?=السؤال)/).map(leaf) };
    return leaf(c);
  };
  L.forEach((t, i) => {
    let m;
    if ((m = t.match(/^(المستوى (?:الأول|الثاني|الثالث)): (.+)$/))) { lv = { id: TITLE[m[1]], title: m[2], rules: [] }; levels.push(lv); }
    else if ((m = t.match(/^([DAI]\d) \| الأولوية (\d+)$/))) { rule = { id: m[1], priority: +m[2] }; lv.rules.push(rule); }
    else if (t.startsWith('الشرط: ')) rule.when = parseCond(t.slice(7));
    else if (t.startsWith('النص: «')) rule.text = t.slice(7, -1);
    else if (t.startsWith('النص البديل للمستوى')) lv.fallback = L[i + 1].slice(1, -1);
  });
  ok(levels.length === 3 && levels.map((l) => l.rules.length).join() === '8,6,6', 'fixture: 3 levels with 8, 6, 6 rules');
  const sel = (st, q) => st[q] || [];
  const evalNode = (n, st) => n.all ? n.all.every((x) => evalNode(x, st)) : n.any ? n.any.some((x) => evalNode(x, st)) : n.pick.some((o) => sel(st, n.q).includes(o));
  const expectedFor = (st) => levels.map((l) => { const r = l.rules.find((x) => evalNode(x.when, st)); return { level: l.id, title: l.title, ruleId: r ? r.id : null, text: r ? r.text : l.fallback }; });

  // helper: set choices in the app and read the engine result
  const run = (states) => pg.evaluate((states) => states.map((st) => { for (const q of QUESTIONS) ans(q).sel = st[q.id] || []; return analyze(); }), states);
  const same = (a, e) => JSON.stringify(a) === JSON.stringify(e);

  // ---- 1. every rule on its own: minimal state that satisfies its condition (first branch of any-of), correct id and exact text
  const minimal = (node) => { const st = {}; const go = (n) => { if (n.all) n.all.forEach(go); else if (n.any) go(n.any[0]); else st[n.q] = [n.pick[0]]; }; go(node); return st; };
  for (const l of levels) for (const r of l.rules) {
    const st = minimal(r.when); const [res] = await run([st]);
    const got = res.find((x) => x.level === l.id);
    ok(got.ruleId === r.id && got.text === r.text, `rule ${r.id} activates alone with its exact text (got ${got.ruleId})`);
    // every OR branch / alternative option also activates it (when nothing of higher priority matches)
  }
  // all alternatives inside a condition (each pick option, each OR branch)
  const variants = (node) => {
    if (node.all) { let acc = [{}]; for (const n of node.all) { const v = variants(n); acc = acc.flatMap((a) => v.map((x) => ({ ...a, ...x }))); } return acc; }
    if (node.any) return node.any.flatMap(variants);
    return node.pick.map((o) => ({ [node.q]: [o] }));
  };
  for (const l of levels) for (const r of l.rules) for (const st of variants(r.when)) {
    const [res] = await run([st]); const e = expectedFor(st).find((x) => x.level === l.id), got = res.find((x) => x.level === l.id);
    ok(got.ruleId === e.ruleId, `rule ${r.id} variant ${JSON.stringify(st)} -> ${got.ruleId}, expected ${e.ruleId}`);
  }

  // ---- 2. several rules in one level: the first by priority wins (D1+D3+D5, A1+A2, I2+I6...)
  let [r] = await run([{ blindspots: ['feelings', 'prior_assumption'], result: ['no_change'], reason: ['time_pressure'] }]);
  ok(r[0].ruleId === 'D1', 'D1 wins over D3 (and lower)');
  [r] = await run([{ blindspots: ['prior_assumption'], result: ['no_change'], reason: ['time_pressure'] }]); ok(r[0].ruleId === 'D3', 'D3 wins over D5/D6');
  [r] = await run([{ result: ['no_change'], reason: ['time_pressure'] }]); ok(r[0].ruleId === 'D5', 'D5 wins over D6');
  [r] = await run([{ alternatives: ['short_assessment', 'dialogue_listen', 'differentiated'], evidence: ['assessment_data', 'student_view', 'conditions'] }]); ok(r[1].ruleId === 'A1', 'A1 wins over A2/A3');
  [r] = await run([{ step: ['new_strategy'], measure: ['goal_attainment', 'participation'] }]); ok(r[2].ruleId === 'I2', 'I2 wins over I6');
  // a rule matched by conditions from a different level does not cross over
  [r] = await run([{ alternatives: ['dialogue_listen'], evidence: ['assessment_data'] }]); ok(r[1].ruleId === null, 'A2 needs both its Q7 and Q8 choices');

  // ---- 3. independence of levels
  [r] = await run([{ blindspots: ['feelings'], alternatives: ['consult'], evidence: ['consult'], step: ['extra_support'], measure: ['student_performance'] }]);
  ok(r.map((x) => x.ruleId).join() === 'D1,A6,I4', 'one insight per level, all three at once');
  [r] = await run([{ blindspots: ['feelings'] }]); ok(r[0].ruleId === 'D1' && r[1].ruleId === null && r[2].ruleId === null, 'level 1 match leaves levels 2 and 3 with their own text');
  ok(r[1].text === levels[1].fallback && r[2].text === levels[2].fallback, 'levels 2 and 3 show their fallback');
  [r] = await run([{ step: ['dialogue_time'], measure: ['student_feedback'] }]); ok(r[0].ruleId === null && r[1].ruleId === null && r[2].ruleId === 'I3', 'level 3 match does not need levels 1 and 2');

  // ---- 4. fallback texts
  [r] = await run([{}]); ok(r.every((x, i) => x.ruleId === null && x.text === levels[i].fallback), 'empty choices -> the three fallback texts');
  [r] = await run([{ goal: ['understanding'], reason: ['judgment'], result: ['unexpected'], blindspots: ['no_gap'] }]); ok(r[0].ruleId === null && r[0].text === levels[0].fallback, 'level 1 fallback when no rule applies');

  // ---- 5. random combinations against the independent evaluator (choices only)
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (opts, multi) => { if (!multi) return Math.random() < .15 ? [] : [opts[rnd(opts.length)].id]; return opts.filter(() => Math.random() < .35).map((o) => o.id); };
  const states = []; for (let i = 0; i < 20000; i++) { const st = {}; QS.forEach((q, k) => { if (!q.opts.length) return; st[q.id] = pick(q.opts, [5, 6, 7, 9].includes(k)); }); states.push(st); }
  const got = await run(states); let bad = 0;
  states.forEach((st, k) => { if (!same(got[k], expectedFor(st))) { bad++; if (bad < 4) fail.push('random mismatch ' + JSON.stringify(st)); } });
  ok(bad === 0, 'engine equals the independent evaluator on 20000 random combinations');
  const ids = new Set(got.flatMap((x) => x.map((y) => y.ruleId).filter(Boolean))); ok(ids.size === 20, 'all 20 rules were reached in random testing (' + ids.size + ')');
  ok(got.every((x) => x.length === 3 && x.map((y) => y.level).join() === 'decision,alternatives,improvement'), 'always one insight per level');

  // ---- 6. free text and non-choice answers never influence the result
  await pg.evaluate(() => { for (const q of QUESTIONS) { ans(q).sel = []; } });
  const base = await pg.evaluate(() => analyze());
  await pg.evaluate(() => { for (const q of QUESTIONS) { const a = ans(q); a.text = 'مشاعر افتراض سابق ضيق الوقت لم يتغير الموقف تقويم استشارة'; a.other = 'ضيق الوقت'; } });
  ok(same(await pg.evaluate(() => analyze()), base), 'free text and "other" details do not change the insights');
  ok(!/analyze\(\)[^;]*\.text/.test(await pg.evaluate(() => matchNode.toString())), 'matchNode reads only choices');

  // ---- 7. report: three headings, rule ids kept, only after completion; saving/navigation unaffected
  const full = () => ({ view: 'done', step: 11, counted: true, answers: {
    situation: { text: 'a' }, action: { sel: ['direct'], text: 'a' }, goal: { sel: ['behavior'] }, reason: { sel: ['time_pressure'], text: 'a' },
    result: { sel: ['no_change'] }, blindspots: { sel: ['student_needs'], text: 'a' }, alternatives: { sel: ['dialogue_listen'], other: '' }, evidence: { sel: ['student_view'] },
    step: { sel: ['dialogue_time'], text: 'a' }, measure: { sel: ['student_feedback'] }, learning: { text: 'a' }, reminder: { text: 'a' } } });
  const load = async (st) => { await pg.evaluate(([K, s]) => localStorage.setItem(K, JSON.stringify(s)), [KEY, st]); await pg.reload(); await pg.waitForTimeout(100); };
  await load(full());
  const heads = await pg.locator('.insight h3').allInnerTexts();
  ok(JSON.stringify(heads) === JSON.stringify(levels.map((l) => l.title)), 'report shows the three level headings: ' + heads);
  const lis = await pg.locator('.notes li').evaluateAll((els) => els.map((e) => [e.dataset.rule, e.querySelector('p').textContent]));
  ok(lis.map((x) => x[0]).join() === 'D2,A2,I3', 'report keeps the activated rule ids: ' + lis.map((x) => x[0]));
  ok(lis[0][1] === levels[0].rules[1].text && lis[1][1] === levels[1].rules[1].text && lis[2][1] === levels[2].rules[2].text, 'report shows the exact approved texts');
  // changing choices updates the insights (no stale text)
  await pg.evaluate(() => { state.answers.blindspots.sel = ['feelings']; state.answers.alternatives.sel = ['consult']; state.answers.evidence.sel = ['consult']; state.answers.step.sel = ['extra_support']; state.answers.measure.sel = ['student_performance']; render(); });
  ok((await pg.locator('.notes li').evaluateAll((els) => els.map((e) => e.dataset.rule))).join() === 'D1,A6,I4', 'insights follow changed choices');
  // not complete -> no analysis at all
  const inc = full(); inc.answers.measure.sel = []; await load(inc);
  ok(await pg.locator('.notes').count() === 0 && (await pg.innerText('#view')).includes('لم يكتمل'), 'no insights before the session is complete');
  // persistence: choices survive reload and the report is rebuilt from them
  await load(full()); await pg.reload(); ok((await pg.locator('.notes li').evaluateAll((e) => e.map((x) => x.dataset.rule))).join() === 'D2,A2,I3', 'report survives reload');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  console.log('PASS', pass, 'FAIL', fail.length); fail.forEach((f) => console.log(' -', f));
  await b.close(); process.exit(fail.length ? 1 : 0);
})();
