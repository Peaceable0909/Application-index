# Working in this repo

## UI conventions

- **No emoji as icons, ever.** Every icon in the interface is an SVG from `src/components/Icon.tsx` (`<Icon n="check" />`). Need one that is missing? Add a path to that file instead of typing a symbol or emoji into the markup. That includes check marks, crosses, stars, sparkles and arrows used as icons (plain arrows inside a sentence are fine).
- The only emoji allowed are ones people choose to send: the chat emoji keyboard, message reactions, call reactions and the sticker pack. They are message content, not interface.
- Text the app writes into chats ("Photo", "Voice call · 2:31") stays plain words. `src/lib/sysText.ts` shows older rows without their emoji prefix and draws call lines with an icon.
- Anything `position: fixed` (sheets, dialogs, toasts) must not sit inside an element that keeps a `transform` after its entrance animation, or it gets pinned to that element instead of the screen. Entrance animations on page containers use `backwards` fill, not `both`.

## Brand

- The brand is **WhiteRock** (company: **WhiteRock Educational Services**), and it is the only name in the interface, emails, notifications, link previews, app name and calendar files. The name "Extravel" was dropped on the boss's instruction: do not use it anywhere. The old product names "WhiteRock Admissions" / "Admissions Portal" are not used either; the product is simply the WhiteRock portal (team portal / student portal). (The `@whiterock` part of calendar UIDs in `src/lib/interviews.ts` stays, it only has to remain stable.)
- Show the logo with `<Logo />` (`src/components/Logo.tsx`), never as typed text or a redrawn SVG. It is one file, `public/brand/whiterock-logo.png`, which carries its own red and navy shapes so it works on light, dark and navy surfaces. It is wide (610:95), so size it by height (about 24 to 46 px in headers). All brand files live in `public/brand` and `public/pwa`, and `/brand/*` is public on purpose (sign-in pages and mail apps load it without a session). The old `extravel-*.png` file names still exist only so emails already sent and installed apps keep working; they now contain the WhiteRock logo. The favicon, notification badge and square icons are generated placeholders (the wordmark on white, a red "W" tile); replace them when the real icon artwork exists.
- The opening intro is `src/components/Splash.tsx`: it plays `public/brand/whiterock-intro.gif` for the file's own length and falls back to a short shine on the logo when that file is missing. Replace the film by adding that file.

## Messaging and calls

- Chats and calls use short "look again now" nudges (`src/lib/realtime.ts`, listener `src/components/RealtimeNudge.tsx`, Supabase Realtime broadcast on a hashed channel per person). A nudge carries no content, only `msg`, `ring` or `call`; the app then asks the server what happened. Anything that creates a message or call should nudge the other side, and nothing may depend on the nudge arriving (the regular refresh stays as the safety net).
- Student conversations for staff live in the WhatsApp-style messenger at `/inbox` (`StaffMessenger` around `ChatThread`). Send people there, not to the old Messages tab, from alerts and links.
- Attachments over ~3.5 MB go straight from the browser to the `chat-files` bucket (`src/lib/directUpload.ts`, `/api/thread/upload`), because a request to the server only carries ~4 MB. The bucket limit is 20 MB (migration 032). The GIF tab searches GIPHY through `/api/gif/search` and needs `GIPHY_API_KEY` in Vercel; without it only "From your phone" works.
- Students can set their own profile picture (`portal_student_profiles`, migration 031). Show it with `studentPhoto(s)` wherever a student appears to staff.

## Workspaces (countries)

- Every student belongs to one **workspace** (`portal_applications.workspace`, default `uk`). Staff open only the workspaces in `portal_staff.workspaces` (admins: all). The switcher in the top bar sets a cookie; `currentWorkspace()` (`src/lib/workspace.ts`) is the one place to ask which one a request is in.
- **Every list or count over students, or over anything that belongs to a student, must be scoped to the workspace.** On `portal_applications` use `.eq('workspace', ws)`. On child tables (tasks, reminders, activity, notes, documents, doc scans/text, student messages, cred attempts, folder suggestions) join with `portal_applications!inner(...)` and add `.eq('portal_applications.workspace', ws)`. A single student opened by id is already protected by `canAccessApp` / `guardApp` (use them on every page, action and API route that takes an application id).
- Jobs with no signed-in person (cron, sync, digests) never call `currentWorkspace()`: they loop `listWorkspaces()` and pass the key explicitly (`loadStudents({ workspace })`, `refreshTasks(rows, ws)`).
- Brain notes, interview slots and credibility questions have their own `workspace` column. A student sees the ones of their own workspace (`me.apps[0].workspace`).
- A `student_key` for a non-default workspace is prefixed `"<ws>:"`, so the same person in two countries is never merged.

