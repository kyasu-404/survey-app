begin;

alter table public.notification_preferences
  alter column muted_categories set default array['response_received'];

update public.notification_preferences
set muted_categories = array_append(muted_categories, 'response_received')
where not muted_categories @> array['response_received'];

create or replace function survey_automation.notify(
  p_user_id uuid, p_category text, p_key text, p_title text, p_message text,
  p_form_id uuid default null, p_response_id uuid default null, p_rule_id uuid default null
)
returns void language sql set search_path = '' as $$
  insert into public.notifications(user_id,category,event_key,title,message,form_id,response_id,rule_id)
  select p_user_id,p_category,p_key,p_title,p_message,p_form_id,p_response_id,p_rule_id
  from public.profiles p left join public.notification_preferences n on n.user_id=p.id
  where p.id=p_user_id and not p.is_disabled
    and not (coalesce(n.muted_categories, array['response_received']) @> array[p_category])
  on conflict (user_id,event_key) do nothing;
$$;

notify pgrst,'reload schema';
commit;
