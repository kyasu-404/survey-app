begin;

insert into auth.users(id, email) values
  ('aa000000-0000-4000-8000-000000000001', 'announcements-admin-one@example.invalid'),
  ('aa000000-0000-4000-8000-000000000002', 'announcements-admin-two@example.invalid'),
  ('aa000000-0000-4000-8000-000000000003', 'announcements-reader-one@example.invalid'),
  ('aa000000-0000-4000-8000-000000000004', 'announcements-reader-two@example.invalid'),
  ('aa000000-0000-4000-8000-000000000005', 'announcements-disabled@example.invalid');

update public.profiles set role = 'admin'
where id in ('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002');
update public.profiles set is_disabled = true where id = 'aa000000-0000-4000-8000-000000000005';

insert into public.notifications(id, user_id, category, event_key, title, message, created_at) values
  ('ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000003',
    'form_status', 'announcements-check-own', 'Личное', '', now() - interval '1 hour'),
  ('ab000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000004',
    'response_received', 'announcements-check-other', 'Чужое', '', now() - interval '1 hour');

-- Rows written before service events were removed must stay outside the personal feed.
insert into public.notifications(user_id, category, event_key, title, message)
select viewer.id, category, category, 'Legacy service event', ''
from public.profiles viewer
cross join unnest(array['automation_triggered', 'automation_succeeded']) as category
where viewer.id in ('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000003');

set local role authenticated;
do $$
declare
  viewer_id uuid;
  expected_visible integer;
begin
  for viewer_id, expected_visible in
    select * from (values
      ('aa000000-0000-4000-8000-000000000001'::uuid, 0),
      ('aa000000-0000-4000-8000-000000000003'::uuid, 1)
    ) as viewers(id, visible)
  loop
    perform set_config('request.jwt.claim.sub', viewer_id::text, true);
    assert (select count(*) from public.notifications) = expected_visible, 'Legacy service events passed RLS';
    assert (select count(*) from public.list_notification_feed()) = expected_visible, 'Legacy service events appeared in the feed';
    assert not exists (select from public.list_notification_feed('automation_triggered')), 'Legacy category filter returned rows';
    assert not exists (select from public.list_notification_feed('automation_succeeded', 'unread')), 'Legacy success filter returned rows';
    assert public.notification_unread_count() = expected_visible, 'Legacy service events inflated the unread count';
    assert public.mark_notifications_read(null) = expected_visible, 'Bulk read included hidden service events';
    perform public.save_notification_preferences(array['automation_triggered','response_updated','automation_succeeded']);
    assert (select muted_categories from public.notification_preferences) = array['response_updated'], 'Old client saved retired preferences';
  end loop;
end;
$$;
reset role;
update public.notifications set read_at = null where event_key = 'announcements-check-own';

set local role anon;
do $$
begin
  perform public.list_notification_feed();
  raise exception 'An anonymous caller read the feed';
exception when insufficient_privilege then null;
end;
$$;

set local role authenticated;

do $$
declare
  admin_one constant uuid := 'aa000000-0000-4000-8000-000000000001';
  admin_two constant uuid := 'aa000000-0000-4000-8000-000000000002';
  reader_one constant uuid := 'aa000000-0000-4000-8000-000000000003';
  reader_two constant uuid := 'aa000000-0000-4000-8000-000000000004';
  disabled_user constant uuid := 'aa000000-0000-4000-8000-000000000005';
  own_notification constant uuid := 'ab000000-0000-4000-8000-000000000001';
  other_notification constant uuid := 'ab000000-0000-4000-8000-000000000002';
  fields constant jsonb := '{"title":"Обновление","message":"**Новый отчёт**","audience":"user",
    "display_mode":"banner","action_label":"Справка","action_url":"/preferences","require_acknowledgement":true}';
  published_id uuid;
  scheduled_id uuid;
  draft_id uuid;
  duplicate_id uuid;
  admin_notice_id uuid;
  stamp timestamptz;
  first_read timestamptz;
  first_acknowledgement timestamptz;
  entry record;
  reader_population int;
