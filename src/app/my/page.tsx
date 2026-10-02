import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import CounselorBoard from '@/components/CounselorBoard';

export const maxDuration = 60;

// A counselor's home: only the students assigned to them.
export default async function My({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  if (staff.role !== 'counselor') redirect('/counselors');   // team members use the full portal
  const sp = await searchParams;
  if (!staff.counselor_key) {
    return <div className="card err">Your login isn’t linked to a counselor yet. Ask an admin to give you portal access from the Counselors page.</div>;
  }
  return <CounselorBoard staff={staff} ckey={staff.counselor_key} mode="self" basePath="/my" sp={sp} />;
}
