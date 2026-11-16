-- Arrival section fields for facility-arrival Telegram alerts
alter table public.loads
  add column if not exists arrival_actual text,
  add column if not exists arrival_scheduled text,
  add column if not exists arrival_address text;

-- Private-chat admin sessions for Telegram bot DM menus (password + DRV gate)
create table if not exists public.telegram_admin_sessions (
  telegram_user_id bigint primary key,
  authenticated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  selected_driver_id uuid references public.drivers(id) on delete set null,
  selected_driver_code text,
  updated_at timestamptz not null default now()
);

create index if not exists telegram_admin_sessions_expires_idx
  on public.telegram_admin_sessions(expires_at);

alter table public.telegram_admin_sessions enable row level security;
