begin;

do $$
begin
  assert to_regprocedure('public.list_notification_feed(text,text,timestamptz,uuid,integer,text)') is not null,
    'Grouped feed RPC is missing';
  assert to_regprocedure('public.list_notification_group_items(text,uuid,date,text,text,timestamptz,uuid,integer)') is not null,
    'Group items RPC is missing';
  assert not has_function_privilege('anon', 'public.list_notification_feed(text,text,timestamptz,uuid,integer,text)', 'execute')
    and not has_function_privilege('anon', 'public.list_notification_group_items(text,uuid,date,text,text,timestamptz,uuid,integer)', 'execute'),
    'Anonymous callers have access to notification grouping';
end;
$$;

insert into auth.users(id, email) values
  ('bd000000-0000-4000-8000-000000000001', 'notification-group-owner@example.invalid'),
  ('bd000000-0000-4000-8000-000000000002', 'notification-group-other@example.invalid'),
  ('bd000000-0000-4000-8000-000000000003', 'notification-group-disabled@example.invalid');
update public.profiles set is_disabled = true
where id = 'bd000000-0000-4000-8000-000000000003';

insert into public.notifications(id, user_id, category, event_key, title, message, form_id, created_at, read_at, deleted_at)
select ('be000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('bd000000-0000-4000-8000-' || lpad(account::text, 12, '0'))::uuid,
  category, 'group-test-' || i, 'Notification ' || i, '', form_id::uuid, created_at::timestamptz,
  case when is_read then now() end, case when is_deleted then now() end
from (values
  (1, 1, 'response_received', 'bf000000-0000-4000-8000-000000000001', '2026-01-01 10:00+00', false, false),
  (2, 1, 'response_received', 'bf000000-0000-4000-8000-000000000001', '2026-01-01 20:30+00', true, false),
  (3, 1, 'response_received', 'bf000000-0000-4000-8000-000000000001', '2026-01-01 22:30+00', false, false),
  (4, 1, 'response_received', 'bf000000-0000-4000-8000-000000000001', '2026-01-02 01:30+00', true, false),
  (5, 1, 'response_received', 'bf000000-0000-4000-8000-000000000001', '2026-01-02 02:30+00', false, true),
  (6, 1, 'response_updated',  'bf000000-0000-4000-8000-000000000001', '2026-01-01 23:30+00', false, false),
  (7, 1, 'response_updated',  'bf000000-0000-4000-8000-000000000001', '2026-01-02 00:30+00', false, false),
  (8, 1, 'response_received', 'bf000000-0000-4000-8000-000000000002', '2026-01-02 00:45+00', false, false),
  (9, 1, 'response_received', null, '2026-01-02 03:30+00', false, false),
  (10, 1, 'form_status',      'bf000000-0000-4000-8000-000000000001', '2026-01-02 00:00+00', false, false),
  (11, 2, 'response_received','bf000000-0000-4000-8000-000000000001', '2026-01-02 10:00+00', false, false),
  (12, 3, 'response_received','bf000000-0000-4000-8000-000000000001', '2026-01-02 11:00+00', false, false)
) n(i, account, category, form_id, created_at, is_read, is_deleted);

insert into survey_announcements.announcements(id, title, message, audience, display_mode, status, publish_at) values
  ('bc000000-0000-4000-8000-000000000001', 'Visible', 'Example', 'user', 'feed', 'published', '2026-01-02 00:15+00'),
  ('bc000000-0000-4000-8000-000000000002', 'Hidden', 'Example', 'user', 'feed', 'published', '2026-01-02 04:00+00');
insert into survey_announcements.recipient_state(announcement_id, user_id, hidden_at)
values ('bc000000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-000000000001', now());

set local role authenticated;
do $$
declare
  owner constant uuid := 'bd000000-0000-4000-8000-000000000001';
  other_user constant uuid := 'bd000000-0000-4000-8000-000000000002';
  form constant uuid := 'bf000000-0000-4000-8000-000000000001';
  item1 constant uuid := 'be000000-0000-4000-8000-000000000001';
  item2 constant uuid := 'be000000-0000-4000-8000-000000000002';
  item3 constant uuid := 'be000000-0000-4000-8000-000000000003';
  item4 constant uuid := 'be000000-0000-4000-8000-000000000004';
  update_id constant uuid := 'be000000-0000-4000-8000-000000000007';
  different_form constant uuid := 'be000000-0000-4000-8000-000000000008';
  no_form constant uuid := 'be000000-0000-4000-8000-000000000009';
  form_status constant uuid := 'be000000-0000-4000-8000-000000000010';
  foreign_id constant uuid := 'be000000-0000-4000-8000-000000000011';
  visible_notice constant uuid := 'bc000000-0000-4000-8000-000000000001';
  local_zone constant text := 'Europe/Moscow';
  page uuid[];
  representative record;
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);

  select array_agg(f.id) into page from public.list_notification_feed(null, 'all', null, null, 2, local_zone) f;
  assert page = array[no_form, item4], 'First page did not use raw representative ordering';
  select * into representative from public.list_notification_feed(null, 'all', null, null, 2, local_zone) f where f.id = item4;
  assert representative.response_group = '{"day":"2026-01-02","count":2,"unread_count":1}',
    'Grouping used UTC, included deleted/foreign items, or miscounted unread notifications';
  assert exists (select from public.list_notification_feed(null, 'all', null, null, 2, local_zone)
    where id = no_form and response_group is null), 'A response without a form was grouped';

  select array_agg(f.id) into page from public.list_notification_feed(null, 'all',
    representative.created_at, representative.id, 4, local_zone) f;
  assert page = array[different_form, update_id, visible_notice, form_status],
    'Collapsed keyset split a group, combined forms/categories, or changed announcement visibility';
  select array_agg(f.id) into page from public.list_notification_feed(null, 'all',
    '2026-01-02 00:00+00', form_status, 3, local_zone) f;
  assert page = array[item2], 'An older representative was omitted or an existing group repeated';

  assert exists (select from public.list_notification_feed('response_updated', 'all', null, null, 26, local_zone)
    where id = update_id and response_group = '{"day":"2026-01-02","count":2,"unread_count":2}'),
    'Response updates were not grouped separately';
  assert exists (select from public.list_notification_feed('response_received', 'all', null, null, 26, 'not/a/zone')
    where id = item3 and response_group = '{"day":"2026-01-01","count":3,"unread_count":2}'),
    'The grouped feed did not fall back to UTC for an invalid time zone';
  select array_agg(f.id) into page from public.list_notification_feed('response_received', 'read', null, null, 26, local_zone) f;
  assert page = array[item4, item2] and not exists (
    select from public.list_notification_feed('response_received', 'read', null, null, 26, local_zone)
    where response_group ->> 'count' is distinct from '1'), 'Read rows were grouped before applying the filter';
  assert exists (select from public.list_notification_feed('response_received', 'read', null, null, 26, local_zone)
    where id = item4 and response_group = '{"day":"2026-01-02","count":1,"unread_count":0}'),
    'A singleton representative lost its calendar group identity';
  select array_agg(f.id) into page from public.list_notification_feed('response_received', 'unread', null, null, 26, 'UTC') f;
  assert page = array[no_form, different_form, item3] and exists (
    select from public.list_notification_feed('response_received', 'unread', null, null, 26, 'UTC')
    where id = item3 and response_group = '{"day":"2026-01-01","count":2,"unread_count":2}'),
    'Unread totals did not match the filtered group';
  assert exists (select from public.list_notification_feed('response_received') where id = item3)
    and exists (select from public.list_notification_feed('response_received') where id = item4),
    'The legacy notification feed collapsed response rows';

  select array_agg(f.id) into page from public.list_notification_group_items(
    'response_received', form, '2026-01-02', 'all', local_zone, null, null, 1) f;
  assert page = array[item4], 'Group detail returned the wrong first item or ignored the limit';
  select array_agg(f.id) into page from public.list_notification_group_items(
    'response_received', form, '2026-01-02', 'all', local_zone, '2026-01-02 01:30+00', item4, 26) f;
  assert page = array[item3], 'Group detail cursor repeated the representative or admitted rows outside its day or scope';
  select array_agg(f.id) into page from public.list_notification_group_items(
    'response_received', form, '2026-01-02', 'unread', local_zone, null, null, 26) f;
  assert page = array[item3], 'Group detail did not apply the active unread filter';
  select array_agg(f.id) into page from public.list_notification_group_items(
    'response_received', form, '2026-01-01', 'all', 'not/a/zone', null, null, 26) f;
  assert page = array[item3, item2, item1], 'Group detail did not use the same fallback to UTC as the feed';
  assert not exists (select from public.list_notification_group_items(
    'form_status', form, '2026-01-02', 'all', local_zone, null, null, 26)),
    'A non-groupable category returned group details';
  begin
    perform public.list_notification_feed(null, 'all', now(), null, 26, local_zone);
    raise exception 'Grouped feed accepted an incomplete cursor';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.list_notification_group_items('response_received', form, '2026-01-02', 'all', local_zone, null, item4, 26);
    raise exception 'Group detail accepted an incomplete cursor';
  exception when invalid_parameter_value then null;
  end;

  perform set_config('request.jwt.claim.sub', other_user::text, true);
  select array_agg(f.id) into page from public.list_notification_group_items(
    'response_received', form, '2026-01-02', 'all', local_zone, null, null, 26) f;
  assert page = array[foreign_id], 'Group detail exposed another person’s notifications';
  perform set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000003', true);
  assert not exists (select from public.list_notification_feed(null, 'all', null, null, 26, local_zone)),
    'Disabled account received grouped notifications';
  assert not exists (select from public.list_notification_group_items(
    'response_received', form, '2026-01-02', 'all', local_zone, null, null, 26)),
    'Disabled account received group details';
end;
$$;
reset role;

-- Havana's midnight hour occurs twice on this date. Both UTC instants belong to the same local group.
insert into public.notifications(user_id, category, event_key, title, message, form_id, created_at) values
  ('bd000000-0000-4000-8000-000000000001', 'response_received', 'group-dst-1', 'First midnight', '',
    'bf000000-0000-4000-8000-000000000003', '2025-11-02 04:30+00'),
  ('bd000000-0000-4000-8000-000000000001', 'response_received', 'group-dst-2', 'Second midnight', '',
    'bf000000-0000-4000-8000-000000000003', '2025-11-02 05:30+00');

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000001', true);
  assert exists (select from public.list_notification_feed('response_received', 'all', null, null, 26, 'America/Havana')
    where form_id = 'bf000000-0000-4000-8000-000000000003' and response_group = '{"day":"2025-11-02","count":2,"unread_count":2}'),
    'The two occurrences of local midnight were not grouped';
  assert (select count(*) from public.list_notification_group_items(
    'response_received', 'bf000000-0000-4000-8000-000000000003', '2025-11-02',
    'all', 'America/Havana', null, null, 26)) = 2, 'Group detail lost an item at the repeated midnight boundary';
end;
$$;
reset role;

rollback;
