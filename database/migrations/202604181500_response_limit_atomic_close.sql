begin;

create or replace function public.ensure_form_response_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_exists boolean;
begin
  update public.forms f
  set responses_count = f.responses_count + 1,
      is_public = case
        when f.max_responses is not null and f.responses_count + 1 >= f.max_responses then false
        else f.is_public
      end
  where f.id = new.form_id
    and (
      f.max_responses is null
      or f.responses_count < f.max_responses
    );

  if found then
    return new;
  end if;

  select exists (
    select 1
    from public.forms f
    where f.id = new.form_id
  )
  into form_exists;

  if not form_exists then
    return new;
  end if;

  raise exception 'Достигнут лимит ответов для формы' using errcode = '23514';

  return new;
end;
$$;

drop trigger if exists responses_close_form_at_limit on public.responses;
drop function if exists public.close_form_when_response_limit_reached();

update public.forms
set is_public = false
where is_public = true
  and max_responses is not null
  and responses_count >= max_responses;

commit;
