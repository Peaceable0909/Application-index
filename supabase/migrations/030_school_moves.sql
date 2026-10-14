-- A school and/or programme change made in the portal (a "move").
-- The sheets stay the source for everything else. This column says "show this instead of what the sheet has",
-- and remembers what the sheet said at the time so the next sync can tell whether someone has since edited the sheet:
--   { "school":    { "to": "BPP University", "from": "rcl" },
--     "programme": { "to": "MSc Finance",     "from": "msc project management" },
--     "at": "2026-10-14T10:00:00Z", "by": "staff@example.com", "sheet": true }
-- "sheet" is true once Sheet1 itself was updated too. The sync drops the entry on its own when the sheet agrees.
alter table portal_applications add column if not exists moved jsonb;
