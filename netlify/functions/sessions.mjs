// Central counter for started reflection sessions.
//   GET  /api/sessions -> { total }
//   POST /api/sessions -> { total }   (body: {"event":"start"})
// Stores one total only. No names, answers or identifiers.
import { getDatabase } from "@netlify/database";
import { createHash } from "node:crypto";

export const config = { path: "/api/sessions" };

const LIMIT_PER_HOUR = 5;   // session starts allowed per caller per hour
const WINDOW_SECONDS = 3600;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

export function makeHandler(getDb, env = process.env) {
  return async (req, context) => {
    try {
      const db = getDb();

      if (req.method === "GET") {
        const rows = await db.sql`SELECT total FROM session_counter WHERE id = 1`;
        if (!rows.length) return json({ error: "unavailable" }, 503);
        return json({ total: Number(rows[0].total) });
      }

      if (req.method !== "POST") return json({ error: "method" }, 405);

      // Only the site's own pages may count a session.
      const origin = req.headers.get("origin");
      let sameOrigin = false;
      try { sameOrigin = !!origin && new URL(origin).host === new URL(req.url).host; } catch {}
      if (!sameOrigin) return json({ error: "forbidden" }, 403);
      if (!(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "type" }, 415);
      let body = null;
      try { body = await req.json(); } catch {}
      if (!body || body.event !== "start") return json({ error: "bad-request" }, 400);

      // Per-caller hourly limit, using a salted hash instead of the raw address.
      const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
      const h = createHash("sha256").update((env.COUNTER_SALT || "muhaqqiq") + "|" + ip).digest("hex");
      const bucket = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
      const hit = await db.sql`
        INSERT INTO start_limits (h, bucket, hits) VALUES (${h}, ${bucket}, 1)
        ON CONFLICT (h, bucket) DO UPDATE SET hits = start_limits.hits + 1
        RETURNING hits`;
      if (Number(hit[0].hits) > LIMIT_PER_HOUR) return json({ error: "rate-limited" }, 429);
      await db.sql`DELETE FROM start_limits WHERE bucket < ${bucket - 24}`;

      // Single-statement increment: safe when requests arrive at the same time.
      const rows = await db.sql`UPDATE session_counter SET total = total + 1 WHERE id = 1 RETURNING total`;
      if (!rows.length) return json({ error: "unavailable" }, 503);
      return json({ total: Number(rows[0].total) });
    } catch (e) {
      return json({ error: "unavailable" }, 503);
    }
  };
}

export default makeHandler(getDatabase);
