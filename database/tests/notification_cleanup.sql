begin;

do $$
begin
  assert to_regprocedure('public.delete_notification(uuid)') is not null,
    'Personal notification deletion RPC is missing';
  assert to_regprocedure('public.restore_notification(uuid,timestamptz)') is not null,
    'Personal notification undo RPC is missing';
  assert to_regprocedure('public.delete_read_notifications(text)') is not null,
    'Bulk notification deletion RPC is missing';
  assert to_regprocedure('public.hide_announcement(uuid)') is not null,
    'Announcement hiding RPC is missing';
  assert to_regprocedure('public.run_notification_cleanup()') is not null,
    'Notification cleanup RPC is missing';
end;
$$;

insert into auth.users(id, email) values
  ('ad000000-0000-4000-8000-000000000001', 'notification-delete-owner@example.invalid'),
  ('ad000000-0000-4000-8000-000000000002', 'notification-delete-other@example.invalid'),
  ('ad000000-0000-4000-8000-000000000003', 'notification-delete-disabled@example.invalid'),
  ('ad000000-0000-4000-8000-000000000004', 'notification-delete-admin@example.invalid');
update public.profiles set is_disabled = true
where id = 'ad000000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin'
where id = 'ad000000-0000-4000-8000-000000000004';

insert into public.notifications(id, user_id, category, event_key, title, message, created_at, read_at) values
  ('ae000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001',
    'form_status', 'delete-own-unread', 'Unread', '', now(), null),
  ('ae000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000002',
    'form_status', 'delete-other-read', 'Other account', '', now(), now()),
  ('ae000000-0000-4000-8000-000000000003', 'ad000000-0000-4000-8000-000000000001',
    'automation_failed', 'delete-other-category', 'Other category', '', now(), now()),
  ('ae000000-0000-4000-8000-000000000004', 'ad000000-0000-4000-8000-000000000003',
    'form_status', 'delete-disabled-account', 'Disabled account', '', now(), now());

insert into public.notifications(user_id, category, event_key, title, message, read_at)
select 'ad000000-0000-4000-8000-000000000001', 'form_status', 'delete-page-' || i, 'Read', '', now()
from generate_series(1, 120) i;

insert into survey_announcements.announcements(id, title, message, audience, display_mode,
    require_acknowledgement, status, publish_at) values
  ('af000000-0000-4000-8000-000000000001', 'Optional', 'Example', 'user', 'banner', false, 'published', now()),
  ('af000000-0000-4000-8000-000000000002', 'Mandatory', 'Example', 'user', 'modal', true, 'published', now()),
  ('af000000-0000-4000-8000-000000000003', 'For administrators', 'Example', 'admin', 'feed', false, 'published', now()),
  ('af000000-0000-4000-8000-000000000004', 'Scheduled', 'Example', 'user', 'feed', false, 'published', now() + interval '1 day');