begin
  assert not has_function_privilege('anon', 'public.list_notification_feed(text,text,timestamptz,uuid,integer)', 'execute'),
    'Anonymous can execute the feed';
  assert not has_function_privilege('anon', 'public.save_announcement(uuid,timestamptz,jsonb,text,timestamptz)', 'execute'),
    'Anonymous can execute announcement management';
  assert not has_schema_privilege('authenticated', 'survey_announcements', 'usage'),
    'Private state schema is exposed';

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  begin
    perform public.save_announcement(null, null, fields, 'publish', null);
    raise exception 'A regular user published an announcement';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_admin_announcements('draft');
    raise exception 'A regular user read the management list';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', admin_one::text, true);
  begin
    perform public.list_admin_announcements('draft', p_before_id => gen_random_uuid());
    raise exception 'The admin announcement list accepted an incomplete cursor';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_announcement(null, null, fields || '{"action_url":"//example.invalid"}', 'publish', null);
    raise exception 'Accepted an unsafe action link';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_announcement(null, null, fields || jsonb_build_object('expires_at', now()), 'publish', null);
    raise exception 'Accepted a publication with passed expiry';
  exception when invalid_parameter_value then null;
  end;
  draft_id := public.save_announcement(null, null, fields || '{"title":"Черновик"}', 'keep', null);
  scheduled_id := public.save_announcement(null, null, fields || jsonb_build_object(
    'title', 'Будущее объявление', 'expires_at', now() + interval '2 days'), 'schedule', now() + interval '1 day');
  admin_notice_id := public.save_announcement(null, null, fields || '{"title":"Для администраторов","audience":"admin","display_mode":"feed"}', 'publish', null);
  published_id := public.save_announcement(null, null, fields, 'publish', null);
  assert exists(select from public.list_admin_announcements('scheduled') where id = scheduled_id), 'Schedule was not saved';
  assert exists(select from public.list_admin_announcements('draft') where id = draft_id), 'Draft was not saved';
  assert not exists(select from public.list_notification_feed() where id = published_id), 'User-only notice leaked to an admin';
  assert exists(select from public.list_notification_feed() where id = admin_notice_id), 'Admin-only notice is unavailable to an admin';

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  begin
    perform public.change_announcement(published_id, null, 'withdraw');
    raise exception 'A regular user changed an announcement';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', disabled_user::text, true);
  assert not exists(select from public.list_notification_feed()), 'Disabled user could read the feed';
  assert public.notification_unread_count() = 0, 'Disabled user could count notifications';
  assert not exists(select from public.list_announcement_prompts()), 'Disabled user could see prompts';
  begin
    perform public.mark_notifications_read(null);
    raise exception 'A disabled user changed read status';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  select * into entry from public.list_notification_feed(p_limit => 1);
  assert entry.id = published_id and entry.announcement->>'action_url' = '/preferences', 'Announcement missing from combined feed';
  assert exists(select from public.list_notification_feed(p_before_at => entry.created_at, p_before_id => entry.id) where id = own_notification),
    'Pagination skipped the preceding personal notification';
  assert not exists(select from public.list_notification_feed() where id in (draft_id, scheduled_id, admin_notice_id, other_notification)),
    'Feed leaked a draft, schedule, another audience or another user';
  assert public.notification_unread_count() = 2, 'Unread count excludes a notice or includes another user';
  assert exists(select from public.list_announcement_prompts() where id = published_id and presented_at is null),
    'Banner is not offered to its intended audience';
  assert not public.claim_announcement_prompt(published_id, 'modal'), 'A banner was claimed as a modal';
  assert public.claim_announcement_prompt(published_id, 'banner'), 'First presentation was rejected';
  assert not public.claim_announcement_prompt(published_id, 'banner'), 'Duplicate presentation was allowed';
  assert not exists(select from public.list_announcement_prompts() where id = published_id), 'Claimed banner is still being offered';
  assert exists(select from public.list_announcement_prompts(array[published_id]) where id = published_id and presented_at is not null),
    'A mounted banner lost its state during refresh';

  begin
    perform public.acknowledge_announcement(admin_notice_id);
    raise exception 'User acknowledged an out-of-audience announcement';
  exception when insufficient_privilege then null;
  end;
  perform public.mark_notifications_read(null);
  assert public.notification_unread_count() = 0, 'Mark all failed to clear both kinds of unread messages';
  select * into entry from public.list_notification_feed('announcement', 'read') where id = published_id;
  assert entry.read_at is not null and entry.announcement->>'acknowledged_at' is null, 'Mark all implicitly acknowledged an announcement';
  first_read := entry.read_at;

  perform set_config('request.jwt.claim.sub', admin_two::text, true);
  select audience_count, familiar_count, updated_at into entry
  from public.list_admin_announcements('published') where id = published_id;
  reader_population := entry.audience_count;
  assert reader_population >= 2 and entry.familiar_count = 0, 'An important announcement counted a read as acknowledgement';
  stamp := entry.updated_at;

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  perform public.acknowledge_announcement(published_id);
  select (announcement->>'acknowledged_at')::timestamptz into first_acknowledgement
  from public.list_notification_feed('announcement') where id = published_id;
  assert first_acknowledgement is not null, 'Acknowledgement was not stored';
  perform public.acknowledge_announcement(published_id);

  perform set_config('request.jwt.claim.sub', admin_two::text, true);
  assert exists(select from public.list_admin_announcements('published')
                where id = published_id and audience_count = reader_population and familiar_count = 1),
    'Acknowledgement statistics are wrong';
  perform public.save_announcement(published_id, stamp, fields || '{"title":"Уточнение","display_mode":"modal"}', 'keep', null);
  begin
    perform public.save_announcement(published_id, stamp, fields, 'keep', null);
    raise exception 'A stale edit overwrote another administrator';
  exception when serialization_failure then null;
  end;

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  assert not exists(select from public.list_announcement_prompts() where id = published_id), 'The content edit caused a repeat presentation';
  assert exists(select from public.list_notification_feed('announcement', 'read') where id = published_id
     and title = 'Уточнение' and read_at = first_read and (announcement->>'acknowledged_at')::timestamptz = first_acknowledgement),
    'An existing read state disappeared after editing';

  perform set_config('request.jwt.claim.sub', reader_two::text, true);
  assert exists(select from public.list_notification_feed('announcement', 'unread') where id = published_id and read_at is null),
    'Read state leaked to another user';
  assert exists(select from public.list_announcement_prompts() where id = published_id and display_mode = 'modal'),
    'Another user did not get the updated announcement';
  assert public.claim_announcement_prompt(published_id, 'modal'), 'A different user could not claim the prompt';
  assert exists(select from public.list_notification_feed('response_received', 'unread') where id = other_notification),
    'Mark all affected another user';

  perform set_config('request.jwt.claim.sub', admin_two::text, true);
  select updated_at into stamp from public.list_admin_announcements('published') where id = published_id;
  duplicate_id := public.change_announcement(published_id, stamp, 'duplicate');
  assert duplicate_id <> published_id and exists(select from public.list_admin_announcements('draft') where id = duplicate_id
    and publish_at is null and familiar_count = 0 and expires_at is null), 'Duplication copied publication state or did not make a draft';
  perform public.change_announcement(published_id, stamp, 'withdraw');
  assert exists(select from public.list_admin_announcements('draft') where id = published_id), 'Withdrawal did not return to drafts';

  perform set_config('request.jwt.claim.sub', reader_two::text, true);
  assert not exists(select from public.list_notification_feed('announcement') where id in (published_id, duplicate_id)),
    'Draft/withdrawn announcement remains visible';
  assert not exists(select from public.list_announcement_prompts(array[published_id])), 'Withdrawn prompt remains visible';

  perform set_config('request.jwt.claim.sub', admin_one::text, true);
  select updated_at into stamp from public.list_admin_announcements('draft') where id = published_id;
  perform public.save_announcement(published_id, stamp, fields, 'publish', null);
  select updated_at into stamp from public.list_admin_announcements('draft') where id = duplicate_id;
  perform public.save_announcement(duplicate_id, stamp, fields, 'publish', null);

  perform set_config('request.jwt.claim.sub', reader_one::text, true);
  assert not public.claim_announcement_prompt(published_id, 'banner'), 'Republishing the same ID lost the personal presentation state';
  assert public.claim_announcement_prompt(duplicate_id, 'banner'), 'A new copy did not have its own presentation state';

  perform set_config('request.jwt.claim.sub', admin_two::text, true);
  select updated_at into stamp from public.list_admin_announcements('published') where id = duplicate_id;
  perform public.change_announcement(duplicate_id, stamp, 'archive');
  assert exists(select from public.list_admin_announcements('archived') where id = duplicate_id), 'Archive status is wrong';
