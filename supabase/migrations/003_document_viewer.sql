alter table portal_documents
  add column if not exists folder_path text,     -- subfolder inside the student's Drive folder, if any
  add column if not exists type_override text;   -- staff correction; sync never overwrites it
