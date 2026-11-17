-- Extension liveness heartbeat (separate from section data syncs).

create table if not exists public.extension_heartbeat (
  id integer primary key default 1 check (id = 1),
  alive_at timestamptz,
  auth_status text not null default 'ok'
    check (auth_status in ('ok', 'auth_required', 'unknown')),
  client_id text,
  detail text,
  updated_at timestamptz not null default now()
);

insert into public.extension_heartbeat (id)
values (1)
on conflict (id) do nothing;

alter table public.extension_heartbeat enable row level security;

do $$ begin
  create policy anon_read_extension_heartbeat
    on public.extension_heartbeat for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy authenticated_read_extension_heartbeat
    on public.extension_heartbeat for select to authenticated using (true);
exception when duplicate_object then null; end $$;
