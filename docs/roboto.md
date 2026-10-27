# Локальный Roboto

Основной шрифт интерфейса — Roboto. Единый стек задаёт `--app-font-family`
в `frontend/src/app.css`. Меню, поля и кнопки наследуют его; интерфейс Creator
использует штатные `--ctr-font-family` и `--sjs2-typography-font-family-default`
в обеих темах. Собственные шрифты, выбранные автором в теме формы, сохраняются.

Шрифт скачан напрямую с официального Google Fonts API:
[Roboto normal/italic 100–900](https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap).
[Официальные метаданные](https://github.com/google/fonts/blob/main/ofl/roboto/METADATA.pb).
Лицензия SIL OFL сохранена в `frontend/public/licenses/Roboto-OFL.txt`.

В `frontend/src/assets/fonts/` хранятся восемь WOFF2: normal/italic для latin,
latin-ext, cyrillic и cyrillic-ext. `roboto.css` содержит исходные unicode-range,
font-display: swap и веса 100–900. Браузер загружает только необходимые подмножества
с текущего домена. Обычные кириллица и латиница предзагружаются через index.html;
нет внешнего CSS Google Fonts, npm-обёрток или сетевых действий при сборке.

`roboto.source.json` фиксирует исходные URL, размеры и SHA-256 каждого файла и CSS.

Из `frontend/`:

- `npm run fonts:check` — проверка локальных файлов, CSS и лицензии без сети;
  автоматически выполняется при `npm run build`.
- `npm run fonts:update` — явное обновление с официальных HTTPS-источников.
  После него следует проверить размеры, bundle budget и обе темы в браузере.

Восемь файлов занимают 277816 байт в репозитории; основные два normal subsets —
66800 байт. Остальные загружаются только при соответствующих символах/курсиве.
Material Symbols Outlined остаётся отдельным шрифтом для иконок.
