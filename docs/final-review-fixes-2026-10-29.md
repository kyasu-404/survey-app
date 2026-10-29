# Исправления финального review, 29 октября 2026

Исходная версия: `c5b0f7ca96617584b3733be5ef15442e7c86ffb0`. Изменения подготовлены
в `/opt/survey-app`; production, рабочая БД, firewall и runtime-копии сервисов не
обновлялись. Ниже — исправления подтверждённых замечаний, без утверждения об
отсутствии всех возможных уязвимостей.

## Изменения и доказательства

| Замечание | Исправление | Проверка |
| --- | --- | --- |
| S1: JSON вместо подписи/числа/даты ломает экран ответов | SQL проверяет допустимую форму значения в конкретном вложенном вопросе. Клиент передаёт подпись в проверку без принудительного String, безопасно обрабатывает старые повреждённые значения в таблице, экспорте и отчёте | Негативные SQL/RPC проверки; положительные подпись/число/custom boolean; unit и Chromium с исходным JSON `toString` |
| S2: URL и путь другой формы обходят ownership/refs | Общий BEFORE trigger нормализует файловые значения в bare object path, проверяет форму, согласованность content/path/storagePath и существование объекта; AFTER trigger проверяет browser/employee authority и регистрирует ссылки. Поддерживаются вложенные paneldynamic и файловые ячейки/детали матриц, в том числе наследуемый cellType | SQL: чужой browser, cross-form, encoded signed/public URL, конфликт alias, легитимный владелец и matrix default inheritance |
| S3: ZIP validation и распаковка читают разные размеры/счётчики | ZIP64/multidisk/повреждённый каталог явно отклоняются. Проверяются границы всех записей; DEFLATE обрабатывается порциями по 1024 с подсчётом фактических выходных байтов. Ложный размер не ограничивает только выходной буфер, а прерывает саму распаковку | Мismatch EOCD, ZIP64/multidisk и 41 MiB deflated member с подделанным размером 1 отклоняются; обычные DOCX/XLSX и генерация сохраняются |
| C1: REST row cap удаляет файлы ещё существующих ответов | Служебный `delete_form_responses_with_files` внутри одной транзакции проверяет actor/form, удаляет ответы, проверяет полный набор оставшихся ссылок и возвращает scalar JSON со списком объектов | 51 ответ × 25 файлов (>1000 refs): после удаления 50 общий файл не удаляется; последний ответ освобождает все 25 файлов |
| C2: удаление последней страницы приводит к 416 | PGRST103 на page>1 вызывает чтение первой страницы; результат кладётся в кеш её ключа перед переключением UI | Unit диапазонов и Chromium 51→50: таблица доступна и содержит 50 строк |
| C3: очистка резервации лишает владельца сохранённого файла | Restore дополнительно проверяет хеш browser_id сохранённого ответа и точную response_file_reference; незавершённый draft по-прежнему требует reservation | SQL: после удаления attached reservation исходный browser восстанавливает файл, чужой — нет |
| C4: устаревшая вкладка/черновик перезаписывает новую схему | expectedRevision проходит от загрузки редактора через черновик и подтверждение warnings до Edge CAS. 409 сохраняет локальный draft. Dirty creator не гидратируется при refetch; ошибка фонового запроса сохраняет загруженный редактор; появление первого ответа включает safe mode без пересоздания creator и не размонтирует его под предупреждением | Edge: последовательный stale save и stale confirmation получают 409 без записи. Unit: refetch, восстановленный draft, first response + quota failure, сохранение исходной revision |
| C5: выбор фона удаляет предыдущий фон галереи | Смена выбранного фона не удаляет ранее загруженные файлы существующей формы. Неудачная операция очищает только созданные ею копии | Unit Storage.remove не вызывается; browser gallery/save/render |
| C6: запрет browser storage ломает форму | Getter, чтение, обход, удаление и запись draft защищены; ThemeProvider также работает с состоянием в памяти при запрете localStorage | Unit getter/getItem/setItem/removeItem/key; Chromium отправляет форму при запрещённом sessionStorage и localStorage |
| C7: check/remove гоняется с сохранением вложения | Прикрепление и все удаления response files используют общий per-object advisory lock и постоянный deletion claim. Решение об удалении принимается внутри транзакции, физический Storage.remove выполняется после неё; claim не истекает при неопределённом результате удаления | Два реальных PG connection: delete-first блокирует/отклоняет attachment; attach-first блокирует cleanup, который после commit не получает файл. Проверена прямая Storage RLS DELETE |

Claim используется при удалении отдельной анонимной загрузки, выбранных ответов,
expired reservations, orphan cleanup и прямом удалении авторизованным uploader.
Полное удаление формы выполняется до очистки её Storage-префикса: после удаления
формы новые ответы к ней невозможны. Неудачная физическая очистка повторяется
обслуживающим процессом; уже заявленный к удалению путь нельзя прикреплять заново.

URL host не предоставляет полномочий: сервер не загружает URL, сохраняет только
локальный object path и отдельно проверяет capability/владельца. Подписанный query
parameter не становится частью ответа. Неоднозначные файловые aliases отклоняются.
Имеющиеся повреждённые ответы не удаляются и не переписываются миграцией.

