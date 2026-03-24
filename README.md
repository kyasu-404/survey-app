# survey-app
Form Generator

survey-app/  
 ├── docker-compose.yml  
 ├── supabase/          # официальный self-hosted  
 ├── frontend/          # React + SurveyJS  
 │    ├── Dockerfile  
 │    ├── src/  
 │    │    ├── pages/  
 │    │    │    ├── Builder.tsx  
 │    │    │    ├── Form.tsx  
 │    │    │    ├── FormsList.tsx  
 │    │    ├── lib/supabase.ts  
 │    │    ├── App.tsx  

git clone https://github.com/supabase/supabase  
cp -r supabase/docker ./supabase

# Запуск
docker compose up --build

http://localhost:3000

# SQL  
# Таблицы для форм и ответов  
create table forms (  
  id uuid primary key default gen_random_uuid(),  
  title text,  
  form_type text,  
  form_reason text,  
  schema jsonb,  
  created_at timestamp default now()  
);  

create table responses (  
  id uuid primary key default gen_random_uuid(),  
  form_id uuid,  
  data jsonb,  
  created_at timestamp default now()  
);  

# Пользователи и роли  
# Профили  
create table profiles (  
  id uuid primary key references auth.users(id),  
  email text,  
  role text default 'user'  
);  

# Авто-создание профиля
create function public.handle_new_user()  
returns trigger as $$  
begin  
  insert into public.profiles (id, email)  
  values (new.id, new.email);  
  return new;  
end;  
$$ language plpgsql;  

create trigger on_auth_user_created  
after insert on auth.users  
for each row execute procedure public.handle_new_user();  

# RLS  
alter table forms enable row level security;  
alter table responses enable row level security;  
alter table profiles enable row level security;  

# FORMS  
# Смотреть всем  
create policy "everyone can view forms"  
on forms  
for select  
to authenticated  
using (true);  

# ➕ Создавать  
create policy "create own forms"  
on forms  
for insert  
to authenticated  
with check (auth.uid() = author_id);  

# ✏️ Редактировать  
create policy "edit own or admin"  
on forms  
for update  
to authenticated  
using (  
  auth.uid() = author_id OR  
  exists (  
    select 1 from profiles  
    where id = auth.uid() and role = 'admin'  
  )  
);  

# RESPONSES (все видят формы и ответы)  
create policy "view all responses"  
on responses  
for select  
to authenticated  
using (true);  

create policy "insert responses"  
on responses  
for insert  
to authenticated  
with check (true);  

# PROFILES (управление пользователями)  
# 👤 Пользователь видит себя  
create policy "users see own profile"  
on profiles  
for select  
to authenticated  
using (auth.uid() = id);  

# 👑 Админ видит всех  
create policy "admin sees all"  
on profiles  
for select  
to authenticated  
using (  
  exists (  
    select 1 from profiles  
    where id = auth.uid() and role = 'admin'  
  )  
);  

# ✏️ Админ меняет роли
create policy "admin updates users"  
on profiles  
for update  
to authenticated  
using (  
  exists (  
    select 1 from profiles  
    where id = auth.uid() and role = 'admin'  
  )  
);  
