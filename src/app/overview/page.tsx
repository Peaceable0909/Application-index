import { redirect } from 'next/navigation';

// The dashboard lives at "/". This keeps /overview (old links, bookmarks, the sign-in redirect) from landing on a "not found" page.
export default function OverviewRedirect() { redirect('/'); }