Дополнительно отозваны исторические column-level INSERT grants на responses,
в ingress-script включён Kong 8443 с тем же разрешённым frontend IP, исправлены
README про фиксированные buckets и действующую политику embedding. Firewall-скрипт
проверен подменой iptables/ip6tables, системные правила не менялись.

Сохранены политики: управление рассылками и персональными ссылками принадлежит
автору; разрешённый общий просмотр ответов/отчётов сотрудниками не ограничен.

## Миграция и выпуск

Новая аддитивная миграция —
`database/migrations/202610291200_final_review_fixes.sql`; свежий bootstrap
`database/supabase_schema.sql` синхронизирован. Исторические миграции не изменялись.
Процедура и проверка владельцев объектов описаны в `database/migrations/README.md`.

Порядок согласованного выпуска: backup → миграция → form-admin + frontend → Office
service → API/UI-проверки. Открытые старые редакторы нужно перезагрузить: без
expectedRevision запрос отклоняется. Legacy draft без исходной revision остаётся
доступен для копирования/сохранения шаблоном и не перезаписывает актуальную форму.
Служебные SQL-helper/claim/RPC недоступны anon/authenticated напрямую; RLS и
владельцы проверяются при выпуске отдельно на реальном сервере.

## Верификация

Итог для подтверждённых S1–S3/C1–C7: **fixed** в исходниках. Исходные
негативные сценарии больше не воспроизводятся; положительные сценарии проходят.
Дополнительный read-only review выявил обход через ложный ZIP size и пересоздание
редактора при первом ответе; оба закрыты, воспроизведения включены в тесты.

| Команда / проверка | Итог |
| --- | --- |
| `npm run lint`, `npm run typecheck` в frontend | проходят |
| `npm run test:coverage -- --maxWorkers=2` | 83 файла, 684 теста; lines 77,11%, branches 69,38%; coverage gate пройден |
| `node --test database/supabase_schema.test.mjs database/migrations.test.mjs functions/*/*.test.mjs functions/security-boundaries.test.mjs frontend/tooling.test.mjs frontend/Dockerfile.test.mjs mail-worker/Dockerfile.test.mjs` | 125 проходят |
| `npm test` в Office service | 49 проходят, 1 DB job integration skipped |
| `npm test` в mail-worker | 21 проходит |
| `python3 -m unittest discover -s ops -p 'test_*.py'` | 11 проходят; firewall не применяется |
| SQL-runner с `SURVEY_TEST_PREVIOUS_SCHEMA` из c5b0f7c | 10 SQL-наборов на bootstrap и после additive upgrade, плюс две конкурирующие транзакции; проходит |
| `playwright test final-review-fixes.e2e.spec.ts` | все 4 новых регрессии проходят |
| `playwright test backgrounds.e2e.spec.ts personal-links.e2e.spec.ts responses.e2e.spec.ts realtime.e2e.spec.ts` | 11 проходят (включая grouped-responses, совпавший с фильтром) |
| Дополнительные `file-upload` / `dynamic-panels` browser controls | 6 проходят |
| `npm run build`, `npm run build:budget` | проходят; initial JS/CSS около 707,8 KiB raw / 183,6 KiB gzip |
| `git diff --check` | проходит |

Отдельный расширенный legacy SQL-прогон с наполнением 10001 ответа превысил общий
таймаут 300 с; его успешное завершение не заявляется. Он вынесен под
`SURVEY_TEST_SCALE=1` и не заменяет целевую проверку миграции/claims/ownership.
Сравнение 500 вставок в одной транзакции на отдельной локальной БД дало примерно
860 мс на baseline и 987 мс после миграции. Это единичное измерение накладных расходов
новой проверки, не оценка пропускной способности production. Массовые вставки в
одной транзакции и реальная нагрузка требуют отдельного профилирования.

При чрезмерном параллелизме unit и Chromium один XLSX test превышал свой предел
5 с. Финальный полный coverage-прогон с двумя workers прошёл без изменения
таймаутов или ослабления теста.

Команды используют Node 22 и фиктивные VITE Supabase URL/key для unit/build;
Chromium перехватывает API, мутации не попадают в рабочую БД. SQL-runner использует
настоящий PostgreSQL с минимальными auth/storage scaffolds и отдельными базами,
проверяет bootstrap и обновление исходной схемы c5b0f7c. Тестовые данные откатываются,
созданные runner базы удаляются.

Ограничения: реальные production privileges/configuration, внешние Auth/Storage,
SMTP и OnlyOffice Document Server после выпуска ещё не проверены. Office job DB
integration требует отдельный `OFFICE_TEST_DATABASE_URL`; обычный Office suite
отмечает его как skipped. Полный внешний pentest и нагрузочный тест production
не проводились. OFFSET/exact count, пределы экспорта и объём DOM из review остаются
направлениями измерений для большого масштаба, а не подтверждёнными дефектами этого
выпуска; защитные лимиты экспорта не ослаблялись.
