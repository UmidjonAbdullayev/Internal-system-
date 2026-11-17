-- STEP 0 kill switch (default OFF) + per-driver Telegram groups + per-chat alert dedupe.
-- Does not alter Relay entitiesV2 body / filter / window / backfill logic.

alter table public.telegram_alert_config
  add column if not exists alerts_enabled boolean not null default false;

update public.telegram_alert_config
set alerts_enabled = false, updated_at = now()
where id = 1;

-- Disable automatic system alert types (sync lost/restored). Keep rows for diagnostics.
update public.telegram_alert_settings
set enabled = false, updated_at = now()
where alert_type in ('sync_stopped', 'sync_restored');

-- Spec table: chat_id ↔ Relay driverList[].id
create table if not exists public.driver_groups (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  relay_driver_id text not null,
  driver_name text,
  group_title text,
  active boolean not null default true,
  linked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_groups_relay_driver_idx
  on public.driver_groups (relay_driver_id);

create index if not exists driver_groups_active_idx
  on public.driver_groups (active) where active = true;

alter table public.driver_groups enable row level security;

do $$ begin
  create policy authenticated_read_driver_groups
    on public.driver_groups for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- alerts_sent: never same alert+level+chat twice
update public.alerts_sent set chat_id = coalesce(chat_id, '') where chat_id is null;
alter table public.alerts_sent alter column chat_id set default '';
alter table public.alerts_sent alter column chat_id set not null;

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.alerts_sent'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%trip_id%stop_id%alert_type%level%'
  limit 1;
  if cname is not null then
    execute format('alter table public.alerts_sent drop constraint %I', cname);
  end if;
end $$;

drop index if exists public.alerts_sent_trip_id_stop_id_alert_type_level_key;

create unique index if not exists alerts_sent_dedupe_per_chat_uidx
  on public.alerts_sent (trip_id, stop_id, alert_type, level, chat_id);
