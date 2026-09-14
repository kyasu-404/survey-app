begin;
alter table public.office_documents drop constraint office_documents_name_check;
alter table public.office_documents add constraint office_documents_name_check check(length(name) between 6 and 200 and name ~* '\.(docx|xlsx)$');
alter table public.office_documents add column file_type text not null default 'docx' check(file_type in ('docx','xlsx'));
alter table public.office_documents add column template_field_count integer not null default 0;
update storage.buckets set allowed_mime_types=array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id='survey-documents';
-- Legacy aggregate bindings are retained for existing documents and backups;
-- new template fields live in the office file itself and do not use this table.
commit;