set local role authenticated;
do $$
declare
  owner constant uuid := 'ad000000-0000-4000-8000-000000000001';
  other_user constant uuid := 'ad000000-0000-4000-8000-000000000002';
  own_notification constant uuid := 'ae000000-0000-4000-8000-000000000001';
  other_notification constant uuid := 'ae000000-0000-4000-8000-000000000002';
  optional_notice constant uuid := 'af000000-0000-4000-8000-000000000001';
  mandatory_notice constant uuid := 'af000000-0000-4000-8000-000000000002';
  first_delete timestamptz;
  second_delete timestamptz;
  bulk_id uuid;
  bulk_deleted_at timestamptz;
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);
  assert public.notification_unread_count() = 3, 'Unexpected starting personal or announcement unread count';
  assert public.delete_notification(other_notification) is null, 'Another account’s notification was removed';

  first_delete := public.delete_notification(own_notification);
  assert first_delete is not null, 'Personal notification was not removed';
  assert public.delete_notification(own_notification) is null, 'Already hidden item produced a new undo token';
  assert not exists (select from public.list_notification_feed(p_read => 'unread') where id = own_notification),
    'Deleted item is still in the feed';
  assert public.notification_unread_count() = 2, 'Deleted item remains in the unread count';
  assert public.mark_notifications_read(own_notification) = 0, 'Deleted item was marked as read';
  assert (select deleted_at from public.notifications where id = own_notification) = first_delete,
    'Owner cannot receive the tombstone from Realtime';
  perform set_config('request.jwt.claim.sub', other_user::text, true);
  assert not exists (select from public.notifications where id = own_notification), 'Tombstone leaked to another account';
  assert not public.restore_notification(own_notification, first_delete), 'Another account restored the deleted item';

  perform set_config('request.jwt.claim.sub', owner::text, true);
  assert public.restore_notification(own_notification, first_delete), 'Valid undo failed';
  assert not public.restore_notification(own_notification, first_delete), 'Replayed undo reported success';
  second_delete := public.delete_notification(own_notification);
  assert second_delete > first_delete, 'A second deletion did not replace the undo token';
  assert not public.restore_notification(own_notification, first_delete), 'Stale token restored a new deletion';
  assert public.restore_notification(own_notification, second_delete), 'Second deletion could not be undone';
  assert public.notification_unread_count() = 3, 'Undo did not restore unread state';

  assert public.delete_read_notifications('form_status') = 120, 'Bulk delete missed records on other pages';
  assert public.delete_read_notifications('form_status') = 0, 'Bulk delete repeated already deleted records';
  select id, deleted_at into bulk_id, bulk_deleted_at from public.notifications where event_key = 'delete-page-1';
  assert not public.restore_notification(bulk_id, bulk_deleted_at), 'An undo token restored a bulk deletion';
  assert exists (select from public.list_notification_feed() where id = own_notification and read_at is null),
    'Bulk delete removed an unread personal notification';
  assert exists (select from public.list_notification_feed('automation_failed', 'read')),
    'Bulk delete ignored its category filter';
  assert public.claim_announcement_prompt(mandatory_notice, 'modal'), 'Mandatory prompt was not claimable';
  assert not public.hide_announcement(mandatory_notice), 'Required acknowledgement was bypassed';
  perform public.acknowledge_announcement(mandatory_notice);
  assert public.delete_read_notifications() = 1, 'Unfiltered delete missed a remaining read personal item';
  assert exists (select from public.list_notification_feed('announcement', 'read') where id = mandatory_notice),
    'Bulk deletion removed an announcement';

  assert public.hide_announcement(mandatory_notice), 'Acknowledged announcement could not be hidden';
  assert public.hide_announcement(optional_notice), 'Optional announcement could not be hidden before reading';
  assert not public.hide_announcement(optional_notice), 'An already hidden announcement was changed again';
  assert public.notification_unread_count() = 1, 'Hidden announcement remains in the unread count';
  assert public.mark_notifications_read(optional_notice) = 0, 'Hidden announcement state was marked as read';
  assert not exists (select from public.list_notification_feed('announcement')), 'Hidden announcements remain in the feed';
  assert not exists (select from public.list_announcement_prompts(array[optional_notice, mandatory_notice])),
    'A hidden announcement remained eligible as a prompt';
  assert not public.claim_announcement_prompt(optional_notice, 'banner'), 'Hidden prompt can still be claimed';
  assert not public.hide_announcement('af000000-0000-4000-8000-000000000003'), 'An ineligible announcement was hidden';
  assert not public.hide_announcement('af000000-0000-4000-8000-000000000004'), 'A future announcement was hidden';

  perform set_config('request.jwt.claim.sub', other_user::text, true);
  assert (select count(*) from public.list_notification_feed('announcement')) = 2,
    'Another account lost its announcements';
  assert exists (select from public.list_notification_feed('form_status', 'read') where id = other_notification),
    'Another account lost its personal notification';

  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000003', true);
  begin
    perform public.delete_read_notifications();
    raise exception 'A disabled account deleted notifications';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  assert exists (select from survey_announcements.recipient_state
    where announcement_id = 'af000000-0000-4000-8000-000000000002'
      and presented_at is not null and read_at is not null and acknowledged_at is not null and hidden_at is not null),
    'Hiding altered the required announcement’s delivery or acknowledgement state';
  assert exists (select from survey_announcements.recipient_state
    where announcement_id = 'af000000-0000-4000-8000-000000000001'
      and presented_at is null and read_at is null and acknowledged_at is null and hidden_at is not null),
    'Hiding an unread optional announcement changed its other state';
  assert not has_function_privilege('anon', 'public.delete_notification(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.restore_notification(uuid,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.delete_read_notifications(text)', 'execute')
    and not has_function_privilege('anon', 'public.hide_announcement(uuid)', 'execute'),
    'An anonymous caller received a mutation grant';
  assert not has_function_privilege('authenticated', 'public.run_notification_cleanup()', 'execute')
    and not has_function_privilege('anon', 'public.run_notification_cleanup()', 'execute'),
    'Cleanup is executable by an API client';
  assert not has_schema_privilege('authenticated', 'survey_automation', 'usage'),
    'Durable notification keys are exposed to authenticated clients';
