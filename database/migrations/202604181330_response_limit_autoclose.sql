begin;

create or replace function public.enforce_form_response_limit_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.max_responses is not null and new.max_responses < new.responses_count then
    raise exception 'Лимит ответов не может быть меньше количества уже полученных ответов' using errcode = '23514';
  end if;

  if new.max_responses is not null and new.responses_count >= new.max_responses then
    if tg_op = 'UPDATE' then
      if old.is_public = false and new.is_public = true then
        raise exception 'Сначала уберите или повысьте лимит ответов' using errcode = '23514';
      end if;
    end if;

    new.is_public := false;
  end if;

  return new;
end;
$$;

drop trigger if exists forms_enforce_response_limit_settings on public.forms;
create trigger forms_enforce_response_limit_settings
before insert or update of max_responses, is_public on public.forms
for each row execute procedure public.enforce_form_response_limit_settings();

create or replace function public.close_form_when_response_limit_reached()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set is_public = false
  where f.id = new.form_id
    and f.is_public = true
    and f.max_responses is not null
    and f.responses_count >= f.max_responses;

  return new;
end;
$$;

drop trigger if exists responses_close_form_at_limit on public.responses;
create trigger responses_close_form_at_limit
after insert on public.responses
for each row execute procedure public.close_form_when_response_limit_reached();

update public.forms
set is_public = false
where is_public = true
  and max_responses is not null
  and responses_count >= max_responses;

commit;
