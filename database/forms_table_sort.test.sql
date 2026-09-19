-- Run only on a disposable production copy after the forms_table_sort migration.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_sort_check_%' then
    raise exception 'Requires a disposable survey_sort_check_* database';
  end if;
end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end $$;
insert into auth.users (id, email, raw_user_meta_data) values
 ('a3000000-0000-4000-8000-000000000001','sort-one@example.invalid','{"name":"Яков"}'),
 ('a3000000-0000-4000-8000-000000000002','sort-two@example.invalid','{"name":"Анна"}');
insert into public.forms (id,title,author_id,form_type,form_reason,schema,created_at,responses_count,is_public,deadline_at,max_responses)
select ('b3000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'Sort fixture ' || lpad((n % 13)::text,2,'0'),
 case when n%2=0 then 'a3000000-0000-4000-8000-000000000001'::uuid else 'a3000000-0000-4000-8000-000000000002'::uuid end,
 case when n%3=0 then 'anketa' when n%3=1 then 'request' else 'voting' end,
 case when n%2=0 then 'plan' else 'request' end, '{"pages":[]}',
 '2026-09-15T10:00:00Z'::timestamptz + (n%7)*interval '1 microsecond', n%11,
 n%2=0,
 case when n%5=0 then '2099-01-01'::timestamptz when n%5=1 then '2000-01-01'::timestamptz else null end,
 case when n%7=0 then greatest(n%11,1) else null end
from generate_series(1,67) n;
-- Include missing author labels and case-insensitive title ties.
update public.forms set author_name = '' where id = 'b3000000-0000-4000-8000-000000000001';
update public.forms set title = upper(title) where id = 'b3000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare
  field text; direction text; expression text; expected uuid[]; actual uuid[];
  page_ids uuid[]; last_id uuid; last_value text; reference_time timestamptz;
  page_size integer := 20; page_count integer; row_count integer;
begin
  foreach field in array array['created_at','title','author_name','responses_count','status','classification'] loop
    expression := case field
      when 'created_at' then 'f.created_at'
      when 'title' then 'lower(f.title)'
      when 'author_name' then 'lower(coalesce(nullif(f.author_name, ''''), f.author_id::text))'
      when 'responses_count' then 'coalesce(f.responses_count,0)'
      when 'status' then '(case when f.max_responses > 0 and f.responses_count >= f.max_responses then false when f.deadline_at is not null then f.deadline_at > now() else f.is_public end)'
      when 'classification' then $e$(case f.form_type when 'anketa' then 'Анкетирование' when 'request' then 'Запрос' else 'Голосование' end || ' • ' || case f.form_reason when 'plan' then 'План работ' else 'Запрос' end)$e$
    end;
    foreach direction in array array['asc','desc'] loop
      execute format('select array_agg(id order by %s %s, id %s) from public.forms f where f.title ilike ''%%Sort fixture%%''',expression,direction,direction) into expected;
      actual := '{}'; last_id := null; last_value := null; reference_time := null; page_count := 0;
      loop
        select count(*) into row_count from public.list_forms_sorted(
          p_sort_field=>field,p_sort_direction=>direction,p_page_size=>page_size,
          p_after_id=>last_id,p_after_value=>last_value,p_reference_time=>reference_time,p_search=>'Sort fixture');
        select array_agg(id), (array_agg(id))[count(*)], (array_agg(sort_value))[count(*)], min(sort_reference_at)
        into page_ids,last_id,last_value,reference_time
        from (select * from public.list_forms_sorted(
          p_sort_field=>field,p_sort_direction=>direction,p_page_size=>page_size,
          p_after_id=>last_id,p_after_value=>last_value,p_reference_time=>reference_time,p_search=>'Sort fixture') limit page_size) p;
        actual := actual || coalesce(page_ids,'{}'); page_count := page_count+1;
        exit when row_count<=page_size;
        perform pg_temp.assert_true(page_count<10,'pagination must advance');
      end loop;
      perform pg_temp.assert_true(actual=expected,field || ' ' || direction || ': all 67 rows ordered across pages, ties retained');
      perform pg_temp.assert_true(page_count=4,'67 rows require four pages');
    end loop;
  end loop;
end $$;

-- Filters are applied BEFORE LIMIT, across the entire dataset, including "mine".
select pg_temp.assert_true(
 (select array_agg(id) from public.list_forms_sorted(p_sort_field=>'title',p_sort_direction=>'asc',p_page_size=>999,
   p_search=>'fixture',p_author_id=>'a3000000-0000-4000-8000-000000000001',p_form_type=>'anketa',p_form_reason=>'plan',
   p_date_from=>'2026-09-15T10:00:00.000002Z',p_date_to=>'2026-09-15T10:00:00.000005Z'))
 = (select array_agg(id order by lower(title),id) from public.forms where title ilike '%fixture%'
   and author_id='a3000000-0000-4000-8000-000000000001' and form_type='anketa' and form_reason='plan'
   and created_at between '2026-09-15T10:00:00.000002Z' and '2026-09-15T10:00:00.000005Z'),
 'shared filters match the entire dataset');
select pg_temp.assert_true((select count(*)>0 from public.list_forms_sorted(p_sort_field=>'title',p_search=>'Яков')), 'author search works');
-- New, higher-ranked rows added between page requests do not shift the cursor.
reset role;
create temp table first_page as select * from public.list_forms_sorted(p_sort_field=>'responses_count',p_sort_direction=>'desc',p_search=>'Sort fixture',p_page_size=>20) limit 20;
insert into public.forms (id,title,author_id,form_type,form_reason,schema,responses_count)
values ('b3000000-0000-4000-8000-000000000099','Sort fixture new','a3000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',99);
select pg_temp.assert_true(not exists (
  select 1 from public.list_forms_sorted(p_sort_field=>'responses_count',p_sort_direction=>'desc',p_search=>'Sort fixture',
    p_after_id=>(select id from first_page offset 19 limit 1),p_after_value=>(select sort_value from first_page offset 19 limit 1),
    p_reference_time=>(select sort_reference_at from first_page limit 1)) p
  where p.id in (select id from first_page) or p.id='b3000000-0000-4000-8000-000000000099'
),'insertion before cursor causes no repeated rows');

-- RLS and RPC privileges remain enforced.
update public.profiles set is_disabled=true where id='a3000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.list_forms_sorted()),'disabled reader sees no rows');
reset role;
set local role anon;
do $$ begin
  begin perform public.list_forms_sorted(); raise exception 'anonymous listing allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin perform public.list_forms_sorted(p_sort_field=>'title; drop table forms'); raise exception 'invalid field accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.list_forms_sorted(p_sort_direction=>'bad'); raise exception 'invalid direction accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.list_forms_sorted(p_page_size=>1000); raise exception 'invalid limit accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.list_forms_sorted(p_after_id=>'b3000000-0000-4000-8000-000000000001'); raise exception 'partial cursor accepted';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
