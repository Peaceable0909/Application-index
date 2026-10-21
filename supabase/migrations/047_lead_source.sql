-- Where each student / chat lead heard about WhiteRock (Instagram, website, flyer, ...).
-- source_by: 'form' (picked on the document form), 'chat' (the link or QR code they used) or a staff email (set by hand; the sheet sync never overwrites it).
alter table portal_applications add column if not exists source text, add column if not exists source_by text;
alter table portal_leads add column if not exists source text;
create index if not exists portal_applications_source on portal_applications (workspace, source);
