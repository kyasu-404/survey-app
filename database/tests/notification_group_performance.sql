begin;

insert into auth.users(id, email) values
  ('ca000000-0000-4000-8000-000000000001', 'notification-page-scale@example.invalid');

-- The requested page falls deep in the history. Each form has two events on the same UTC day.
insert into public.notifications(id, user_id, category, event_key, title, message, form_id, created_at, read_at)
select md5('notification-event-' || n)::uuid, 'ca000000-0000-4000-8000-000000000001',
  'response_received', 'feed-page-scale-' || n, 'Notification', '',
  md5('notification-form-' || (((n - 1) / 2) % 100))::uuid,
  '2025-01-01 00:00+00'::timestamptz + ((n - 1) / 200) * interval '24 hours'
    + (((n - 1) / 2) % 100) * interval '2 minutes' + (n % 2) * interval '1 minute',
  case when ((n - 1) / 2) % 4 = 0 then now() end
from generate_series(1, 50000) n;

analyze public.notifications;

do $$
declare
  cursor_id constant uuid := md5('notification-event-20000')::uuid;
  cursor_at constant timestamptz := '2025-01-01 00:00+00'::timestamptz + interval '99 days 198 minutes';
  read_filter text;
  rows_before bigint;
  rows_after bigint;
  page_count integer;
  grouped_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
  foreach read_filter in array array['all', 'read', 'unread'] loop
    select coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) into rows_before
    from pg_stat_xact_user_tables where relid = 'public.notifications'::regclass;

    select count(*), count(*) filter (where response_group->>'count' = '2')
    into page_count, grouped_count
    from public.list_notification_feed(null, read_filter, cursor_at, cursor_id, 5, 'UTC');

    select coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) into rows_after
    from pg_stat_xact_user_tables where relid = 'public.notifications'::regclass;
    raise notice 'Grouped feed (%) read % notification rows of 50,000 for a page of %',
      read_filter, rows_after - rows_before, page_count;
    assert page_count = 5 and grouped_count = 5, 'The deep page omitted items or recomputed groups after the cursor';
    assert rows_after - rows_before < 2500, 'A single feed page read too much of the notification history';
  end loop;
end;
$$;

rollback;
