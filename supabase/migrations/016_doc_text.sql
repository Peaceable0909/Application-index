-- Full plain text read out of each student document (Drive OCR inside the Apps Script). Staff-only, scoped like documents.
create table if not exists portal_doc_text (
  drive_file_id text primary key references portal_documents(drive_file_id) on delete cascade,
  application_id text not null references portal_applications(application_id) on delete cascade,
  text text not null default '',
  chars int not null default 0,
  truncated boolean not null default false,
  method text,
  error text,
  extracted_by text,
  extracted_at timestamptz not null default now()
);
create index if not exists portal_doc_text_app on portal_doc_text(application_id);
alter table portal_doc_text enable row level security;
