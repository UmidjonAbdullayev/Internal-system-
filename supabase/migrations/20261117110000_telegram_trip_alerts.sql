-- Telegram trip alert pipeline (dispatch group). Does not alter driver facility-arrival flow.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.telegram_alert_config (
  id int primary key default 1 check (id = 1),
  default_chat_id text,
  bootstrapped boolean not null default false,
  bootstrapped_at timestamptz,
  sync_stale_notified boolean not null default false,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  crm_base_url text not null default 'https://internal-system-lac.vercel.app',
  timezone text not null default 'America/Chicago',
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

insert into public.telegram_alert_config (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.telegram_alert_settings (
  alert_type text primary key,
  chat_id text,
  enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text,
  updated_at timestamptz not null default now()
);

insert into public.telegram_alert_settings (alert_type, enabled)
values
  ('trip_booked', true),
  ('arrived', true),
  ('departed', true),
  ('delivered', true),
  ('cancelled', true),
  ('driver_changed', true),
  ('no_driver', true),
  ('late_reason', true),
  ('not_at_stop', true),
  ('running_late', true),
  ('cpt_risk', true),
  ('late_no_reason', true),
  ('sync_stopped', true),
  ('sync_restored', true)
on conflict (alert_type) do nothing;

create table if not exists public.alerts_sent (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  stop_id text not null default '',
  alert_type text not null,
  level text not null default '0',
  sent_at timestamptz not null default now(),
  telegram_message_id bigint,
  chat_id text,
  meta jsonb not null default '{}'::jsonb,
  unique (trip_id, stop_id, alert_type, level)
);

create index if not exists alerts_sent_trip_idx
  on public.alerts_sent (trip_id, sent_at desc);

create index if not exists alerts_sent_type_idx
  on public.alerts_sent (alert_type, sent_at desc);

create table if not exists public.telegram_trip_mutes (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  chat_id text not null,
  muted_until timestamptz not null,
  muted_by text,
  created_at timestamptz not null default now(),
  unique (trip_id, chat_id)
);

alter table public.loads
  add column if not exists late_reason text,
  add column if not exists late_reason_at timestamptz;

alter table public.relay_stops
  add column if not exists late_reason text,
  add column if not exists late_reason_at timestamptz;

alter table public.telegram_alert_config enable row level security;
alter table public.telegram_alert_settings enable row level security;
alter table public.alerts_sent enable row level security;
alter table public.telegram_trip_mutes enable row level security;

do $$ begin
  create policy authenticated_read_telegram_alert_config
    on public.telegram_alert_config for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_telegram_alert_settings
    on public.telegram_alert_settings for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_alerts_sent
    on public.alerts_sent for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_telegram_trip_mutes
    on public.telegram_trip_mutes for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Cron: every minute → trip-alerts (auth via cron_secret query param stored in config)
-- Job is created/replaced idempotently; URL uses project ref for this CRM.
do $$
declare
  job_id bigint;
  secret text;
begin
  select cron_secret into secret from public.telegram_alert_config where id = 1;
  if secret is null or length(secret) < 8 then
    secret := encode(gen_random_bytes(24), 'hex');
    update public.telegram_alert_config set cron_secret = secret, updated_at = now() where id = 1;
  end if;

  for job_id in select j.jobid from cron.job j where j.jobname = 'trip-alerts-every-minute'
  loop
    perform cron.unschedule(job_id);
  end loop;

  perform cron.schedule(
    'trip-alerts-every-minute',
    '* * * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"cron"}'::jsonb,
        timeout_milliseconds := 15000
      );
      $cron$,
      'https://iiyqkdjwxlnfqvlidbqr.supabase.co/functions/v1/trip-alerts?cron_secret=' || secret
    )
  );
end $$;
