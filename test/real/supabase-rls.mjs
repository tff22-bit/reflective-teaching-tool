// REAL Supabase test (not part of the offline test suite). Creates two temporary users with the admin API,
// exercises the reflection_sessions table through the public REST API as each user and as an anonymous visitor,
// then deletes the users (rows cascade). Needs: SB_URL, SB_ANON (public key) and SB_SERVICE (admin key, never logged).
import { randomUUID, randomBytes } from "node:crypto";
const { SB_URL, SB_ANON, SB_SERVICE } = process.env;
if (!SB_URL || !SB_ANON || !SB_SERVICE) { console.error("missing SB_URL / SB_ANON / SB_SERVICE"); process.exit(2); }
let pass = 0; const fail = []; const ok = (c, m) => { if (c) pass++; else fail.push(m); };
const T = "reflection_sessions";
const api = async (path, { method = "GET", token, body, key = SB_ANON, headers = {} } = {}) => {
  const r = await fetch(SB_URL + path, { method, headers: { apikey: key, Authorization: "Bearer " + (token || key), "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const admin = (path, o = {}) => api(path, { ...o, token: SB_SERVICE, key: SB_SERVICE });
const mkUser = async (tag) => {
  const email = `rls-${tag}-${randomBytes(4).toString("hex")}@example.org`, password = randomBytes(18).toString("base64url");
  const c = await admin("/auth/v1/admin/users", { method: "POST", body: { email, password, email_confirm: true } });
  if (!c.json || !c.json.id) throw new Error("could not create test user: " + c.status + " " + (c.json && (c.json.msg || c.json.message)));
  const t = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (!t.json || !t.json.access_token) throw new Error("could not sign in test user: " + t.status);
  return { id: c.json.id, token: t.json.access_token };
};
const answers = (text) => ({ situation: { sel: [], text, other: "", extra: "" } });
const users = [];
try {
  const A = await mkUser("a"); users.push(A); const B = await mkUser("b"); users.push(B);
  const idA = randomUUID();
  const rest = (q, o = {}) => api(`/rest/v1/${T}${q}`, o);
  const asA = (o = {}) => ({ token: A.token, ...o }), asB = (o = {}) => ({ token: B.token, ...o });
  const ret = { headers: { Prefer: "return=representation" } };

  // anonymous visitor (public key only)
  let r = await rest("?select=id"); ok(r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0), "anonymous cannot read sessions (status " + r.status + ")");
  r = await rest("", { method: "POST", body: { id: randomUUID(), answers: answers("x"), status: "in_progress", step: 0 }, ...ret }); ok(r.status >= 400, "anonymous cannot insert (status " + r.status + ")");

  // owner insert / read
  r = await rest("", { method: "POST", ...asA(), body: { id: idA, answers: answers("نص المعلمة أ"), status: "in_progress", step: 3, counted: true }, headers: ret.headers });
  ok(r.status === 201 && r.json[0].user_id === A.id && r.json[0].rev === 1 && !!r.json[0].created_at && r.json[0].step === 3, "A inserts a session; owner is set to A, rev starts at 1 (" + r.status + ")");
  r = await rest("?select=id,status,step,rev,updated_at,preview:answers->situation->>text&order=updated_at.desc&limit=100", asA());
  ok(r.status === 200 && r.json.length === 1 && r.json[0].preview === "نص المعلمة أ", "A lists own sessions with the preview projection used by the app");

  // other user cannot see / change / delete
  r = await rest("?select=*", asB()); ok(r.status === 200 && r.json.length === 0, "B sees none of A's sessions");
  r = await rest(`?id=eq.${idA}&select=*`, asB()); ok(r.status === 200 && r.json.length === 0, "B cannot fetch A's session by id");
  r = await rest(`?user_id=eq.${A.id}&select=*`, asB()); ok(r.status === 200 && r.json.length === 0, "B cannot filter by A's user id");
  r = await rest(`?id=eq.${idA}`, { method: "PATCH", ...asB(), body: { answers: answers("اختراق") }, headers: ret.headers }); ok(r.status < 300 && Array.isArray(r.json) && r.json.length === 0, "B cannot update A's session (0 rows)");
  r = await rest(`?id=eq.${idA}`, { method: "DELETE", ...asB(), headers: ret.headers }); ok(r.status < 300 && Array.isArray(r.json) && r.json.length === 0, "B cannot delete A's session (0 rows)");
  r = await rest("", { method: "POST", ...asB(), body: { id: randomUUID(), user_id: A.id, answers: answers("انتحال"), status: "in_progress", step: 0 } }); ok(r.status >= 400, "B cannot insert a row owned by A (status " + r.status + ")");
  r = await rest(`?id=eq.${idA}&select=answers,rev`, asA()); ok(r.json.length === 1 && r.json[0].answers.situation.text === "نص المعلمة أ" && r.json[0].rev === 1, "A's row is intact after B's attempts");

  // owner update: rev bump, owner immutable, optimistic concurrency
  r = await rest(`?id=eq.${idA}&rev=eq.1`, { method: "PATCH", ...asA(), body: { answers: answers("تعديل"), step: 4, user_id: B.id }, headers: ret.headers });
  ok(r.status === 200 && r.json.length === 1 && r.json[0].rev === 2 && r.json[0].user_id === A.id, "A updates own session: rev 2 and owner unchanged even when asked to change it");
  r = await rest(`?id=eq.${idA}&rev=eq.1`, { method: "PATCH", ...asA(), body: { step: 5 }, headers: ret.headers }); ok(r.status === 200 && r.json.length === 0, "an update based on an old revision changes nothing (conflict detection)");

  // data validation
  const bad = async (patch, why) => { const x = await rest(`?id=eq.${idA}`, { method: "PATCH", ...asA(), body: patch, headers: ret.headers }); ok(x.status >= 400, why + " (status " + x.status + ")"); };
  await bad({ status: "done" }, "invalid status is rejected"); await bad({ step: 12 }, "step beyond 11 is rejected"); await bad({ answers: [1, 2] }, "answers must be an object");
  await bad({ answers: { situation: { text: "ك".repeat(120000) } } }, "answers over ~100 KB are rejected");

  // per-account limit (200)
  const many = Array.from({ length: 199 }, () => ({ id: randomUUID(), answers: answers("m"), status: "in_progress", step: 0 }));
  r = await rest("", { method: "POST", ...asA(), body: many }); ok(r.status === 201, "A can reach 200 sessions (" + r.status + ")");
  r = await rest("", { method: "POST", ...asA(), body: { id: randomUUID(), answers: answers("زائدة"), status: "in_progress", step: 0 } }); ok(r.status >= 400, "the 201st session is refused (" + r.status + ")");
  r = await rest(`?id=eq.${idA}`, { method: "DELETE", ...asA(), headers: ret.headers }); ok(r.status === 200 && r.json.length === 1, "A deletes own session");

  // the token endpoints must not expose the table to the anonymous key via other routes
  r = await rest("?select=*", { token: SB_ANON }); ok(r.status === 401 || r.status === 403 || (r.status === 200 && r.json.length === 0), "public key alone reads nothing");
} catch (e) { fail.push("test aborted: " + e.message); }
finally {
  for (const u of users) await admin(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  console.log("cleanup: temporary users deleted");
}
console.log("PASS", pass, "FAIL", fail.length); fail.forEach((f) => console.log(" -", f)); process.exit(fail.length ? 1 : 0);
