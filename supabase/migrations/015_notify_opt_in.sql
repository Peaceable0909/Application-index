-- Automatic notification emails are opt-in: nobody gets them unless they switch them on in My profile.
alter table portal_staff alter column notify_email set default false;
update portal_staff set notify_email = false;
