-- Server-side (admin) access for maintenance and tests only. The browser never uses this role; the public key stays limited by RLS.
grant select, insert, update, delete on table public.reflection_sessions to service_role;
