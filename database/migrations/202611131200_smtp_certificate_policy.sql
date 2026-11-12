begin;

alter table public.mail_settings
  add column if not exists allow_invalid_certificate boolean not null default false;

comment on column public.mail_settings.allow_invalid_certificate is
  'Explicit administrator exception for SMTP TLS certificate verification; encryption remains enabled.';

notify pgrst, 'reload schema';

commit;
