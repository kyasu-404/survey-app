# survey-app

Конструктор и рендерер опросов на React + Supabase.

## Структура

- `frontend/` — Vite + React приложение.
- `database/supabase_schema.sql` — актуальная схема таблиц и RLS-политик для Supabase.

## Переменные окружения (frontend/.env)

Фронтенд читает только эти переменные:

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SUPABASE_STORAGE_BUCKET=survey-files
```

Они используются в `frontend/src/shared/config/env.ts`.

## Supabase клиент

В проекте используется один способ создания клиента Supabase:

- клиент создаётся в `frontend/src/shared/api/client.ts`;
- все остальные места берут его через реэкспорт (`frontend/src/shared/api/supabase.ts` и `frontend/src/lib/supabase.ts`).

## Хранение файлов в Supabase Storage (S3)

Файлы из вопросов типа `file` в SurveyJS загружаются в бакет Supabase Storage, указанный в `VITE_SUPABASE_STORAGE_BUCKET`.

### Что настроить в Supabase

1. Откройте **Storage** → **Create bucket**.
2. Создайте бакет с именем `survey-files` (или своим, но тогда обновите `VITE_SUPABASE_STORAGE_BUCKET`).
3. Включите доступ на чтение файлов (Public bucket), если хотите сразу открывать файлы по public URL.
4. Добавьте RLS политики на bucket/object для `authenticated`, чтобы разрешить upload/remove.

Пример SQL-политик для бакета `survey-files`:

```sql
create policy "authenticated can upload files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'survey-files');

create policy "authenticated can read files"
on storage.objects
for select
to authenticated
using (bucket_id = 'survey-files');

create policy "authenticated can delete files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'survey-files');
```

### S3-совместимое подключение (опционально)

Если нужно подключать внешние сервисы к Storage как к S3:

1. Откройте в Supabase: **Project Settings** → **Storage** → **S3 API**.
2. Скопируйте `Endpoint`, `Region`, `Access Key`, `Secret Key`.
3. Используйте эти параметры в внешнем S3-клиенте (AWS SDK, MinIO client и т.д.).

> Во фронтенде этого проекта используется нативный Supabase Storage SDK, поэтому S3-ключи во frontend/.env не требуются.

## База данных (что ожидает фронтенд)

Фронтенд работает с таблицами:

- `public.profiles`
  - `id uuid`
  - `email text`
  - `role text` (`admin` / `user`)
  - `created_at timestamptz`
- `public.forms`
  - `id uuid`
  - `title text`
  - `form_type text`
  - `form_reason text`
  - `schema jsonb`
  - `author_id uuid`
  - `created_at timestamptz`
- `public.responses`
  - `id uuid`
  - `form_id uuid`
  - `user_id uuid | null`
  - `data jsonb`
  - `created_at timestamptz`

Схема в `database/supabase_schema.sql` соответствует этим ожиданиям.

## Запуск frontend

```bash
cd frontend
npm install
npm run dev
```

## Запуск unit-тестов

```bash
cd frontend
npm install
npm run test
```

Для запуска в watch-режиме:

```bash
cd frontend
npm run test:watch
```

## Как выдать пользователю роль admin в Supabase

1. Откройте Supabase Studio → **SQL Editor**.
2. Выполните запрос (замените email на нужный):

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

Проверить результат можно так:

```sql
select id, email, role, created_at
from public.profiles
where email = 'admin@example.com';
```

Если пользователя ещё нет в `public.profiles`, сначала зарегистрируйте его через Auth (или дождитесь первого входа), чтобы сработал триггер `handle_new_user()`.
