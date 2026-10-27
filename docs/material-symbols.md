# Material Symbols Outlined

## Аудит и выбранное подключение

Frontend использует React 18, TypeScript и Vite. Текст интерфейса остаётся
Segoe UI. До изменений навигация использовала собственные SVG, стандартные
действия — отдельные SVG/PNG и текстовые символы; общей библиотеки иконок не было.
Конструктор SurveyJS имеет собственный набор SVG и механизм состояния.

Рассмотрены локальные npm-обёртки, полный официальный variable font и поднабор
Google Fonts. Выбран поднабор напрямую с официального сервиса: 35 символов,
21 236 байт WOFF2. Новых npm-зависимостей нет. Сборка и браузер не обращаются
к Google; сеть нужна только при явном запуске `npm run icons:update`.

Официальные источники:

- https://developers.google.com/fonts/docs/material_symbols
- https://github.com/google/material-design-icons

Исходный индекс codepoints и лицензия закреплены за commit
`10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7` официального репозитория Google.
Скрипт получает CSS с fonts.googleapis.com, WOFF2 с fonts.gstatic.com,
индекс и Apache 2.0 с raw.githubusercontent.com/google/material-design-icons.
HTTPS, допустимые хосты, формат WOFF2, размер и имена проверяются.
Полные URL, оси и SHA-256 записаны в `material-symbols-outlined.source.json`.

## Загрузка и оформление

- `index.html` предварительно загружает локальный WOFF2. Vite присваивает файлу
  хеш и переписывает ссылки HTML/CSS на один и тот же ресурс.
- `app.css` содержит локальный `@font-face` с `font-display: block`.
  Material Symbols применяется только к иконкам, а не к тексту интерфейса.
- `Icon` выводит Unicode codepoint из проверенного словаря. Английское имя
  иконки не выводится текстом при загрузке. По умолчанию глиф декоративный
  (`aria-hidden`); имя действия остаётся у кнопки/ссылки. `label` предназначен
  для самостоятельной смысловой иконки.
- Размер по умолчанию 20 px; доступны 16, 18, 20, 24 px. Толщина 400, активное
  выделение 500; GRAD 0; оптический размер 20–24; FILL 0–1.
- FILL и толщина переходят плавно за 180 ms у активной навигации, закреплённых
  шаблонов и выбранной темы. Настройка уменьшения движения учитывается.
- Цвет наследуется через currentColor: нейтральные действия используют текст,
  выделение — синий акцент; успех и ошибки сохраняют зелёные/красные токены.
  Старые CSS-фильтры ограничены изображениями, чтобы не инвертировать глифы.
- Apache-лицензия находится в `public/licenses/MaterialSymbols-LICENSE.txt`
  и включается Vite в готовый дистрибутив.

```tsx
<Icon name="search" />
<button aria-label="Удалить"><Icon name="delete" /></button>
<Icon name="bookmark" size={24} filled={isPinned} />
<Icon name="check_circle" label="Сохранено" />
```

| Раздел / действие | Имя Material Symbol |
| --- | --- |
| Все формы | `description` |
| Мои формы | `folder` |
| Шаблоны | `dashboard_customize` |
| Справочник ОУ | `school` |
| Конструктор | `edit_document` |
| Пользователи | `group` |
| Настройки | `settings` |
| Поиск / фильтры | `search` / `filter_list` |
| Создание / редактирование | `add` / `edit` |
| Переименование / копирование | `drive_file_rename_outline` / `content_copy` |
| Скачивание / загрузка / удаление | `download` / `upload` / `delete` |
| Поделиться / информация / дополнительные действия | `share` / `info` / `more_horiz` |

Иконки SurveyJS, логотипы, ONLYOFFICE, QR, подписи пользователей и содержимое
авторских форм сохранены. Замены выполнялись по компонентам, с сохранением
обработчиков, прав доступа, aria-имён, состояний загрузки и существующих анимаций.

## Изменённые файлы в этой задаче

Пути указаны от корня проекта. Правки предыдущих задач сюда не включены.

Подключение и общий механизм:

