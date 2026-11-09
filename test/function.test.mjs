// Runs the real SQL (migration + function) against an in-memory Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeHandler } from "../netlify/functions/sessions.mjs";

const pg = new PGlite();
await pg.exec(readFileSync(new URL("../netlify/database/migrations/20261109000000_create_session_counter.sql", import.meta.url), "utf8"));
const sql = async (strings, ...vals) => {
  let t = strings[0]; vals.forEach((_, i) => (t += "$" + (i + 1) + strings[i + 1]));
  return (await pg.query(t, vals)).rows;
};
const handler = makeHandler(() => ({ sql }), {});
const U = "https://site.example/api/sessions";
const post = (ip, o = {}) => handler(new Request(U, { method: "POST",
  headers: { origin: o.origin ?? "https://site.example", "content-type": o.ct ?? "application/json" },
  body: o.body ?? JSON.stringify({ event: "start" }) }), { ip });
const get = () => handler(new Request(U), { ip: "1.1.1.1" });

assert.equal((await (await get()).json()).total, 0);
// 5 concurrent starts from different callers: no increments lost
const rs = await Promise.all([1,2,3,4,5].map((n) => post("10.0.0." + n)));
assert.ok(rs.every((r) => r.status === 200));
assert.equal((await (await get()).json()).total, 5);
// same caller: 5 allowed per hour, the 6th is refused and not counted
for (let i = 0; i < 4; i++) assert.equal((await post("9.9.9.9")).status, 200);
assert.equal((await post("9.9.9.9")).status, 200);
assert.equal((await post("9.9.9.9")).status, 429); // 6th hit from 9.9.9.9? (5 allowed)
assert.equal((await (await get()).json()).total, 10); // 5 + 5 allowed, refused one not counted
assert.equal((await post("2.2.2.2", { origin: "https://evil.example" })).status, 403);
assert.equal((await post("2.2.2.3", { origin: null === 1 ? "" : undefined, ct: "text/plain" })).status, 415);
assert.equal((await post("2.2.2.4", { body: "{}" })).status, 400);
assert.equal((await handler(new Request(U, { method: "DELETE" }), { ip: "3.3.3.3" })).status, 405);
assert.equal((await (await get()).json()).total, 10);
// database failure -> 503, never a fake number
const bad = makeHandler(() => ({ sql: async () => { throw new Error("down"); } }), {});
const r = await bad(new Request(U), { ip: "1" });
assert.equal(r.status, 503); assert.equal((await r.json()).total, undefined);
console.log("function tests passed");
