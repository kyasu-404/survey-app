begin;

alter table public.forms
add column if not exists author_name text not null default '';

update public.forms f
set author_name = coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1), f.author_id::text)
from public.profiles p
where p.id = f.author_id
  and f.author_name = '';

create or replace function public.set_form_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1), new.author_id::text)
  into new.author_name
  from public.profiles p
  where p.id = new.author_id;

  if new.author_name is null then
    raise exception 'Профиль автора формы не найден' using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists forms_set_author_name on public.forms;

create trigger forms_set_author_name
before insert or update of author_id on public.forms
for each row execute procedure public.set_form_author_name();

create or replace function public.sync_profile_name_to_forms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set author_name = coalesce(nullif(btrim(new.name), ''), split_part(new.email, '@', 1), new.id::text)
  where f.author_id = new.id;

  return new;
end;
$$;

drop trigger if exists profiles_sync_name_to_forms on public.profiles;

create trigger profiles_sync_name_to_forms
after update of name, email on public.profiles
for each row execute procedure public.sync_profile_name_to_forms();

commit;
