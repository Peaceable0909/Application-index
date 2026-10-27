# Google Play: Data safety, content rating and declarations (draft answers)

These answers are drafted from what the portal does (see `src/app/privacy/page.tsx`, which is the source of truth). Check each one against the live policy before you submit, and change both if reality changes.
They are not legal advice. Have them read by whoever advises WhiteRock on data protection.

## Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes (everything travels over HTTPS).
**Do you provide a way for users to request that their data is deleted?** Yes. Web link: https://applications-2026-kohl.vercel.app/privacy#rights (students email applications.whiterock@gmail.com).

| Data type | Collected | Shared | Optional | Why |
|---|---|---|---|---|
| Personal info: name | Yes | No | Required | App functionality, account management |
| Personal info: email address | Yes | No | Required | App functionality, account management, communications |
| Personal info: phone number | Yes | No | Required | App functionality, communications |
| Personal info: address (city and country) | Yes | No | Required | App functionality |
| Personal info: other (date of birth, gender, school and programme applied for) | Yes | No | Required | App functionality |
| Financial info: other (whether a payment to the university has been received, recorded by the team; no payment is made in the app) | Yes | No | Required | App functionality |
| Photos and videos: photos | Yes | No | Optional | App functionality (document photos, profile picture, chat photos) |
| Audio: voice or sound recordings (voice notes; calls are not recorded) | Yes | No | Optional | App functionality |
| Files and docs | Yes | No | Required | App functionality (application documents) |
| Messages: other in-app messages | Yes | No | Required | App functionality, communications |
| App activity: other user-generated content (practice interview answers) | Yes | No | Optional | App functionality |
| Device or other IDs (the address your browser gives us for push notifications) | Yes | No | Optional | App functionality (notifications) |

Not collected: precise or approximate location, contacts, calendar, health, web browsing history, advertising ID.

**About "shared".** Google does not count a transfer to a service provider that processes data on our behalf, or a transfer the user asked for, as sharing. We use providers (Supabase, Vercel, Google, an AI service, a speech-to-text service) as processors, and we send documents to a university only when the student has asked us to apply there. If your adviser reads the rules differently, change the Shared column.

## Content rating (IARC questionnaire)

Category: **Reference, news or educational**. Answer **No** to violence, fear, sexual content, language, controlled substances, gambling. Answer **Yes** to "users can communicate" (students chat with WhiteRock staff only, not with each other) and **No** to sharing location and to digital purchases.

## Other Play Console declarations

- **Target audience**: 18 and over (do not select children).
- **Ads**: the app contains no ads.
- **App access**: all functionality needs sign-in. See "Test account for the Google reviewers" in `README.md`: this has to be sorted before production review.
- **Government app / financial features / health / news / COVID**: No.
- **Advertising ID**: not used.
- **Account deletion**: students do not create accounts in the app (WhiteRock creates them from applications), so the in-app deletion rule does not apply, but the deletion request link above is in the form.
