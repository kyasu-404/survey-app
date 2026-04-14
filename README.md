# survey-app

Конструктор и рендерер опросов на React + Supabase.

## Структура

- `frontend/` — Vite + React приложение.
- `database/supabase_schema.sql` — недеструктивный baseline схемы таблиц и RLS-политик для пустого Supabase-проекта.
- `database/migrations/` — место для production-миграций. Каждый применённый файл считается неизменяемым.

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
4. Добавьте RLS политики на `storage.objects`. Для авторизованных пользователей фронтенд кладёт файлы в путь `user_id/form_id/file_id.ext`. Для публичных форм без логина используются пути `public/form_id/file_id.ext`. В ответе формы хранится путь к объекту, а signed URL создаётся по запросу при превью/скачивании файла.

Пример SQL-политик для бакета `survey-files`:

```sql
create policy "survey files upload authenticated"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 'public'
      and exists (
        select 1
        from public.forms f
        where f.id::text = (storage.foldername(name))[2]
          and f.is_public = true
          and (f.deadline_at is null or f.deadline_at > now())
      )
    )
  )
);

create policy "survey files upload anon"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = 'public'
  and exists (
    select 1
    from public.forms f
    where f.id::text = (storage.foldername(name))[2]
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
);

create policy "survey files read authenticated"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 'public'
      and exists (
        select 1
        from public.forms f
        where f.id::text = (storage.foldername(name))[2]
          and f.is_public = true
          and (f.deadline_at is null or f.deadline_at > now())
      )
    )
    or exists (
      select 1
      from public.forms f
      where f.id::text = (storage.foldername(name))[2]
        and (
          f.author_id = (select auth.uid())
          or (select public.request_role()) = 'admin'
        )
    )
  )
);

create policy "survey files read anon"
on storage.objects
for select
to anon
using (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = 'public'
  and exists (
    select 1
    from public.forms f
    where f.id::text = (storage.foldername(name))[2]
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
);

create policy "survey files delete authenticated"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 'public'
      and exists (
        select 1
        from public.forms f
        where f.id::text = (storage.foldername(name))[2]
          and f.is_public = true
          and (f.deadline_at is null or f.deadline_at > now())
      )
    )
  )
);

create policy "survey files delete anon"
on storage.objects
for delete
to anon
using (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = 'public'
  and exists (
    select 1
    from public.forms f
    where f.id::text = (storage.foldername(name))[2]
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
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
  - `name text`
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
  - `is_public boolean`
  - `deadline_at timestamptz | null`
  - `max_responses integer | null`
  - `responses_count integer`
  - `author_id uuid`
  - `created_at timestamptz`
- `public.responses`
  - `id uuid`
  - `form_id uuid`
  - `user_id uuid | null`
  - `data jsonb`
  - `created_at timestamptz`

Схема в `database/supabase_schema.sql` соответствует этим ожиданиям. Файл предназначен для нового или полностью пустого проекта и не содержит `DROP TABLE`, `TRUNCATE` или `DELETE FROM`.

## Безопасное применение изменений БД

`database/supabase_schema.sql` — это baseline, а не production-миграция. Для production используйте отдельные SQL-миграции:

1. Сделайте свежий бэкап production.
2. Подготовьте миграцию в `database/migrations/YYYYMMDDHHMM_description.sql`.
3. Проверьте её на локальной или staging-базе с копией production-данных.
4. Применяйте с остановкой на первой ошибке:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/YYYYMMDDHHMM_description.sql
```

5. После применения проверьте RLS-политики, создание форм, отправку ответов и загрузку файлов.

Новые миграции должны быть идемпотентными там, где это возможно, и обёрнутыми в транзакцию:

```sql
begin;

alter table public.forms
  add column if not exists some_column text;

commit;
```

Не применяйте к production команды сброса (`DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM` без точного условия, `supabase db reset --linked` или `supabase db reset --db-url`). Если удаление данных действительно нужно, сначала зафиксируйте план отката и проверьте восстановление из бэкапа.

