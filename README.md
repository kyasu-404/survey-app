# survey-app

Конструктор и рендерер опросов на React + Supabase.

## Структура

- `frontend/` — Vite + React приложение.
- `database/supabase_schema.sql` — недеструктивный baseline схемы таблиц и RLS-политик для пустого Supabase-проекта.
- `database/migrations/` — место для production-миграций. Каждый применённый файл считается неизменяемым.

Для нового развёртывания применяйте только полный baseline:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/supabase_schema.sql
```

Исторические файлы из `database/migrations/` предназначены только для обновления уже существующей базы и к базе,
созданной из актуального baseline, повторно не применяются.

Перед публикацией self-hosted Supabase обязательно:

- выполните штатные скрипты Supabase `sh utils/generate-keys.sh` и `sh utils/add-new-auth-keys.sh` и замените все демонстрационные секреты;
- оставьте `DISABLE_SIGNUP=true`, `ENABLE_EMAIL_SIGNUP=false` и `ENABLE_PHONE_SIGNUP=false`: сотрудников создаёт администратор через `user-admin`;
- задайте сложные `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`, постоянный `MAIL_SETTINGS_ENCRYPTION_KEY` и точный `PUBLIC_APP_URL`;
- публикуйте наружу только Nginx на портах 80/443; Kong, PostgreSQL, pooler, Studio и mail-worker не должны слушать публичный интерфейс.

## Ответы и защита структуры формы

- Для каждой формы разрешён один ответ на браузер. Постоянный UUID хранится в `localStorage`, а уникальность дополнительно проверяется в Supabase по паре `form_id + browser_id`.
- Повторная отправка возвращает существующий ответ. Если при сохранении формы включён ползунок **«Редактирование ответов»**, респондент может открыть этот ответ и сохранить изменения из того же браузера.
- После появления первого ответа форма открывается в безопасном режиме. Тексты, оформление и порядок элементов можно менять сразу; изменения, влияющие только на новые ответы, требуют подтверждения; удаление и изменение технической структуры блокируются с предложением создать копию.
- Автор формы (и администратор) может выбрать до 100 видимых ответов и удалить их. Edge Function `form-admin` удаляет также связанные объекты из приватного bucket `survey-files`.

Для существующего Supabase-проекта примените миграцию управления ответами:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202608031200_response_management.sql
```

Для безопасного редактирования форм с уже полученными ответами дополнительно примените миграцию:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202608061200_safe_answered_form_editing.sql
```

После миграций обязательно повторно разверните Edge Function `form-admin`: она обрабатывает действия `delete-responses` и `update-schema`. Frontend и функция должны обновляться вместе, иначе сохранение формы завершится ошибкой `Invalid delete payload`.

Для обновления уже существующей базы после всех перечисленных выше миграций примените общий hardening-пакет:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202608071200_security_reliability_hardening.sql
```

Он хеширует прежние идентификаторы редактирования ответов, ограничивает незакреплённые анонимные загрузки,
исправляет статистику дедлайнов и добавляет атомарную постановку SMTP-напоминаний.

## Справочник образовательных организаций

Раздел **«Справочник ОУ»** доступен авторизованным пользователям. Просматривать и экспортировать справочник могут все пользователи, а добавлять, изменять, импортировать и удалять организации — только администраторы. Поддерживаются типы **«Школы»**, **«Сады»**, **«ОДО»** и **«УДОДы»**. Для УДОД номер не задаётся; отображаемое название в формах состоит из алиаса, для остальных типов — из алиаса и номера.

Импорт принимает файл `.xlsx` с первой строкой заголовков:

| Тип ОУ | Номер | Алиасы | Email |
| --- | --- | --- | --- |
| Школа | 123 | ГБОУ | school@example.ru |
| УДОД |  | ДДТ | ddt@example.ru |

Допустимы также заголовок `Алиас` и распространённые варианты названий типов (`Школы`, `Сады`, `Детский сад`, `ОДО`, `УДОДы`). Импорт проверяет обязательные поля, email, запрет номера для УДОД и ограничен 5000 строками за файл.

