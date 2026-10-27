# WhiteRock Android app

The app is a **Trusted Web Activity**: a small Android app that opens the live portal full screen inside Chrome. Everything students and the team do (chat, calls, documents, voice notes, notifications) is the website, so a portal update reaches the app instantly and the Play Store only needs a new release when the app itself changes (version, icon, address).

| | |
|---|---|
| Package name | `com.whiterock.portal` (permanent once published) |
| Opens | `https://applications-2026-kohl.vercel.app/student` |
| Android versions | 7.0 and up (min SDK 24), built for Android 16 (target SDK 36, required by Google Play from 31 August 2026) |
| Generated from | Bubblewrap templates (`twa-manifest.json`), then adjusted by hand. Do not run `bubblewrap update`: it would overwrite `app/build.gradle`. |

If the portal moves to its own domain, change `hostName` in `app/build.gradle` and `host`/`fullScopeUrl` in `twa-manifest.json`, release a new version, and the new address needs the same fingerprints (they are read from Settings, Android app).

## What is in this folder

- `app/` and the Gradle files: the Android project.
- `store/`: the Play Store kit (icon, feature graphic, screenshots, listing text, Data safety answers).
- `tools/render-icons.cjs`: redraws every icon from `store/icon-mark.svg`. The W mark is a generated placeholder, replace it when real icon artwork exists.

## Putting the app on Google Play, step by step

1. **Create the developer account** at https://play.google.com/console (a one-time fee, and Google checks your identity). Choose an **organisation** account if WhiteRock has a registered company: a new *personal* account must first run a closed test with at least 12 testers for 14 days before it may publish to everyone.
2. **Create the app**: *Create app*, name `WhiteRock`, default language English, type *App*, *Free*, tick the declarations.
3. **Upload the first release**: *Test and release, Testing, Internal testing, Create new release*. Accept *Play App Signing* when asked. Upload `app-release.aab` (you were sent this file). Save, review, roll out.
4. **Tell the website the app's fingerprint** (this is what makes the app open full screen with no browser bar):
   - In Play Console go to *Test and release, App integrity, App signing* and copy the **SHA-256 certificate fingerprint** of the *app signing key*.
   - In the portal go to **Settings, Android app**, paste it, press **Save**.
   - Open `/.well-known/assetlinks.json` on the portal address: it should now list your fingerprint(s).
5. **Test on a phone**: add yourself as an internal tester, open the test link on an Android phone, install, open. You should see the portal full screen with no address bar. Sign in, send a message, allow notifications.
6. **Fill in the store listing**: copy the texts from `store/listing.md`, upload `store/play-icon-512.png`, `store/feature-graphic-1024x500.png` and the screenshots in `store/screenshots/`. Add real in-app screenshots too. Privacy policy URL: `https://applications-2026-kohl.vercel.app/privacy`.
7. **Complete the declarations** with `store/data-safety.md` (Data safety, content rating, target audience, ads, app access).
8. **Test account for the Google reviewers**: Google must be able to sign in. Sign-in is an emailed one-time code, which a reviewer cannot receive. Ask for a reviewer account (a demo student with made-up data and a fixed sign-in code that only works for that one address) before you submit for production.
9. **Production**: *Test and release, Production, Create new release* (or, for a new personal account, run closed testing first), send for review. Reviews usually take a few days.
10. **After it is live**: copy the Google Play link into **Settings, Android app, Google Play link**. Students on Android then see a *Get the app on Google Play* button on their *Me* page.

## Building a new version

You only need this when the app itself changes. Every release needs a higher `versionCode` than the last one on Google Play.

```bash
# one-time, on the machine that has the upload key
export ANDROID_KEYSTORE_FILE=/path/to/upload.keystore
export ANDROID_KEYSTORE_PASSWORD=...   # from upload-key-secrets.txt
export ANDROID_KEY_ALIAS=upload
export ANDROID_KEY_PASSWORD=...
cd android
./gradlew bundleRelease assembleRelease -PversionCode=2 -PversionName=1.0.1
# app/build/outputs/bundle/release/app-release.aab   upload this to Play Console
# app/build/outputs/apk/release/app-release.apk      installs directly on a phone for testing
```

Needs JDK 17 or newer and the Android SDK (platform 36, build tools 36.0.0). The same can run on GitHub: *Actions, Android app, Run workflow*, with the four `ANDROID_*` secrets described in `.github/workflows/android.yml`.

## The upload key

`upload.keystore` signs what you upload. Google then re-signs the app with its own key (Play App Signing), so if the upload key is ever lost Google support can reset it. Keep the file and its password in a password manager, **never** in the repository (`.gitignore` blocks `*.keystore`).
The upload key's SHA-256 fingerprint is `0F:59:8F:40:16:8C:D2:10:F1:4C:F5:F8:7A:FD:E2:5C:99:D0:32:FF:3F:34:33:F0:2D:58:D5:3D:67:43:98:0A`. Listing it in Settings, Android app lets the test APK (`app-release.apk`) open full screen on a phone. Remove it from that list once the app is live if you no longer sideload test builds.

## Checking it works

- Browser bar visible in the app: the fingerprint is missing or wrong. Check `/.well-known/assetlinks.json` and that the package name matches.
- Notifications: Android 13 and newer asks for permission on first open. They arrive as the app's notifications (notification delegation to Chrome).
- Chrome must be installed and up to date on the phone (it is on virtually all phones with Google Play).
