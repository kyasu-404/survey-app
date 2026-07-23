# Security review Survey App — итог после исправлений

## Вердикт

После применения миграций `202607161200_security_hardening.sql` и `202607161900_security_followup.sql`, исправлений frontend/Edge/deploy и повторной проверки ни одна подтверждённая code-level находка не остаётся отчётной для текущего снимка. Все кандидаты имеют discovery, validation и attack-path closure; исправленные пути дополнительно подтверждены живой локальной Supabase.

## Основные гарантии текущей реализации

- роль и состояние аккаунта проверяются по `public.profiles`, включая уже выпущенные JWT;
- RLS и grants являются основным authorization boundary, UI не считается защитой;
- приватная форма доступна владельцу/администратору, а активная публичная форма — согласно продуктовому правилу;
- видимость активных форм администратора и их ответов пользователям `user` сохранена намеренно;
- лимит ответов резервируется атомарно и не обходится bulk/concurrent INSERT;
- ответы идемпотентны по `(form_id, submission_id)`;
- SurveyJS schema/HTML/URL и размеры schema/response ограничиваются и в browser, и в БД;
- анонимный Storage не разрешает read/list/delete, кроме точечного удаления ещё неиспользованного upload capability;
- authenticated Storage read требует владения, admin role либо точной ссылки из доступного ответа;
- Edge Functions отклоняют отключённых администраторов и используют явный CORS allowlist;
- auth callback URL и чувствительные headers очищаются до отправки в Sentry;
- CI actions, Docker images и lockfile детерминированы; build secret не попадает в image history.

## Проверенные атаки

- старый JWT отключённого администратора: чтение пусто, запись и Edge admin actions запрещены;
- mass assignment `responses_count`: запрещён;
- конкурентный финальный слот: записывается один ответ, форма закрывается атомарно;
- bulk INSERT при `max_responses=1`: транзакция целиком отклоняется без изменения счётчика;
- повтор того же `submission_id` после закрытия: дубль не создаётся;
- oversized schema/response и `max_responses > 100000`: запрещены;
- внешние SurveyJS asset URL: запрещены и sanitizer, и DB constraint;
- anonymous Storage read/list: запрещены; upload в активную форму разрешён в лимитах;
- удаление referenced/foreign upload: запрещено; точный unreferenced capability удаляется;
- чтение referenced file обычным пользователем: разрешено только когда сам ответ ему доступен;
- форма отключённого автора: скрыта и не принимает ответы/файлы.

## Defense in depth

Анонимные формы принципиально допускают abuse-трафик. Код ограничивает объект 10 МиБ, суммарное число/объём на форму, payload и число ответов; production nginx дополнительно ограничивает Storage upload до 1 r/s на IP. Для интернет-развёртывания следует не публиковать Kong напрямую и добавить CAPTCHA/Turnstile при существенном риске распределённого спама.

Подробная инженерная часть и матрица тестов находятся в [полном код-ревью](./code-review-2026-07-16.md).
