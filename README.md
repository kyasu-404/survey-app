# survey-app

Конструктор и рендерер опросов на React + Supabase.

## Структура

- `frontend/` — Vite + React приложение.
- `database/supabase_schema.sql` — актуальная схема таблиц и RLS-политик для Supabase.

## Переменные окружения (frontend/.env)

Скопируйте `frontend/.env.example` в локальный `frontend/.env`. Фронтенд читает только эти переменные:

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SUPABASE_STORAGE_BUCKET=survey-files
```

Они используются в `frontend/src/shared/config/env.ts`.

Для Edge Function `user-admin` дополнительно задайте allowlist origin-ов:

```env
USER_ADMIN_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com
```

Локально функция по умолчанию разрешает `http://localhost:5173` и `http://127.0.0.1:5173`.

## Supabase клиент

В проекте используется один способ создания клиента Supabase:

- клиент создаётся в `frontend/src/shared/api/client.ts`;
- все остальные места берут его через реэкспорт (`frontend/src/shared/api/supabase.ts` и `frontend/src/lib/supabase.ts`).

## Хранение файлов в Supabase Storage (S3)

Файлы из вопросов типа `file` в SurveyJS загружаются в бакет Supabase Storage, указанный в `VITE_SUPABASE_STORAGE_BUCKET`.

### Что настроить в Supabase

1. Откройте **Storage** → **Create bucket**.
2. Создайте бакет с именем `survey-files` (или своим, но тогда обновите `VITE_SUPABASE_STORAGE_BUCKET`).
3. Оставьте бакет приватным.
4. Добавьте RLS политики на `storage.objects`. Фронтенд кладёт файлы в путь `user_id/form_id/file_id.ext`, создаёт short-lived signed URL и удаляет только файлы из собственного `user_id`-префикса.

Пример SQL-политик для бакета `survey-files`:

```sql
create policy "users can upload own survey files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "owners authors and admins can read survey files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.forms f
      where f.id::text = (storage.foldername(name))[2]
        and f.author_id = (select auth.uid())
    )
    or (select public.request_role()) = 'admin'
  )
);

create policy "users can delete own survey files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
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
  - `is_disabled boolean`
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


## Edge Function для админ-операций пользователей

Создание пользователя, удаление, смена пароля пользователя и отключение/включение выполняются через Edge Function `user-admin` (а не через `auth.signUp` из frontend).

Цепочка:

`Frontend (React) -> Edge Function (проверка прав admin) -> Supabase auth.admin API`

### Как включить

1. cp -R ./functions/user-admin ./supabase/docker/volumes/functions/
2. cd ./supabase/docker/
3. docker compose restart functions --no-deps

```bash
supabase functions deploy user-admin
```

4. Убедитесь, что в проекте Supabase доступна переменная `SUPABASE_SERVICE_ROLE_KEY` для Edge Functions (через Secrets в Supabase).
5. Фронтенд вызывает функцию через `supabase.functions.invoke("user-admin")` и передаёт JWT текущего пользователя автоматически; функция дополнительно проверяет, что вызывающий пользователь имеет роль `admin` в `public.profiles`.

> Для корректного отображения статуса блокировки пользователей в таблице используется поле `public.profiles.is_disabled`.

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
