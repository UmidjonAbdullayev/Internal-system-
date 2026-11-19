-- One shared "Driver Updates" Telegram group for every driver's alerts.
-- routing_mode = 'broadcast'     -> all ARRIVED / NOT AT STOP alerts go to broadcast_chat_id only
-- routing_mode = 'driver_groups' -> old behaviour (each driver's linked group)
-- Set from Telegram: an admin of the group sends /setupdates inside "Driver Updates".

alter table public.telegram_alert_config
  add column if not exists routing_mode text not null default 'driver_groups',
  add column if not exists broadcast_chat_id text,
  add column if not exists broadcast_title text,
  add column if not exists broadcast_set_by text,
  add column if not exists broadcast_set_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'telegram_alert_config_routing_mode_chk'
  ) then
    alter table public.telegram_alert_config
      add constraint telegram_alert_config_routing_mode_chk
      check (routing_mode in ('driver_groups', 'broadcast'));
  end if;
end $$;

comment on column public.telegram_alert_config.routing_mode is
  'broadcast = every driver alert goes to broadcast_chat_id ("Driver Updates"); driver_groups = per-driver linked groups.';
