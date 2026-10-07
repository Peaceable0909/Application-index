import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Refreshes the Supabase session cookie and sends signed-out users to /login.
// (Staff-allowlist enforcement happens server-side in requireStaff().)
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const { pathname } = req.nextUrl;
  const pwa = pathname === '/sw.js' || pathname === '/manifest.webmanifest' || pathname.startsWith('/pwa/');
  const isStudentArea = pathname === '/student' || pathname.startsWith('/student/');
  const host = (req.headers.get('host') || '').toLowerCase();
  const studentHost = (process.env.STUDENT_HOST || '').toLowerCase();

  // Optional separate address for students (set STUDENT_HOST): that address only ever serves the student portal.
  if (studentHost && host === studentHost) {
    const ok = isStudentArea || pathname.startsWith('/auth/') || pathname.startsWith('/api/files/') || pathname === '/api/email/logo' || pathname === '/icon.svg' || pwa;
    if (pathname === '/') return NextResponse.redirect(new URL(data.user ? '/student' : '/student/login', req.url));
    if (!ok) return NextResponse.redirect(new URL('/student', req.url));
  }

  const open = pathname === '/login' || pathname === '/student/login' || pathname.startsWith('/auth/') || pathname.startsWith('/api/sync') || pathname === '/api/email/logo' || pwa;
  if (!data.user && !open) {
    // The front door (/) and anything under /student is for students; every staff page sends you to the team sign-in.
    const toStudent = isStudentArea || pathname === '/' || (!!studentHost && host === studentHost);
    return NextResponse.redirect(new URL(toStudent ? '/student/login' : '/login', req.url));
  }
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