## AI Brain, new-student chat, memory

- The Brain (`src/lib/brain.ts`) drafts replies from one student's file, the workspace's brief, notes and uploaded files (`portal_brain_docs`, passages picked by `src/lib/brainDocs.ts`), and the student's memory. It sends no names, emails or phone numbers to the model. Opt-in with `AI_BRAIN=on`. Automatic replies (`src/lib/autoReply.ts`) are a per-workspace switch, off by default; automatic messages are `by_ai` and shown with an "AI assistant" tag.
- Memory (`src/lib/memory.ts`): after a student's new messages the conversation is summarised into `portal_student_memory` and one pinned note (`portal_notes.ai_key = 'memory'`, author `ai`). Notes with an `ai_key` are replaced, never piled up.
- The new-student chat is public: `/hello/<workspace>` and `/api/hello/*` are open in `middleware.ts`, closed per workspace until an admin switches it on (`portal_workspaces.lead_chat`). It needs consent, is rate limited, has its own AI budget (`LEAD_DAILY_LIMIT`), takes contact details from what the visitor typed (not from the model) and never sees student data. Staff answer on `/leads`; a person's reply pauses the assistant for that chat.

## Document reader

- Passports are read exactly from their machine-readable lines (`src/lib/mrz.ts`, ICAO 9303 check digits): no AI call, and the passport text never leaves the portal. Everything else is read by Drive OCR (Apps Script `extractText`) and understood by the AI after `redactForAi` hides ID-like strings. `portal_doc_scans.method` is `mrz`, `ai` or `unreadable`; the Documents page reports the split so we only add a stronger OCR server if too many files are unreadable.
- "Check all" reads three files at a time (`scanNext` in `src/lib/scanQueue.ts`).

## Sign-in security

- Staff identity goes through one gate, `staffGate()` in `src/lib/auth.ts` (`requireStaff` / `currentStaff` are built on it). It answers `ok`, `enroll`, `needs2fa`, `expired` or `none`; never read the session yourself to decide if someone is staff.
- Two-step sign-in is Supabase MFA (TOTP authenticator app). It is optional per person; an admin can make it required for admins or everyone (`portal_settings.two_step`, Settings → Sign-in security). Anyone with a verified factor must reach `aal2` in each session. `TWO_STEP_DISABLED=1` in Vercel is the emergency off switch.
- Time limits live in `src/lib/session.ts` (`SESSION_IDLE_MINUTES` default 60, `SESSION_MAX_HOURS` default 12). The `wr_act` cookie is written only by sign-in and by `IdleLock` through `/api/session/touch` (after real input), never by background polling or `router.refresh()`; middleware turns an old cookie into the `x-wr-idle` header that the gate reads.
- Every staff open or download of a document through `/api/files/[fileId]` is written to `portal_audit` (`doc_opened` / `doc_downloaded`, one line per person per file per 10 minutes). Students opening their own files are not logged.

## Reports, weekly summary, voice notes

- `src/lib/funnel.ts` is the one place that counts the road from chat to enrolment (chats in `portal_leads`, students in `portal_applications`, "reached an offer" = current status at or past Offer Received, or ever having had one in `portal_activity`). Reports page, its CSV and the weekly email all use it, always with the workspaces the viewer may open.
- The Monday management summary (`src/lib/weeklyReport.ts`, settings key `weekly_report` in `portal_settings`) is sent by the daily `/api/sync` job on Mondays, once per week, only when an admin switched it on in Settings. No icons or emoji in it.
- Voice notes are written down by `src/lib/voice.ts` through `src/lib/stt.ts` (any "audio/transcriptions" API: Groq by default, `STT_BASE_URL` / `STT_MODEL` to change). Opt-in with `AI_VOICE=on` and `STT_API_KEY` in Vercel; the recording leaves the portal, so it is off by default. The words are kept in `portal_student_msgs.transcript` (shown to the team only; the Brain, memory and inbox search use them after names, numbers and links are stripped). Automatic replies never answer a voice-only message.

## Lead sources

- Where a student first heard about WhiteRock is `portal_applications.source` (+ `source_by`: `form`, `chat`, or the staff email who set it by hand, which the sheet sync never overwrites) and `portal_leads.source`. The one list is `SOURCES` in `src/lib/sources.ts`; `canonicalSource()` maps free text ("ig", "QR code") onto it.
- The student-facing document form (separate repo `Peaceable0909/whiterock-document-form-rcl`, a static page that posts to the Apps Script) asks "How did you hear about WhiteRock?" and sends it as `Lead source: X` inside the notes, so no Apps Script change is needed. `src/lib/sync.ts` reads that tag into `source` and hides it from the notes. A form link with `?src=instagram` pre-selects the answer.
- Chat links carry the source too: `/hello/<ws>?src=flyer-or-poster` (Settings → Chat links lists them with QR codes). `public/chat-bubble.js` is the one-line website bubble (an iframe of `/hello/<ws>?embed=1`); inside it the lead's secret travels in an `x-lead-token` header because browsers may refuse our cookie on another site. `next.config.mjs` stops every page except `/hello` and the bubble script from being framed by other sites.

