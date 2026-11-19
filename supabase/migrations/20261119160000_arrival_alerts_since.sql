-- Arrivals are now detected by the every-minute trip-alerts check (relay-snapshot sends
-- no arrival events). Only check-ins after this time are alerted, so switching on
-- never floods old arrivals. Start = when "Driver Updates" was set.
alter table public.telegram_alert_config
  add column if not exists arrival_alerts_since timestamptz;

update public.telegram_alert_config
   set arrival_alerts_since = coalesce(broadcast_set_at, now())
 where id = 1 and arrival_alerts_since is null;