В конструкторе SurveyJS справочник представлен отдельным защищённым элементом **«Организация»**. Внутри он работает как выпадающий список с поиском, но источник и технические свойства не доступны автору формы. При сохранении формы можно выбрать включённые типы организаций; по умолчанию выбраны школы и детские сады. После первого ответа изменение набора типов требует явного подтверждения, поскольку оно влияет на последующие ответы.

Кнопка **«Отчёт»** на странице ответов рассчитывает заполненность и распределение значений по всем ответам. Если форма содержит поле организации, отчёт дополнительно сравнивает ответы с актуальным выбранным срезом справочника и показывает организации, которые не сдали ответ.

Публичная форма получает через `list_form_organizations` только идентификатор, тип, номер и алиас организации. Email из справочника анонимным респондентам не передаётся.

Для существующего Supabase-проекта примените миграцию после миграции управления ответами:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202608031300_organization_directory.sql
```

## SMTP-коннектор и напоминания

Администратору доступен раздел **«Настройки»** с параметрами SMTP-сервера, отправителя и тестовой отправкой. Поддерживаются:

- SMTP over TLS, обычно порт `465`;
- STARTTLS, обычно порт `587`;
- соединение без шифрования для изолированной доверенной сети.

SMTP-настройки не хранятся в файлах frontend или приложения. Сервер, порт, логин, параметры отправителя и зашифрованный пароль сохраняются в единственной строке таблицы Supabase `public.mail_settings`. В файле `docker/.env` хранится только постоянный ключ `MAIL_SETTINGS_ENCRYPTION_KEY`, необходимый для шифрования и расшифровки пароля.

Пароль SMTP не возвращается во frontend. Edge Function `mail-admin` шифрует его AES-256-GCM, а расшифровать пароль может только `mail-worker`, получивший тот же `MAIL_SETTINGS_ENCRYPTION_KEY`. Не передавайте этот ключ во frontend и не добавляйте его в `frontend/.env`.

Во вкладке отчёта **«Учёт сдавших»** автор формы или администратор может поставить индивидуальные напоминания в очередь. Список адресатов заново вычисляется на сервере по актуальным ответам. Если у формы есть срок сдачи, он добавляется в письмо; без срока соответствующая строка не формируется. Статусы `В очереди`, `Отправляется`, `Отправлено` и `Ошибка` сохраняются в Supabase и обновляются через Realtime. Журнал можно закрыть и снова открыть в том же отчёте.

Для существующей базы сначала примените миграцию:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202608061300_mail_reminders.sql
```

### Развёртывание с self-hosted Supabase Docker

Supabase не требуется хранить внутри приложения. Ниже `SURVEY_APP_DIR` — каталог этого репозитория, а `SUPABASE_DOCKER_DIR` — каталог `docker/` из отдельно скачанного self-hosted Supabase.

1. Сгенерируйте постоянный ключ шифрования. Сохраните его в менеджере секретов: при потере ключа сохранённый SMTP-пароль нельзя будет расшифровать, и его потребуется ввести заново.

```bash
openssl rand -base64 32
```

2. Скопируйте Edge Function, worker и compose-overlay в каталог Supabase:

```bash
SURVEY_APP_DIR=/opt/survey-app
SUPABASE_DOCKER_DIR=/path/to/supabase/docker

mkdir -p "$SUPABASE_DOCKER_DIR/volumes/functions/mail-admin"
cp -R "$SURVEY_APP_DIR/functions/mail-admin/." \
  "$SUPABASE_DOCKER_DIR/volumes/functions/mail-admin/"
mkdir -p "$SUPABASE_DOCKER_DIR/mail-worker"
cp -R "$SURVEY_APP_DIR/mail-worker/." \
  "$SUPABASE_DOCKER_DIR/mail-worker/"
cp "$SURVEY_APP_DIR/mail-worker/docker-compose.mail-worker.yml" \
  "$SUPABASE_DOCKER_DIR/docker-compose.mail-worker.yml"
```

При повторном обновлении удалять каталог не нужно: замените в этих двух копиях только файлы из новой версии приложения.

3. Добавьте в существующий `SUPABASE_DOCKER_DIR/.env` следующие значения. Это единственный файл настроек Supabase, который требуется изменить:

