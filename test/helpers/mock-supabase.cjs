// A small in-memory stand-in for Supabase, shared by several browser contexts, with row-level security rules
// equivalent to the real policies (owner only). Used to test the app's cloud logic; real RLS is tested separately.
function createBackend() {
  const store = { sessions: [], calls: 0, fail: false, uidCounter: 0 };
  const iso = () => new Date().toISOString();
  const uidOf = (token) => (token && token.startsWith('tok:') ? token.slice(4) : null);
  function handle(op, a, token) {
    store.calls++;
    if (store.fail) return { data: null, error: { message: 'network down', code: 'FETCH' } };
    if (op !== 'q') return { data: null, error: { message: 'unknown op' } };
    const uid = uidOf(token);
    const spec = a;
    const eq = spec.eq || [];
    const match = (r) => r.user_id === uid && eq.every(([c, v]) => r[c] === v);
    const proj = (r) => {
      const sel = spec.select;
      if (!sel || sel === '*') return { ...r };
      const out = {};
      for (const part of sel.split(',')) {
        if (part.startsWith('preview:')) { const t = r.answers && r.answers.situation && r.answers.situation.text; out.preview = t == null ? null : t; }
        else out[part] = r[part];
      }
      return out;
    };
    const finish = (rows, errorIfEmpty) => {
      const mapped = rows.map(proj);
      if (spec.single === 'single') return mapped.length === 1 ? { data: mapped[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'rows: ' + mapped.length } };
      if (spec.single === 'maybe') return { data: mapped[0] || null, error: null };
      return { data: mapped, error: null };
    };
    if (spec.op === 'select') {
      if (!uid) return { data: [], error: null };                       // anonymous: RLS returns nothing
      let rows = store.sessions.filter(match);
      if (spec.order) rows.sort((x, y) => (x[spec.order.col] < y[spec.order.col] ? 1 : -1) * (spec.order.asc ? -1 : 1));
      if (spec.limit) rows = rows.slice(0, spec.limit);
      return finish(rows);
    }
    if (spec.op === 'insert') {
      if (!uid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      const v = spec.values;
      if (v.user_id && v.user_id !== uid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      if (store.sessions.some((r) => r.id === v.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const row = { id: v.id, user_id: uid, answers: v.answers, status: v.status, step: v.step, counted: !!v.counted, schema_version: v.schema_version || 2, rev: 1, created_at: iso(), updated_at: iso() };
      store.sessions.push(row);
      return spec.select ? finish([row]) : { data: null, error: null };
    }
    if (spec.op === 'update') {
      if (!uid) return { data: null, error: null };
      const rows = store.sessions.filter(match);
      for (const r of rows) { Object.assign(r, spec.values, { user_id: r.user_id, rev: r.rev + 1, updated_at: iso() }); }
      return spec.select ? finish(rows) : { data: null, error: null };
    }
    if (spec.op === 'delete') {
      if (!uid) return { data: null, error: null };
      store.sessions = store.sessions.filter((r) => !match(r));
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'bad op' } };
  }
  return { store, handle };
}

// Browser side: replaces public/supabase.js. Signing in is simulated by window.__mockUser (set by the test).
const MOCK_LIB = `
window.supabase = { createClient(url, key, opts) {
  const KEY = 'sb-mock-auth'; const listeners = [];
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  let session = read();
  window.__mockOpts = opts; window.__mockKey = key;
  const emit = (ev) => listeners.forEach((cb) => cb(ev, session));
  const call = (spec) => window.__sb('q', spec, session && session.access_token);
  class Q {
    constructor(t) { this.s = { table: t, op: 'select', eq: [], select: '*' }; }
    select(c) { if (this.s.op === 'select') this.s.select = c || '*'; else this.s.select = c || '*'; this.s.hasSelect = true; return this; }
    insert(v) { this.s.op = 'insert'; this.s.values = v; this.s.select = null; return this; }
    update(v) { this.s.op = 'update'; this.s.values = v; this.s.select = null; return this; }
    delete() { this.s.op = 'delete'; this.s.select = null; return this; }
    eq(c, v) { this.s.eq.push([c, v]); return this; }
    order(c, o) { this.s.order = { col: c, asc: !(o && o.ascending === false) }; return this; }
    limit(n) { this.s.limit = n; return this; }
    single() { this.s.single = 'single'; return this; }
    maybeSingle() { this.s.single = 'maybe'; return this; }
    then(res, rej) { const spec = { ...this.s, select: this.s.op === 'select' ? this.s.select : (this.s.hasSelect ? this.s.select : null) }; return call(spec).then(res, rej); }
  }
  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOAuth(o) {
        window.__oauth = o; const u = window.__mockUser; if (!u) return { error: { message: 'no mock user' } };
        session = { access_token: 'tok:' + u.id, user: { id: u.id, email: u.email } }; localStorage.setItem(KEY, JSON.stringify(session)); emit('SIGNED_IN'); return { data: {}, error: null };
      },
      async signOut() { session = null; localStorage.removeItem(KEY); emit('SIGNED_OUT'); return { error: null }; }
    },
    from(t) { return new Q(t); }
  };
} };`;
module.exports = { createBackend, MOCK_LIB };
