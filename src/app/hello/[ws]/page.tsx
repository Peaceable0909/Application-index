import { notFound } from 'next/navigation';
import { admin } from '@/lib/supabase';
import Logo from '@/components/Logo';
import LeadChat from '@/components/LeadChat';

export const metadata = { title: 'Chat with an adviser', robots: { index: false, follow: false } };

/** Public: someone who wants to study abroad talks to the assistant. No sign-in, no student data. */
export default async function Hello({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { data: w } = await admin().from('portal_workspaces').select('key, name, active, lead_chat').eq('key', ws.toLowerCase()).maybeSingle();
  if (!w || !w.active || !w.lead_chat) notFound();
  return (
    <div className="hello">
      <div className="hello-card">
        <header className="hello-head"><Logo height={24} alt="WhiteRock" /><div><b>Study in {w.name}</b><small>WhiteRock · ask anything. A counselor can join the chat.</small></div></header>
        <LeadChat ws={w.key} country={w.name} />
      </div>
    </div>
  );
}