```env
# Один и тот же Base64-ключ для Edge Function и mail-worker.
MAIL_SETTINGS_ENCRYPTION_KEY=PASTE_OPENSSL_OUTPUT_HERE

# Публичный origin приложения, без пути и завершающего слеша.
PUBLIC_APP_URL=https://forms.example.ru

# Разрешённые origin-ы frontend через запятую.
MAIL_ADMIN_ALLOWED_ORIGINS=https://forms.example.ru

# Необязательно: частота опроса очереди и число параллельных отправок.
MAIL_WORKER_POLL_INTERVAL_MS=3000
MAIL_WORKER_CONCURRENCY=5
```

Переменная `SERVICE_ROLE_KEY` уже находится в стандартном `.env` Supabase. Overlay передаёт её воркеру внутри Docker-сети; не копируйте этот ключ во frontend и не публикуйте порт health-check воркера наружу.

4. Из каталога `SUPABASE_DOCKER_DIR` пересоздайте Edge Runtime и запустите worker:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mail-worker.yml \
  up -d --build functions mail-worker
```

При последующих обычных запусках Supabase используйте обе compose-конфигурации:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mail-worker.yml \
  up -d
```

5. Проверьте состояние и последние логи, не выводя содержимое `.env`:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mail-worker.yml \
  ps functions mail-worker

docker compose \
  -f docker-compose.yml \
  -f docker-compose.mail-worker.yml \
  logs --tail=100 mail-worker
```

После этого войдите администратором, откройте **«Настройки»**, сохраните SMTP-параметры и отправьте тестовое письмо. Успешный тест проверяет не только TCP-подключение, но и авторизацию, TLS и фактическую приёмку письма SMTP-сервером.

Worker атомарно забирает задания через `FOR UPDATE SKIP LOCKED`, поэтому можно запустить несколько экземпляров. Неуспешная отправка повторяется до трёх раз с увеличивающейся задержкой; в интерфейс сохраняется безопасное сообщение без SMTP-пароля и низкоуровневого ответа сервера.

### Развёртывание Edge Function вне self-hosted Docker

Для Supabase CLI разверните функцию и передайте ей те же секреты:

```bash
supabase functions deploy mail-admin
supabase secrets set \
  MAIL_SETTINGS_ENCRYPTION_KEY="$MAIL_SETTINGS_ENCRYPTION_KEY" \
  PUBLIC_APP_URL="https://forms.example.ru" \
  MAIL_ADMIN_ALLOWED_ORIGINS="https://forms.example.ru"
```

Docker worker при этом должен получить `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` и тот же `MAIL_SETTINGS_ENCRYPTION_KEY` через секреты выбранной среды запуска.

## Запуск тестов

Сначала установите зависимости фронтенда:

```bash
cd frontend
npm ci
```

Корневые policy/smoke-тесты, которые запускаются в CI, выполняются из корня репозитория:

```bash
node --test \
  database/supabase_schema.test.mjs \
  database/migrations.test.mjs \
  functions/user-admin/index.test.mjs \
  functions/form-admin/index.test.mjs \
  functions/mail-admin/index.test.mjs \
  frontend/tooling.test.mjs \
  frontend/Dockerfile.test.mjs \
  mail-worker/Dockerfile.test.mjs
```

Основной frontend suite запускается из `frontend/`:

```bash
npm test
```

Проверка типов:

```bash
npm run typecheck
```

Если нужно прогнать только один или несколько vitest-сьютов:

```bash
npm test -- src/app/router/routeGuards.test.tsx
```

End-to-end smoke через Playwright:

```bash
npm run test:e2e
```

Тесты отдельного почтового worker:

```bash
cd mail-worker
npm ci
npm test
npm audit --omit=dev
```

При первом запуске Playwright может потребоваться установить браузеры:

```bash
npx playwright install
```

## Переменные окружения (frontend/.env)

Скопируйте `frontend/.env.example` в локальный `frontend/.env`. Фронтенд читает только эти переменные:

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SUPABASE_STORAGE_BUCKET=survey-files
```

Они используются в `frontend/src/shared/config/env.ts`.

Для Edge Functions `user-admin`, `form-admin` и `mail-admin` можно явно задать allowlist origin-ов:

