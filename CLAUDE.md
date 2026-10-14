# Working in this repo

## UI conventions

- **No emoji as icons, ever.** Every icon in the interface is an SVG from `src/components/Icon.tsx` (`<Icon n="check" />`). Need one that is missing? Add a path to that file instead of typing a symbol or emoji into the markup. That includes check marks, crosses, stars, sparkles and arrows used as icons (plain arrows inside a sentence are fine).
- The only emoji allowed are ones people choose to send: the chat emoji keyboard, message reactions, call reactions and the sticker pack. They are message content, not interface.
- Text the app writes into chats ("Photo", "Voice call · 2:31") stays plain words. `src/lib/sysText.ts` shows older rows without their emoji prefix and draws call lines with an icon.
- Anything `position: fixed` (sheets, dialogs, toasts) must not sit inside an element that keeps a `transform` after its entrance animation, or it gets pinned to that element instead of the screen. Entrance animations on page containers use `backwards` fill, not `both`.

## Brand

- The product is **Extravel**. It was "WhiteRock Admissions" / "Admissions Portal" before: don't bring those names back in text, emails, notifications or calendar files. (The `@whiterock` part of calendar UIDs in `src/lib/interviews.ts` stays, it only has to remain stable.)
- Show the logo with `<Logo />` (`src/components/Logo.tsx`), never as typed text or a redrawn SVG. It renders the dark-lettered file and swaps to the white-lettered one in dark mode; pass `light` on surfaces that are always dark (the staff sidebar, the email header). All brand files live in `public/brand` and `public/pwa`, and `/brand/*` is public on purpose (sign-in pages and mail apps load it without a session).
- The opening intro is `src/components/Splash.tsx`: it plays `public/brand/extravel-intro.gif` for the file's own length and falls back to a short shine when that file is missing. Replace the film by replacing the file under the same name.
