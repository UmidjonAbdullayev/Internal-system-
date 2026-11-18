-- Prefer tour-level load_reports when migrating overrides; only store driver_paid
-- when a tour-level/manual row differs from amazon_paid.

create or replace function public.migrate_load_reports_to_overrides()
returns table (migrated_tours int, source_report_rows int)
language plpgsql
security definer
as $$
declare
  v_tours int;
  v_rows int;
begin
  select count(*) into v_rows from public.load_reports;

  with base as (
    select
      public.normalize_tour_id(coalesce(nullif(btrim(trip), ''), nullif(btrim(load_ids), ''))) as tour_id,
      public.normalize_tour_id(load_ids) as bare_load,
      id,
      driver_name,
      driver_paid,
      amazon_paid,
      comment,
      dispatch,
      mile,
      broker,
      source,
      updated_at,
      created_at
    from public.load_reports
  ),
  usable as (
    select *,
      (bare_load = tour_id) as is_tour_level,
      case when source = 'manual' then 0 else 1 end as source_rank,
      case when nullif(btrim(dispatch), '') is not null then 0 else 1 end as dispatch_rank,
      case
        when comment is not null and btrim(comment) <> '' and comment !~* '^Week\d+$' then 0
        else 1
      end as comment_rank,
      case when bare_load = tour_id then 0 else 1 end as tour_rank
    from base
    where tour_id is not null and tour_id <> ''
  ),
  best as (
    select distinct on (tour_id)
      tour_id, id, driver_name, driver_paid, amazon_paid, comment, dispatch, mile, broker, source,
      is_tour_level
    from usable
    order by
      tour_id,
      tour_rank,
      source_rank,
      dispatch_rank,
      comment_rank,
      amazon_paid desc nulls last,
      updated_at desc nulls last,
      created_at desc nulls last
  ),
  paid_override as (
    select distinct on (tour_id)
      tour_id, driver_paid
    from usable
    where (is_tour_level or source = 'manual')
      and driver_paid is distinct from amazon_paid
    order by tour_id, source_rank, updated_at desc nulls last
  ),
  ids as (
    select tour_id, array_agg(id order by id) as legacy_report_ids
    from usable
    group by tour_id
  ),
  upserted as (
    insert into public.load_overrides as lo (
      tour_id, driver_name, driver_paid, comment, dispatch, mile, broker, source, legacy_report_ids, updated_at
    )
    select
      b.tour_id,
      nullif(btrim(b.driver_name), ''),
      po.driver_paid,
      coalesce(b.comment, ''),
      coalesce(b.dispatch, ''),
      nullif(btrim(b.mile), ''),
      coalesce(nullif(btrim(b.broker), ''), 'Amazon'),
      case when b.source = 'manual' then 'manual' else 'migrated' end,
      coalesce(i.legacy_report_ids, array[b.id]::uuid[]),
      now()
    from best b
    join ids i on i.tour_id = b.tour_id
    left join paid_override po on po.tour_id = b.tour_id
    on conflict (tour_id) do update set
      driver_name = coalesce(excluded.driver_name, lo.driver_name),
      driver_paid = excluded.driver_paid,
      comment = case
        when nullif(btrim(excluded.comment), '') is not null then excluded.comment
        else lo.comment
      end,
      dispatch = case
        when nullif(btrim(excluded.dispatch), '') is not null then excluded.dispatch
        else lo.dispatch
      end,
      mile = coalesce(excluded.mile, lo.mile),
      broker = coalesce(excluded.broker, lo.broker),
      legacy_report_ids = excluded.legacy_report_ids,
      updated_at = now()
    returning lo.tour_id
  )
  select count(*) into v_tours from upserted;

  migrated_tours := v_tours;
  source_report_rows := v_rows;
  return next;
end;
$$;