end;
$$;

set local role authenticated;
do $$
declare
  optional_notice constant uuid := 'af000000-0000-4000-8000-000000000001';
  updated timestamptz;
begin
  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000002', true);
  assert public.claim_announcement_prompt(optional_notice, 'banner'), 'Other account could not claim the optional prompt';
  assert public.mark_notifications_read(optional_notice) = 1, 'Other account could not mark the prompt read';
  assert public.hide_announcement(optional_notice), 'Other account could not hide the optional prompt';

  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000004', true);
  select updated_at into updated from public.list_admin_announcements('published') where id = optional_notice;
  assert public.save_announcement(optional_notice, updated,
    '{"title":"Now mandatory","message":"Example","audience":"user","display_mode":"banner","require_acknowledgement":true}',
    'keep', null) = optional_notice, 'An administrator could not require acknowledgement on a published announcement';

  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000002', true);
  assert exists (select from public.list_notification_feed('announcement', 'read') where id = optional_notice),
    'Newly mandatory announcement remained hidden from a reader';
  assert exists (select from public.list_announcement_prompts(array[optional_notice])
    where id = optional_notice and presented_at = now() and read_at = now() and acknowledged_at is null),
    'Requiring acknowledgement cleared or changed another account’s earlier state';

  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000001', true);
  assert public.notification_unread_count() = 2, 'Newly mandatory announcement remained outside the unread count';
  assert exists (select from public.list_announcement_prompts() where id = optional_notice),
    'Newly mandatory announcement remained hidden from the prompt list';
  assert public.claim_announcement_prompt(optional_notice, 'banner'), 'Newly mandatory prompt could not be claimed';
  assert not public.hide_announcement(optional_notice), 'Old hide bypassed new acknowledgement requirement';
  perform public.acknowledge_announcement(optional_notice);
  assert public.hide_announcement(optional_notice), 'Newly mandatory announcement could not be hidden after acknowledgement';
end;
$$;
reset role;

insert into public.notifications(user_id, category, event_key, title, message, created_at, read_at, deleted_at, undoable)
select 'ad000000-0000-4000-8000-000000000001', 'form_status', event_key, 'Retention', '',
  now() - interval '100 days', read_at, deleted_at, event_key = 'retain-manual-read'
from (values
  ('purge-manual-unread', null::timestamptz, now() - interval '7 days'),
  ('purge-manual-read', now() - interval '3 days', now() - interval '8 days'),
  ('purge-active-read', now() - interval '90 days', null::timestamptz),
  ('retain-manual-read', now() - interval '95 days', now() - interval '6 days'),
  ('retain-active-read', now() - interval '89 days', null::timestamptz),
  ('retain-active-unread', null::timestamptz, null::timestamptz)
) n(event_key, read_at, deleted_at);