```env
USER_ADMIN_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://172.28.140.10:5173
FORM_ADMIN_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://172.28.140.10:5173
MAIL_ADMIN_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://172.28.140.10:5173
```

Локально функции по умолчанию разрешают `http://localhost:5173`, `http://127.0.0.1:5173` и private-network origin-ы на dev-портах `3000`, `4173`, `5173`, `8000` для запуска через IP машины или WSL. Для production или нестандартного порта задайте origin точно в виде `scheme://host:port`, без `/` в конце. В self-hosted Docker эти переменные задаются в `supabase/docker/.env` и передаются в контейнер Edge Functions через `supabase/docker/docker-compose.yml`.

## Supabase клиент

В проекте используется один способ создания клиента Supabase:

- клиент создаётся в `frontend/src/shared/api/client.ts`;
- все остальные места берут его через реэкспорт (`frontend/src/shared/api/supabase.ts` и `frontend/src/lib/supabase.ts`).

## Фоны редактора тем: bucket `survey-assets`

Редактор тем использует отдельный публичный Supabase Storage bucket `survey-assets`. Это не тот же bucket, что `survey-files`: первый хранит фоновые изображения темы, второй — файлы, загруженные респондентами в вопросы формы.

Имя `survey-assets` сейчас задано в коде и не зависит от `VITE_SUPABASE_STORAGE_BUCKET`. Если при загрузке своего фона интерфейс сообщает `Bucket not found`, значит миграция редактора тем ещё не применена к текущему Supabase-проекту.

Для существующего проекта примените миграцию:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/202607171200_add_form_themes_and_assets.sql
```

Для нового пустого проекта достаточно применить `database/supabase_schema.sql`: создание bucket и необходимые политики уже включены в baseline.

Миграция:

- добавляет `forms.theme`;
- создаёт публичный bucket `survey-assets`;
- задаёт лимит 5 МБ и разрешает только `image/jpeg`, `image/png`, `image/webp`;
- создаёт RLS-политики для просмотра, загрузки и удаления фонов;
- разрешает пользователю управлять только фонами своей формы, а администратору — всеми пользовательскими фонами.

Пути объектов имеют фиксированную структуру:

- `gallery/<имя-файла>` — общие фоны, доступные всем пользователям конструктора;
- `forms/<form-id>/<user-id>/<uuid>.jpg|png|webp` — пользовательские фоны конкретной формы.

Общие изображения можно загружать в папку `gallery/` через Supabase Dashboard/Studio с административными правами или через доверенный backend с `service_role`. Клиентское приложение намеренно не разрешает пользователям добавлять и удалять общие фоны.

Проверить настройку можно в SQL Editor:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'survey-assets';

select policyname
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'survey_assets_%'
order by policyname;
```

Первый запрос должен вернуть публичный bucket `survey-assets`, второй — политики `survey_assets_authenticated_read`, `survey_assets_authenticated_upload` и `survey_assets_authenticated_delete`. Простого создания bucket через UI недостаточно: без функций и RLS-политик из миграции загрузка пользовательских фонов будет отклонена.

## Хранение файлов в Supabase Storage (S3)

Файлы из вопросов типа `file` в SurveyJS загружаются в фиксированный приватный bucket `survey-files`.

Связи ответа с объектами Storage индексируются в `response_file_references`. Не удаляйте ответы прямым SQL или клиентским `delete`: используйте действие `delete-responses` функции `form-admin`, чтобы вместе со строками были удалены прикреплённые файлы.

### Что настроить в Supabase

Bucket, функции проверки квот и RLS-политики уже создаются актуальным `database/supabase_schema.sql`.
Не создавайте дополнительные политики анонимного чтения или удаления: анонимному респонденту разрешена только
ограниченная загрузка в путь `public/form-id/file-id`, а скачивание выполняется через короткоживущую signed URL.

Имя bucket менять нельзя без согласованного изменения SQL-политик, Edge Function и frontend. Значение
`VITE_SUPABASE_STORAGE_BUCKET` должно оставаться `survey-files`. Для очистки незавершённых загрузок запускайте
административное действие `cleanup-orphans`; для анонимных незакреплённых файлов дополнительно действует небольшой
временный бюджет на одну форму.

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
  - `author_name text`
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