Для первичной инициализации пустого проекта:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/supabase_schema.sql
```

## Перенос БД и всех форм

Есть три безопасных сценария. Перед любым переносом зафиксируйте версии кода и схемы, выключите запись в исходной системе на время финального дампа и проверьте результат на staging.

### 1. Полный перенос проекта Supabase

Самый надёжный вариант для переноса всех форм, ответов, профилей и auth-пользователей — восстановить source-проект в новый project через **Restore to a new project** в Supabase Dashboard: https://supabase.com/docs/guides/platform/clone-project.

Этот способ переносит базу данных, индексы, роли и auth-данные. Storage-объекты, Edge Functions, настройки Auth, API-ключи и переменные окружения нужно перенести отдельно.

После восстановления:

1. Создайте приватный Storage bucket `survey-files` или имя из `VITE_SUPABASE_STORAGE_BUCKET`.
2. Перенесите файлы Storage, если формы содержат file-вопросы.
3. Разверните Edge Function `user-admin` и задайте `SUPABASE_SERVICE_ROLE_KEY`.
4. Обновите `frontend/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_STORAGE_BUCKET`.

### 2. Логический дамп Postgres в пустой target

Подходит для self-hosted Postgres или нового пустого Supabase-проекта, когда нужно перенести всю БД через стандартные инструменты Postgres:

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=survey-app.dump

pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error \
  survey-app.dump
```

Восстанавливайте такой дамп только в пустую target-базу. Не добавляйте `--clean` к production-target: он удаляет существующие объекты перед восстановлением.

Если используете Supabase CLI, учитывайте, что `supabase db dump` по умолчанию исключает управляемые Supabase схемы, включая `auth` и `storage`: https://supabase.com/docs/reference/cli/supabase-db-dump. Для полного переноса логинов и владельцев форм лучше использовать полный restore проекта или проверенный `pg_dump`/`pg_restore` план.

### 3. Перенос только форм и ответов

Если target уже настроен и пользователи заведены, можно перенести только прикладные таблицы:

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-acl \
  --table=public.profiles \
  --table=public.forms \
  --table=public.responses \
  --file=survey-data.sql

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f survey-data.sql
```

Важно: `public.forms.author_id` ссылается на `public.profiles.id`, а `public.profiles.id` — на `auth.users.id`. Если в target нет auth-пользователей с теми же UUID, переносите полный проект или заранее сопоставьте владельцев форм с target-пользователями.

После импорта пересчитайте счётчики ответов:

```sql
update public.forms f
set responses_count = coalesce(counted.total, 0)
from (
  select f2.id, count(r.id)::integer as total
  from public.forms f2
  left join public.responses r on r.form_id = f2.id
  group by f2.id
) counted
where counted.id = f.id;
```

Если нужно перенести только определения форм без ответов, экспортируйте `public.forms` и при импорте замените `author_id` на UUID администратора в target. JSON-схема формы хранится в колонке `public.forms.schema`.

### Storage-файлы из форм

Ответы на file-вопросы хранят в БД путь к объекту, а сам файл лежит в Supabase Storage. Для авторизованных респондентов используется путь `user_id/form_id/file_id.ext`, для публичных форм без логина — `public/form_id/file_id.ext`. Чтобы перенести такие формы полностью, скопируйте bucket `survey-files` с сохранением этих путей.

Пример через S3-совместимый API Supabase Storage:

```bash
AWS_ACCESS_KEY_ID="$SOURCE_S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SOURCE_S3_SECRET_KEY" \
aws s3 sync "s3://survey-files" "./survey-files" \
  --endpoint-url "$SOURCE_S3_ENDPOINT" \
  --region "$SOURCE_S3_REGION"

AWS_ACCESS_KEY_ID="$TARGET_S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$TARGET_S3_SECRET_KEY" \
aws s3 sync "./survey-files" "s3://survey-files" \
  --endpoint-url "$TARGET_S3_ENDPOINT" \
  --region "$TARGET_S3_REGION"
```

S3-параметры находятся в Supabase Dashboard: **Project Settings** → **Storage** → **S3 API**. После копирования проверьте RLS-политики Storage и откройте форму с загруженным файлом.


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
