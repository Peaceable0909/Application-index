-- Why the assistant could not answer the last message (shown to the team on the Leads page, cleared by the next good answer).
alter table portal_leads add column if not exists fail_reason text;
