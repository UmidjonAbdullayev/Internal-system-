-- Telegram alerts rebuild (IS-55): ARRIVED + NOT AT STOP only.
-- Kill switch stays OFF. Existing bot unchanged.
-- Does not alter trip sync bodies or money schema.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- telegram_bot_config: CRM-managed bcrypt password (never plain text)
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_bot_config (
  id int primary key default 1 check (id = 1),
  password_hash text,
  password_updated_at timestamptz,
  logout_everyone_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.telegram_bot_config (id)
values (1)
on conflict (id) do nothing;

alter table public.telegram_bot_config enable row level security;

do $$ begin
  create policy authenticated_read_telegram_bot_config
    on public.telegram_bot_config for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_telegram_bot_config
    on public.telegram_bot_config for select to anon using (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- bot_users: private-chat authorized Telegram users
-- ---------------------------------------------------------------------------
create table if not exists public.bot_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  display_name text,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  authorized_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_users_active_idx
  on public.bot_users (telegram_user_id)
  where revoked_at is null;

alter table public.bot_users enable row level security;

do $$ begin
  create policy authenticated_read_bot_users
    on public.bot_users for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_bot_users
    on public.bot_users for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_update_bot_users
    on public.bot_users for update to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_bot_users
    on public.bot_users for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- dry_run_alerts: would-send log while kill switch OFF
-- ---------------------------------------------------------------------------
create table if not exists public.dry_run_alerts (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  stop_id text not null default '',
  alert_type text not null,
  chat_id text,
  driver_id text,
  html text not null default '',
  meta jsonb not null default '{}'::jsonb,
  reason text,
  sync_basis text,
  would_send_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists dry_run_alerts_would_send_idx
  on public.dry_run_alerts (would_send_at desc);

create index if not exists dry_run_alerts_type_idx
  on public.dry_run_alerts (alert_type, would_send_at desc);

alter table public.dry_run_alerts enable row level security;

do $$ begin
  create policy anon_read_dry_run_alerts
    on public.dry_run_alerts for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_dry_run_alerts
    on public.dry_run_alerts for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- driver_groups: CRM driver_id + per-group enable + quiet
-- ---------------------------------------------------------------------------
alter table public.driver_groups
  add column if not exists driver_id text,
  add column if not exists linked_at timestamptz,
  add column if not exists alerts_enabled boolean not null default false,
  add column if not exists quiet boolean not null default false;

update public.driver_groups
set linked_at = coalesce(linked_at, created_at)
where linked_at is null;

create index if not exists driver_groups_crm_driver_idx
  on public.driver_groups (driver_id)
  where active = true and driver_id is not null;

-- ---------------------------------------------------------------------------
-- alerts_sent: UNIQUE (trip_id, stop_id, alert_type, chat_id) — no level
-- ---------------------------------------------------------------------------
drop index if exists public.alerts_sent_dedupe_per_chat_uidx;
drop index if exists public.alerts_sent_trip_id_stop_id_alert_type_level_key;

do $$
declare
  cname text;
begin
  for cname in
    select conname
    from pg_constraint
    where conrelid = 'public.alerts_sent'::regclass
      and contype = 'u'
  loop
    execute format('alter table public.alerts_sent drop constraint %I', cname);
  end loop;
end $$;

-- Collapse duplicate rows before unique index (keep earliest)
delete from public.alerts_sent a
using public.alerts_sent b
where a.ctid < b.ctid
  and a.trip_id = b.trip_id
  and a.stop_id = b.stop_id
  and a.alert_type = b.alert_type
  and coalesce(a.chat_id, '') = coalesce(b.chat_id, '');

create unique index if not exists alerts_sent_dedupe_uidx
  on public.alerts_sent (trip_id, stop_id, alert_type, chat_id);

-- ---------------------------------------------------------------------------
-- Disable old alert types — only arrived + not_at_stop remain enabled
-- ---------------------------------------------------------------------------
update public.telegram_alert_settings
set enabled = false, updated_at = now()
where alert_type not in ('arrived', 'not_at_stop');

insert into public.telegram_alert_settings (alert_type, enabled)
values
  ('arrived', true),
  ('not_at_stop', true)
on conflict (alert_type) do update
set enabled = true, updated_at = now();

-- Global kill switch mirror stays OFF
update public.telegram_alert_config
set alerts_enabled = false, updated_at = now()
where id = 1;

-- ---------------------------------------------------------------------------
-- RPCs: password set / verify / logout everyone / advisory lock
-- ---------------------------------------------------------------------------
create or replace function public.set_telegram_bot_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_password is null or length(trim(p_password)) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Password must be at least 6 characters');
  end if;
  update public.telegram_bot_config
  set
    password_hash = crypt(trim(p_password), gen_salt('bf')),
    password_updated_at = now(),
    updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true, 'updated_at', now());
end;
$$;

create or replace function public.telegram_bot_logout_everyone()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.telegram_bot_config
  set logout_everyone_at = now(), updated_at = now()
  where id = 1;
  update public.bot_users
  set revoked_at = now(), updated_at = now()
  where revoked_at is null;
  delete from public.telegram_admin_sessions;
  return jsonb_build_object('ok', true, 'logout_everyone_at', now());
end;
$$;

create or replace function public.verify_telegram_bot_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
begin
  select password_hash into h from public.telegram_bot_config where id = 1;
  if h is null or h = '' then
    return false;
  end if;
  return crypt(trim(p_password), h) = h;
end;
$$;

create or replace function public.try_trip_alerts_lock()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return pg_try_advisory_lock(87201455);
end;
$$;

create or replace function public.release_trip_alerts_lock()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return pg_advisory_unlock(87201455);
end;
$$;

-- Allow CRM anon to set password / logout (same pattern as other CRM writes)
grant execute on function public.set_telegram_bot_password(text) to anon, authenticated;
grant execute on function public.telegram_bot_logout_everyone() to anon, authenticated;
grant execute on function public.verify_telegram_bot_password(text) to service_role;
grant execute on function public.try_trip_alerts_lock() to service_role;
grant execute on function public.release_trip_alerts_lock() to service_role;

comment on table public.dry_run_alerts is
  'Would-send Telegram alerts while TELEGRAM_ALERTS_ENABLED is OFF (step 6a dry-run).';
comment on table public.bot_users is
  'Authorized Telegram private-chat users after CRM password unlock.';
comment on column public.driver_groups.alerts_enabled is
  'Per-group pilot enable; still requires global TELEGRAM_ALERTS_ENABLED.';
