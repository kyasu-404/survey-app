begin;

do $$
declare settings public.mail_settings;
begin
  insert into public.mail_settings(host, port, username, password_encrypted, from_email, from_name)
  values ('smtp.example.test', 465, 'test', 'test-only-encrypted-password', 'test@example.test', 'SMTP fixture')
  returning * into settings;
  if settings.allow_invalid_certificate is distinct from false then
    raise exception 'New SMTP settings must verify certificates by default';
  end if;
  update public.mail_settings set allow_invalid_certificate = true where id = 1;
  select * into settings from public.mail_settings where id = 1;
  if settings.allow_invalid_certificate is distinct from true
    or settings.password_encrypted <> 'test-only-encrypted-password' then
    raise exception 'Certificate exception must persist without changing the password';
  end if;
  begin
    update public.mail_settings set allow_invalid_certificate = null where id = 1;
    raise exception 'NULL certificate policy must be rejected';
  exception when not_null_violation then null;
  end;
end;
$$;

rollback;
