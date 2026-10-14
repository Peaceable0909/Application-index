# Extravel

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
   Whenever `PortalApi.gs` changes in the repo, paste the new version over the old one and redeploy a new version. The
   change that lets the portal write a moved student's school and programme into Sheet1 needs that. Until then a move still
   works in the portal, and Sheet1 is brought up to date by the next sync after the script is updated.
3. **Env vars** – copy `.env.example` → `.env.local` (or set them in Vercel).
4. **Staff login** – create a user (same email as in `portal_staff`) in Supabase → Authentication → Users.
5. Deploy to Vercel. `vercel.json` syncs daily (Vercel free plan limit); the Apps Script webhook (`notifyPortal_`) makes new
   applications appear instantly; **Sync now** on the dashboard forces it.

## Features
Dashboard with search + filters (counselor, university, programme, country, status, needs-attention);
application page with details, all documents (preview/download, Drive location), missing-document check,
upload (saved into the student's Drive folder and linked), status + counselor updates (written back to the
Sheet), notes, activity history, and **email to counselor** (sent from your Gmail via Apps Script,
counselor emails are entered under **Settings**).

Edit required documents and pipeline statuses in `src/lib/constants.ts`.

## Brand
The logo, icons and link preview live in `public/brand/` (and `public/pwa/` for the home-screen icons). The site opens with an
intro: the still logo, then `public/brand/extravel-intro.gif` plays from its first frame and the screen fades out when the
film ends (tap or Esc skips it; it shows once every 3 hours per device, never when the phone asks for reduced motion).
Until that file exists, or if it can't be loaded in time, a short shine across the logo is shown instead. To change the
film, replace the file under the same name.
