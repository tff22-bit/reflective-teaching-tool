-- Cloud copy of a teacher's reflection sessions. One row per session, visible only to its owner.
create table public.reflection_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  answers        jsonb not null default '{}'::jsonb,
  status         text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  step           smallint not null default 0 check (step between 0 and 11),
  counted        boolean not null default false,
  schema_version smallint not null default 2,
  rev            integer not null default 1,                 -- bumped on every update; used to detect a newer copy
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint answers_is_object check (jsonb_typeof(answers) = 'object'),
  constraint answers_small check (pg_column_size(answers) < 102400)
);

create index reflection_sessions_owner_idx on public.reflection_sessions (user_id, updated_at desc);

-- Server-side bookkeeping: the owner, creation time and revision cannot be set by the client on update.
create function public.reflection_sessions_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.rev        := old.rev + 1;
  return new;
end;
$$;
create trigger reflection_sessions_touch before update on public.reflection_sessions
  for each row execute function public.reflection_sessions_touch();

-- Basic abuse guard: at most 200 sessions per account.
create function public.reflection_sessions_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.reflection_sessions where user_id = new.user_id) >= 200 then
    raise exception 'session limit reached' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger reflection_sessions_limit before insert on public.reflection_sessions
  for each row execute function public.reflection_sessions_limit();

-- Row Level Security: a signed-in user can only see and change their own rows. Anonymous visitors get nothing.
alter table public.reflection_sessions enable row level security;
revoke all on table public.reflection_sessions from anon;
revoke all on table public.reflection_sessions from authenticated;
grant select, insert, update, delete on table public.reflection_sessions to authenticated;

create policy "owner can read"   on public.reflection_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner can insert" on public.reflection_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "owner can update" on public.reflection_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can delete" on public.reflection_sessions for delete to authenticated using ((select auth.uid()) = user_id);