## New-student chat engine

- One turn is `runLeadTurn` in `src/lib/leadEngine.ts`; `src/lib/leads.ts` only wires it to the database, the model and the notifications (`LeadIO`), and `src/lib/leadProfile.ts` holds the model-free logic (profile fields, greeting / "yes" / "talk to a person" detection, what to ask next, and every check a drafted reply must pass). Test the engine with fake `LeadIO` (no database needed).
- The assistant writes plain text from a real message history (`generateText`, Apps Script `aiChat` with `messages`); a second JSON call extracts the visitor's profile (`portal_leads.profile`: name, country, school, programme, level, qualifications, previousSchool, other) and only keeps what the visitor actually typed. Contact details and a clearly stated name are read without a model.
- **The assistant may never say that something was sent, passed on or arranged.** Replies that do are rejected and rewritten (`claimsAction`). Only the engine says so, with fixed wording, after `notifyHandover` really delivered (push or email to the team) and the lead was flagged (`handover_at`, `handover_delivered`). If notifying fails the visitor is told so honestly. When the model fails or the AI is off, the visitor gets an honest "I could not answer that", never a handover claim, and `needs_human` is only ever set by a real handover request.
- Facts come only from the country brief, team notes, uploaded files and the document list; anything else is "I cannot confirm that", logged in `portal_chat_gaps` (shown on the Brain page) so the team can teach it. No dashes, emoji, links, contact details, invented figures or outcome promises in replies.

## Public front page (/welcome)

- `/welcome` is open to everyone (`middleware.ts` lets `/welcome` and `/welcome/*` through). It is also the front door: a signed-out visitor who opens the bare address `/` is shown it (middleware rewrite, the address stays `/`). Signed-in people at `/` get their usual page, the installed app starts at `/student`, and the separate student address (`STUDENT_HOST`) still goes straight to the student sign-in. To undo, remove the `pathname === '/'` rewrite in `middleware.ts`.
- The whole page is one film that follows the scroll, and the information is written into the white space around the person as she moves. The film is the student's own video cut into 183 WebP stills (`public/welcome/frames/f001.webp` ...; cut with `scripts/welcome-frames.sh video.mp4`; `scripts/welcome-camera.mjs` re-measures the white space; the current stills come from the "clearer" video and were cleaned of its star watermark by `scripts/welcome-unstar.cjs`). `ScrollStory.tsx` draws the still that matches the scroll position on a full-screen canvas.
- `content.ts` holds everything that is not layout: `PANELS` (the words, and which side of the picture each sits on), `TIMELINE` (how much scrolling each stretch takes and which frames it covers: the film slows down while a panel is read and speeds through the parts with no spare room), `CAMERA` (how far the picture slides sideways, as a share of the screen, to open more white space; it was worked out from the pictures by measuring free space per frame, and the uncovered strip is the picture's own edge stretched, so there is no seam) and `FOCUS` (phones show a narrow slice of the film, so it follows her). A different video needs new stills, `FRAME_COUNT`, and new `TIMELINE`, `CAMERA`, `FOCUS` and `still` numbers.
- Wide screens (`min-aspect-ratio: 3/2` and 900 px or more) write bare text into the white space. Everything narrower or squarer puts each panel in a card low on the screen; panels that sit side by side on a wide screen then follow each other.
- Stills are fetched nearest-first (the first 24 at once, the rest after the first scroll), and only a short window is kept decoded (a decoded 1600 px still is ~6 MB, phones cannot hold all of them).
- People with "reduce motion" (and anyone with scripts blocked) get the same scenes as plain pictures and text (`.wl-still`), with no canvas and no film download. Inactive panels are `inert`, so only the visible one can be tabbed to.
- Keep the words to things WhiteRock really does: no figures, no promises about results. The universities line is per workspace (`UNIVERSITIES`); a country without an entry shows no such panel.
- The chat buttons use the same bubble as any website (`/chat-bubble.js`, `data-src="website"`) and only appear for a country whose chat an admin switched on. Sign-in links on that page are plain `<a>` (not `next/link`) so the bubble, which lives outside React, is gone after leaving the page.
