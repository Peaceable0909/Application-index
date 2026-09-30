# WhiteRock Staff Portal

Portal on top of your existing **Google Sheet + Drive + Apps Script**. The Sheet stays the
source of truth for application data, Drive keeps the documents, and this app adds search,
filters, document preview/upload, notes, history, status updates and counselor emails.

```
Form app ──► Apps Script doPost ──► Sheet row + Drive folder  (unchanged)
                     │  PortalApi.gs (token-protected)
                     ▼
Portal (Next.js, server-side only) ◄──► Supabase (notes, history, counselor emails, cache)
```

The browser never talks to Google or to the database directly: every read/write and every
document download goes through the portal server after a staff login check.

## Setup
1. **Database** – run `supabase/migrations/001_portal.sql` (already applied to the `elltpulse` project; uses `portal_*` tables only).
2. **Apps Script** – add `apps-script/PortalApi.gs` to your project and follow the header comments
   (set `PORTAL_TOKEN`, add the 1-line hook at the top of `doPost`, redeploy a new version).
3. **Env vars** – copy `.env.example` → `.env.local` (or set them in Vercel).
4. **Staff login** – create a user (same email as in `portal_staff`) in Supabase → Authentication → Users.
5. Deploy to Vercel. `vercel.json` syncs every 10 min; the Apps Script webhook (`notifyPortal_`) makes new
   applications appear instantly; **Sync now** on the dashboard forces it.

## Features
Dashboard with search + filters (counselor, university, programme, country, status, needs-attention);
application page with details, all documents (preview/download, Drive location), missing-document check,
upload (saved into the student's Drive folder and linked), status + counselor updates (written back to the
Sheet), notes, activity history, and **email to counselor** (sent from your Gmail via Apps Script,
counselor emails are entered under **Settings**).

Edit required documents and pipeline statuses in `src/lib/constants.ts`.
