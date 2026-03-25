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
```

Они используются в `frontend/src/shared/config/env.ts`.

## Supabase клиент

В проекте используется один способ создания клиента Supabase:

- клиент создаётся в `frontend/src/shared/api/client.ts`;
- все остальные места берут его через реэкспорт (`frontend/src/shared/api/supabase.ts` и `frontend/src/lib/supabase.ts`).

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