## Производительность списков и статистика БД

Списки форм, шаблонов и ответов сейчас используют стабильный порядок `created_at desc, id desc` и серверные страницы через `LIMIT/OFFSET`/range-запросы PostgREST. Уникальный порядок важен: без него страницы с одинаковым `created_at` могут приходить непредсказуемо.

Списки форм и шаблонов запрашивают на одну запись больше размера страницы. Эта lookahead-запись не показывается пользователю, а только определяет наличие следующей страницы. Поэтому пагинация этих списков не зависит от приблизительного `planned` count PostgREST, который при неактуальной статистике может ошибочно отклонить допустимый `OFFSET` с `PGRST103`.

Cursor/keyset pagination пока не включена намеренно. Текущая схема проще и достаточна, пока пользователи обычно не уходят в глубокие прокрутки на десятки страниц. Возвращайтесь к cursor pagination, когда появятся признаки:

- частые переходы дальше первых нескольких страниц;
- заметная задержка на глубоких страницах списков форм, шаблонов или ответов;
- `EXPLAIN` показывает, что запросы много читают и отбрасывают перед возвратом нужной страницы;
- появится требование к более стабильной выдаче при активной записи новых форм/ответов во время просмотра.

Для будущего cursor pagination сохраняйте текущий порядок как основу курсора: `(created_at, id)`. Следующая страница должна запрашиваться по последнему элементу предыдущей страницы, например концептуально: `created_at < last_created_at OR (created_at = last_created_at AND id < last_id)`, с тем же `order by created_at desc, id desc`.

`planned` counts (например, в списке ответов) и планы поиска зависят от статистики PostgreSQL, которую обновляет `ANALYZE` и autovacuum. Обычно ручной `VACUUM ANALYZE` не нужен. Но после массового импорта, резкого роста таблиц или странных симптомов в UI/планах запросов сначала проверьте актуальность статистики:

- приблизительные counts заметно расходятся с реальностью;
- поиск по формам стал выбирать плохой план или резко замедлился;
- новые индексы не используются после большого изменения данных;
- сразу после переноса/импорта данных PostgREST продолжает показывать старые оценки.

В таких случаях проверьте планы запросов на staging/production-копии и, при необходимости, выполните `ANALYZE public.forms;` и/или `ANALYZE public.responses;` в безопасное окно обслуживания.

## Перенос БД и всех форм

Есть три безопасных сценария. Перед любым переносом зафиксируйте версии кода и схемы, выключите запись в исходной системе на время финального дампа и проверьте результат на staging.

### 1. Полный перенос проекта Supabase

Самый надёжный вариант для переноса всех форм, ответов, профилей и auth-пользователей — восстановить source-проект в новый project через **Restore to a new project** в Supabase Dashboard: https://supabase.com/docs/guides/platform/clone-project.

Этот способ переносит базу данных, индексы, роли и auth-данные. Storage-объекты, Edge Functions, настройки Auth, API-ключи и переменные окружения нужно перенести отдельно.

После восстановления:

1. Создайте приватный Storage bucket строго с именем `survey-files`.
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

## Edge Function для удаления форм и файлов

Удаление формы и совместимое обновление формы с ответами выполняются через Edge Function `form-admin`. При удалении функция вместе со строкой `forms` удаляет связанные объекты из bucket `survey-files` и фоновые изображения из `survey-assets`. При обновлении она повторно сравнивает исходную и новую схемы на сервере, блокирует несовместимые изменения и требует подтверждения предупреждений. Функция принимает JWT текущего пользователя и разрешает операции автору формы или администратору.

### Как включить

1. `cp -R ./functions/form-admin ./supabase/docker/volumes/functions/`
2. cd ./supabase/docker/
3. docker compose restart functions --no-deps

```bash
supabase functions deploy form-admin
```

4. Убедитесь, что в проекте Supabase доступна переменная `SUPABASE_SERVICE_ROLE_KEY` для Edge Functions.
5. Если frontend работает не на локальных origin-ах, задайте `FORM_ADMIN_ALLOWED_ORIGINS` списком origin-ов через запятую. Bucket можно переопределить переменной `SURVEY_FILES_BUCKET`; по умолчанию используется `survey-files`.

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
