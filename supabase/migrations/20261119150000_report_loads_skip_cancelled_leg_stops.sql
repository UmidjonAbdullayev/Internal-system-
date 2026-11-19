-- report_loads: first pickup / final drop come from ACTIVE legs only.
-- A stop on a cancelled leg is ignored for PU/Del place + date (and therefore the
-- delivery-based estimated week), unless every leg of the tour is cancelled
-- (TONU / fully cancelled tours keep their original stops).
-- Money columns are unchanged: amazon_paid = tour payout; invoice week wins over the estimate.

create or replace view public.report_loads as
 WITH trips AS (
         SELECT t.id AS trip_uuid,
            t.trip_id,
            normalize_tour_id(t.trip_id) AS tour_id,
            t.payout,
            t.total_miles,
            t.driver_name_raw,
            t.start_time,
            t.end_time,
            t.section,
            t.status,
            t.execution_status,
            t.archived,
            t.last_seen_at,
            t.updated_at
           FROM relay_trips t
          WHERE COALESCE(t.archived, false) = false AND normalize_tour_id(t.trip_id) <> ''::text
        ), leg_agg AS (
         SELECT normalize_tour_id(l.trip_id) AS tour_id,
            string_agg(DISTINCT l.load_id, '/'::text ORDER BY l.load_id) AS leg_load_ids,
            count(*)::integer AS leg_count
           FROM relay_legs l
          WHERE COALESCE(l.archived, false) = false
          GROUP BY (normalize_tour_id(l.trip_id))
        ), ordered_stops AS (
         SELECT normalize_tour_id(s.trip_id) AS tour_id,
            s.seq,
            s.stop_type,
            COALESCE(s.actual_arrival, s.scheduled_arrival, s.eta) AS pu_ts,
            COALESCE(s.actual_departure, s.scheduled_departure, s.actual_arrival, s.scheduled_arrival, s.eta) AS del_ts,
            relay_stop_place(s.city, s.state, s.facility_code, s.address) AS place,
                CASE
                    WHEN upper(COALESCE(s.stop_type, ''::text)) ~~ '%PICK%'::text THEN 0
                    ELSE 1
                END AS pu_rank,
                CASE
                    WHEN upper(COALESCE(s.stop_type, ''::text)) ~~ '%DROP%'::text OR upper(COALESCE(s.stop_type, ''::text)) ~~ '%DELIV%'::text THEN 0
                    ELSE 1
                END AS del_rank
           FROM relay_stops s
          WHERE COALESCE(s.archived, false) = false
            AND NOT (
              -- this stop's leg is cancelled …
              EXISTS (
                SELECT 1 FROM relay_legs lc
                 WHERE lc.trip_id = s.trip_id AND lc.load_id = s.load_id
                   AND COALESCE(lc.archived, false) = false
                   AND upper(COALESCE(lc.execution_status, ''::text)) ~~ '%CANCEL%'::text)
              -- … and the tour still has at least one active leg
              AND EXISTS (
                SELECT 1 FROM relay_legs la
                 WHERE la.trip_id = s.trip_id
                   AND COALESCE(la.archived, false) = false
                   AND upper(COALESCE(la.execution_status, ''::text)) !~~ '%CANCEL%'::text)
            )
        ), first_pu AS (
         SELECT DISTINCT ON (ordered_stops.tour_id) ordered_stops.tour_id,
            ordered_stops.pu_ts AS pickup_ts,
            ordered_stops.place AS pu_location
           FROM ordered_stops
          ORDER BY ordered_stops.tour_id, ordered_stops.pu_rank, ordered_stops.seq, ordered_stops.pu_ts
        ), last_del AS (
         SELECT DISTINCT ON (ordered_stops.tour_id) ordered_stops.tour_id,
            ordered_stops.del_ts AS delivery_ts,
            ordered_stops.place AS del_location
           FROM ordered_stops
          ORDER BY ordered_stops.tour_id, ordered_stops.del_rank, ordered_stops.seq DESC NULLS LAST, ordered_stops.del_ts DESC NULLS LAST
        ), base AS (
         SELECT t.trip_uuid,
            t.trip_id,
            t.tour_id,
            t.payout,
            t.total_miles,
            t.driver_name_raw,
            t.start_time,
            t.end_time,
            t.section,
            t.status,
            t.execution_status,
            t.archived,
            t.last_seen_at,
            t.updated_at,
            COALESCE(la.leg_load_ids, t.tour_id) AS load_ids,
            COALESCE(la.leg_count, 0) AS leg_count,
            COALESCE(fp.pickup_ts, t.start_time) AS tour_start_ts,
            la_date(COALESCE(fp.pickup_ts, t.start_time)) AS pickup_la,
            la_date(COALESCE(ld.delivery_ts, t.end_time)) AS delivery_la,
            COALESCE(fp.pu_location, ''::text) AS pu_location,
            COALESCE(ld.del_location, ''::text) AS del_location
           FROM trips t
             LEFT JOIN leg_agg la ON la.tour_id = t.tour_id
             LEFT JOIN first_pu fp ON fp.tour_id = t.tour_id
             LEFT JOIN last_del ld ON ld.tour_id = t.tour_id
          WHERE COALESCE(fp.pickup_ts, t.start_time) IS NOT NULL OR COALESCE(ld.delivery_ts, t.end_time) IS NOT NULL
        ), inv AS (
         SELECT money_invoice_tour_weeks.tour_id,
            money_invoice_tour_weeks.amazon_week,
            money_invoice_tour_weeks.amazon_week_year,
            money_invoice_tour_weeks.week_start,
            money_invoice_tour_weeks.week_end,
            money_invoice_tour_weeks.invoice_id,
            money_invoice_tour_weeks.invoice_total,
            money_invoice_tour_weeks.paid_status
           FROM money_invoice_tour_weeks
          WHERE COALESCE(money_invoice_tour_weeks.is_main, true) = true AND money_invoice_tour_weeks.tour_id IS NOT NULL
        )
 SELECT b.trip_uuid,
    b.trip_id,
    b.tour_id,
        CASE
            WHEN COALESCE(b.leg_count, 0) > 1 THEN
            CASE
                WHEN b.trip_id ~* '^T-'::text THEN b.trip_id
                ELSE 'T-'::text || b.tour_id
            END
            ELSE b.tour_id
        END AS trip_display,
    b.load_ids,
    b.leg_count,
    COALESCE(o.broker, 'Amazon'::text) AS broker,
    COALESCE(NULLIF(btrim(o.driver_name), ''::text), NULLIF(btrim(b.driver_name_raw), ''::text), ''::text) AS driver_name,
    b.driver_name_raw,
    b.pickup_la AS pickup_date,
    b.delivery_la AS delivery_date,
    b.pu_location,
    b.del_location,
    b.tour_start_ts,
    b.pickup_la AS tour_start_la,
    COALESCE(i.week_start, amazon_week_start(COALESCE(b.delivery_la, b.pickup_la))) AS week_start,
    COALESCE(i.week_end, amazon_week_end(COALESCE(b.delivery_la, b.pickup_la))) AS week_end,
    COALESCE(i.amazon_week, amazon_week_number(COALESCE(b.delivery_la, b.pickup_la))) AS amazon_week,
    COALESCE(i.amazon_week_year, amazon_week_year(COALESCE(b.delivery_la, b.pickup_la))) AS amazon_week_year,
    'Week'::text || lpad(COALESCE(i.amazon_week, amazon_week_number(COALESCE(b.delivery_la, b.pickup_la)))::text, 2, '0'::text) AS week_label,
    i.tour_id IS NULL AS estimated_week,
        CASE
            WHEN i.tour_id IS NOT NULL THEN 'invoice_main'::text
            ELSE 'delivery_estimate'::text
        END AS week_source,
    i.invoice_id,
    COALESCE(i.paid_status, ''::text) AS paid_status,
        CASE
            WHEN NULLIF(btrim(COALESCE(o.mile, ''::text)), ''::text) IS NOT NULL THEN btrim(o.mile)
            WHEN b.total_miles IS NOT NULL AND b.total_miles > 0::numeric THEN TRIM(BOTH FROM to_char(round(b.total_miles, 2), 'FM999999990.00'::text))
            ELSE ''::text
        END AS mile,
    round(COALESCE(b.payout, 0::numeric), 2) AS amazon_paid,
    round(COALESCE(
        CASE
            WHEN o.source = 'manual'::text THEN o.driver_paid
            ELSE NULL::numeric
        END, b.payout, 0::numeric), 2) AS driver_paid,
        CASE
            WHEN COALESCE(b.total_miles, 0::numeric) > 0::numeric THEN round(COALESCE(b.payout, 0::numeric) / b.total_miles, 4)
            ELSE 0::numeric
        END AS rpm,
    COALESCE(o.comment, ''::text) AS comment,
    COALESCE(o.dispatch, ''::text) AS dispatch,
    b.section,
    b.status,
    b.execution_status,
    b.last_seen_at,
    b.updated_at,
    o.tour_id IS NOT NULL AND o.source = 'manual'::text AS has_override,
    COALESCE(o.source, ''::text) AS override_source,
    upper(COALESCE(b.status, ''::text)) ~~ '%TONU%'::text OR upper(COALESCE(b.execution_status, ''::text)) ~~ '%TONU%'::text OR upper(COALESCE(o.mile, ''::text)) ~~ '%TONU%'::text OR COALESCE(b.payout, 0::numeric) > 0::numeric AND (upper(COALESCE(b.status, ''::text)) ~~ '%CANCEL%'::text OR upper(COALESCE(b.execution_status, ''::text)) ~~ '%CANCEL%'::text) AS is_tonu,
        CASE
            WHEN upper(COALESCE(b.status, ''::text)) = 'COMPLETED'::text OR upper(COALESCE(b.status, ''::text)) ~~ '%TONU%'::text OR upper(COALESCE(b.execution_status, ''::text)) ~~ '%TONU%'::text OR upper(COALESCE(o.mile, ''::text)) ~~ '%TONU%'::text OR COALESCE(b.payout, 0::numeric) > 0::numeric AND (upper(COALESCE(b.status, ''::text)) ~~ '%CANCEL%'::text OR upper(COALESCE(b.execution_status, ''::text)) ~~ '%CANCEL%'::text) THEN
            CASE
                WHEN i.tour_id IS NOT NULL THEN 'income'::text
                ELSE 'pending_invoice'::text
            END
            ELSE 'expected'::text
        END AS money_bucket
   FROM base b
     LEFT JOIN load_overrides o ON o.tour_id = b.tour_id
     LEFT JOIN inv i ON i.tour_id = b.tour_id;
