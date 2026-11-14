-- Per-driver Telegram groups + notification history
-- Applied on iiyqkdjwxlnfqvlidbqr as migration driver_telegram_groups_and_history

create table if not exists public.driver_telegram_groups (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null unique,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  group_title text,
  active boolean not null default true,
  notify_dispatch boolean not null default true,
  notify_trailer boolean not null default true,
  notify_status_digest boolean not null default true,
  notify_alerts boolean not null default true,
  last_status_digest_at timestamptz,
  bot_can_post boolean not null default true,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_telegram_groups_driver_idx
  on public.driver_telegram_groups(driver_id);

create table if not exists public.telegram_notification_history (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text,
  driver_id uuid references public.drivers(id) on delete set null,
  event_type text not null,
  dedupe_key text not null,
  message text not null,
  status text not null check (status in ('sent', 'deduped', 'failed', 'skipped')),
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists telegram_notif_history_chat_idx
  on public.telegram_notification_history(telegram_chat_id, created_at desc);

alter table public.relay_notification_dedupe
  add column if not exists telegram_chat_id text,
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

alter table public.driver_telegram_groups enable row level security;
alter table public.telegram_notification_history enable row level security;