set local role authenticated;
do $$
declare
  expired_id uuid;
  expired_token timestamptz;
begin
  perform set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000001', true);
  select id, deleted_at into expired_id, expired_token from public.notifications where event_key = 'retain-manual-read';
  assert not public.restore_notification(expired_id, expired_token), 'An expired undo token restored a notification';
end;
$$;
reset role;
set local role service_role;
do $$
begin
  assert public.run_notification_cleanup() = 3, 'Cleanup did not apply the 7-day and 90-day retention rules';
  assert public.run_notification_cleanup() is null, 'Cleanup ran twice within 24 hours';
end;
$$;
reset role;

do $$
declare
  owner constant uuid := 'ad000000-0000-4000-8000-000000000001';
  other_user constant uuid := 'ad000000-0000-4000-8000-000000000002';
begin
  assert not exists (select from public.notifications where event_key like 'purge-%'), 'Cleanup left eligible rows';
  assert (select count(*) from public.notifications where event_key like 'retain-%') = 3,
    'Cleanup removed an unread notification, a recently read one, or a recent manual deletion';
  assert (select count(*) from survey_announcements.recipient_state where hidden_at is not null) = 2,
    'Cleanup touched personal announcement preferences';
  assert (select count(*) from survey_automation.notification_cleanup_runs where removed_count = 3) = 1,
    'Cleanup did not record its run and removed row count';

  perform survey_automation.notify(owner, 'form_status', 'purge-manual-unread', 'Repeated event', '');
  perform survey_automation.notify(owner, 'form_status', 'purge-active-read', 'Repeated event', '');
  assert not exists (select from public.notifications where user_id = owner and event_key like 'purge-%'),
    'Replaying an event resurrected a purged notification';
  perform survey_automation.notify(other_user, 'form_status', 'purge-manual-unread', 'Another account event', '');
  assert exists (select from public.notifications where user_id = other_user and event_key = 'purge-manual-unread'),
    'A key issued to one account suppressed a notification for a different account';

  perform survey_automation.notify(owner, 'response_received', 'muted-event', 'Muted event', '');
  assert not exists (select from public.notifications where user_id = owner and event_key = 'muted-event'),
    'Durable deduplication broke muted preferences';
  insert into public.notification_preferences(user_id, muted_categories) values (owner, '{}');
  perform survey_automation.notify(owner, 'response_received', 'muted-event', 'Newly unmuted event', '');
  assert exists (select from public.notifications where user_id = owner and event_key = 'muted-event'),
    'A muted notification reserved an event key before being sent';
end;
$$;

update survey_automation.notification_cleanup_runs set ran_at = now() - interval '24 hours';
insert into public.notifications(user_id, category, event_key, title, message, read_at, deleted_at)
select 'ad000000-0000-4000-8000-000000000001', 'form_status', 'cleanup-batch-' || i,
  'Cleanup batch', '',
  case when i <= 2500 then now() - interval '91 days' end,
  case when i > 2500 then now() - interval '8 days' end
from generate_series(1, 5001) i;

set local role service_role;
do $$
begin
  assert public.run_notification_cleanup() = 5000, 'The next daily run did not use both batch budgets';
end;
$$;
reset role;
do $$
begin
  assert (select count(*) from public.notifications where event_key like 'cleanup-batch-%' and deleted_at is not null) = 1
    and not exists (select from public.notifications where event_key like 'cleanup-batch-%' and read_at is not null),
    'The first batch favored one group of eligible rows over the other';
end;
$$;
set local role service_role;
do $$
begin
  assert public.run_notification_cleanup() = 1, 'The next check did not clear the unfinished sweep';
  assert public.run_notification_cleanup() is null, 'A completed sweep did not restore the daily interval';
end;
$$;

rollback;
