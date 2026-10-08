import { currentStaff } from './auth';
import { currentStudent } from './student';

/** Whoever is signed in right now (staff first, as everywhere else in the portal). */
export async function pushUser(): Promise<{ email: string; role: 'student' | 'staff' } | null> {
  const st = await currentStaff();
  if (st) return { email: st.email.toLowerCase(), role: 'staff' };
  const me = await currentStudent();
  return me ? { email: me.email.toLowerCase(), role: 'student' } : null;
}