end;
$$;

reset role;

insert into survey_announcements.announcements(id, title, message, audience, display_mode, status, publish_at, expires_at) values
  ('ac000000-0000-4000-8000-000000000001', 'Истёкшее', 'Устарело', 'all', 'modal',
    'published', now() - interval '2 days', now() - interval '1 day'),
  ('ac000000-0000-4000-8000-000000000002', 'Начало по расписанию', 'Обновлено', 'all', 'feed',
    'published', now() - interval '1 second', now() + interval '1 day');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
do $$
declare
  expired_id constant uuid := 'ac000000-0000-4000-8000-000000000001';
  active_id constant uuid := 'ac000000-0000-4000-8000-000000000002';
  fields constant jsonb := '{"title":"Расписание","message":"Время работы","audience":"all",
    "display_mode":"feed","require_acknowledgement":false}';
  stamp timestamptz;
  expiry timestamptz;
  url text;
begin
  assert exists(select from public.list_admin_announcements('archived') where id = 'ac000000-0000-4000-8000-000000000001'),
    'Expired announcement is not in the archive';
  assert exists(select from public.list_admin_announcements('published') where id = 'ac000000-0000-4000-8000-000000000002'),
    'Scheduled announcement did not transition to published';
  assert not exists(select from public.list_notification_feed() where id = 'ac000000-0000-4000-8000-000000000001'),
    'Expired announcement remains in the feed';
  assert exists(select from public.list_notification_feed() where id = 'ac000000-0000-4000-8000-000000000002'),
    'Due scheduled announcement is missing from the feed';

  select updated_at into stamp from public.list_admin_announcements('published') where id = active_id;
  begin
    perform public.save_announcement(active_id, stamp, fields, 'schedule', now() + interval '1 day');
    raise exception 'Editing moved an active publication into the future';
  exception when serialization_failure then null;
  end;

  select updated_at, expires_at into stamp, expiry from public.list_admin_announcements('archived') where id = expired_id;
  begin
    perform public.save_announcement(expired_id, stamp, fields || jsonb_build_object('expires_at', now() + interval '1 day'), 'keep', null);
    raise exception 'Editing an archived publication changed its expiry';
  exception when serialization_failure then null;
  end;
  perform public.save_announcement(expired_id, stamp, fields || jsonb_build_object('expires_at', expiry), 'keep', null);
  assert exists(select from public.list_admin_announcements('archived') where id = expired_id and expires_at = expiry),
    'Editing the archived text did not preserve the expiry';

  foreach url in array array['https://name@example.invalid/help', 'https://:', 'https://example.invalid:99999', 'https://example.invalid:0',
    '/folder/../settings'] loop
    begin
      perform public.save_announcement(null, null, fields || jsonb_build_object('action_url', url), 'keep', null);
      raise exception 'Accepted a malformed or non-canonical announcement link';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  foreach url in array array['/preferences?from=feed#announcements', 'https://xn--e1afmkfd.xn--p1ai/help', 'http://[::1]:5173/'] loop
    perform public.save_announcement(null, null, fields || jsonb_build_object('action_url', url), 'keep', null);
  end loop;
  begin
    perform public.save_announcement(null, null, fields || jsonb_build_object('title', chr(9) || chr(10)), 'keep', null);
    raise exception 'Accepted a title made of whitespace';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