- `frontend/package.json`
- `frontend/index.html`
- `frontend/src/app.css`
- `frontend/src/interface.css`
- `frontend/src/shared/ui/Icon.tsx`
- `frontend/src/shared/ui/materialSymbols.json`
- `frontend/src/shared/ui/MoreHorizontalIcon.tsx`
- `frontend/src/shared/ui/RefreshButton.tsx`
- `frontend/src/assets/fonts/material-symbols-outlined.woff2`
- `frontend/src/assets/fonts/material-symbols-outlined.source.json`
- `frontend/public/licenses/MaterialSymbols-LICENSE.txt`
- `frontend/scripts/update-material-symbols.mjs`
- `frontend/scripts/check-bundle-budget.mjs`

Компоненты интерфейса:

- `frontend/src/app/layout/AppLayout.tsx`
- `frontend/src/widgets/Sidebar/Sidebar.tsx`
- `frontend/src/widgets/Sidebar/SidebarAccountMenu.tsx`
- `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardToolbar.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardFormActionMenu.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardFormCard.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardFormMetaLine.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardDeadlineTooltip.tsx`
- `frontend/src/pages/DashboardPage/components/DashboardFormStatusControl.tsx`
- `frontend/src/pages/DashboardPage/components/ShareFormModal.tsx`
- `frontend/src/pages/TemplatesPage/components/TemplateCard.tsx`
- `frontend/src/pages/TemplatesPage/components/TemplateCardMenu.tsx`
- `frontend/src/pages/UsersPage/UsersPage.tsx`
- `frontend/src/pages/UsersPage/components/UsersFiltersBar.tsx`
- `frontend/src/pages/OrganizationsPage/OrganizationsPage.tsx`
- `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
- `frontend/src/pages/FormResponsesPage/DocumentsModal.tsx`
- `frontend/src/pages/FormResponsesPage/DocumentResults.tsx`
- `frontend/src/pages/FormResponsesPage/GenerateDocuments.tsx`
- `frontend/src/pages/FormResponsesHtmlPage/FormResponsesHtmlPage.tsx`

Проверки:

- `frontend/src/shared/ui/Icon.test.tsx`
- `frontend/src/shared/ui/RefreshButton.test.tsx`
- `frontend/src/widgets/Sidebar/Sidebar.test.tsx`
- `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- `frontend/src/pages/TemplatesPage/TemplatesPage.test.tsx`
- `frontend/src/pages/OrganizationsPage/OrganizationsPage.test.tsx`
- `frontend/src/pages/SettingsPage/SettingsPage.test.tsx`
- `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- `frontend/src/pages/FormResponsesHtmlPage/FormResponsesHtmlPage.test.tsx`
- `frontend/e2e/material-symbols.e2e.spec.ts`
- `frontend/e2e/interface-design.e2e.spec.ts`
- `frontend/e2e/sidebar-account.e2e.spec.ts`
- `frontend/e2e/form-sharing.e2e.spec.ts`
- `frontend/e2e/forms-table.e2e.spec.ts`
- `frontend/e2e/mobile-layout.e2e.spec.ts`
- `design-qa.md`
- `docs/material-symbols.md`

Удалены 18 заменённых файлов из `frontend/src/img/` после проверки отсутствия
ссылок: `search.svg`, `copy.svg`, `delete.svg`, `edit.svg`, `rename.svg`,
`refresh.png`, `Download.svg`, `Upload.svg`, `share.svg`, `Share_black.svg`,
`Share_white.svg`, `ExitBlack.svg`, `ExitWhite.svg`, `FormatViewBlack.svg`,
`FormatViewWhite.svg`, `deadline.svg`, `info.svg`, `use.svg`.

## Обновление набора

1. Добавить имя в `materialSymbols.json`.
2. В `frontend/` выполнить `npm run icons:update` — это единственная операция
   подключения, которой нужен доступ к официальным внешним источникам.
3. Выполнить `npm run icons:check`, сборку и браузерную проверку глифов.

`npm run build` автоматически проверяет целостность локального шрифта, словарь
и наличие лицензии. Шрифту установлен отдельный лимит 32 KiB; общий бюджет
увеличен на 16 KiB для фактического прироста статических ресурсов. Ограничения
начальных JS/CSS и зависимостей сохранены.

## Проверка

Результаты тестов, визуальные сравнения обеих тем и исправление центрирования
кнопки информации записаны в `design-qa.md`. Исходные снимки, итоговые кадры,
доски всех глифов, измерения и журналы находятся в
`.codex/reports/material-symbols-20261027/`.

Закрепление шаблона использует `bookmark` размером 24px: контур в обычном состоянии
и плавное заполнение FILL=1 после закрепления. Неиспользуемая `star` удалена из поднабора.
