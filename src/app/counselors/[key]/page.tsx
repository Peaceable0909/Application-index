import { requireTeam } from '@/lib/auth';
import { decodeId } from '@/lib/format';
import CounselorBoard from '@/components/CounselorBoard';

export const maxDuration = 60;

// Team view of one counselor's workload.
export default async function CounselorPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ view?: string; q?: string; msg?: string; err?: string }> }) {
  const staff = await requireTeam();
  const key = decodeId((await params).key);
  return <CounselorBoard staff={staff} ckey={key} mode="admin" basePath={`/counselors/${encodeURIComponent(key)}`} sp={await searchParams} />;
}
