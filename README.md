# survey-app
Form Generator

survey-app/  
├── frontend/                 # React + SurveyJS  
│   ├── Dockerfile  
│   ├── package.json  
│   ├── vite.config.ts  
│  
│   └── src/  
│       ├── main.tsx  
│       ├── App.tsx  
│  
│       ├── lib/  
│       │   └── supabase.ts        # подключение к Supabase  
│  
│       ├── hooks/  
│       │   └── useUser.ts         # пользователь + роль  
│  
│       ├── utils/  
│       │   └── export.ts          # XLS экспорт  
│  
│       ├── pages/  
│       │   ├── Builder.tsx        # создание форм  
│       │   ├── Form.tsx           # прохождение формы (public)  
│       │   ├── FormResponses.tsx  # ответы + экспорт  
│       │   ├── FormsList.tsx      # список + поиск + фильтр  
│       │   ├── AdminUsers.tsx     # управление пользователями  
│       │   └── login.ts           # авторизация  

# Запуск
git clone https://github.com/supabase/supabase  
cd supabase/docker  
cp .env.example .env  
cd ../../  
docker compose up --build  
cd /var/www/survey-app/frontend  
npm install  
npm run build  

# Supabase Studio (админка)
http://localhost:3000

# React приложение
http://localhost:5173

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

# Проверка ролей в UI
if (profile?.role === "admin") {
  // показываем управление пользователями
}

# Шаринг форм  
# Разрешаем читать формы ВСЕМ (даже без логина)  
create policy "public can read forms"  
on forms  
for select  
to anon, authenticated  
using (true);  

# Разрешаем отправлять ответы ВСЕМ  
create policy "public can insert responses"  
on responses  
for insert  
to anon, authenticated  
with check (true);  
