// Shared by the server (calls.ts) and the browser (useCall.ts): no server imports here.
export type CallKind = 'voice' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
/** One call as the signed-in person sees it. `mine` = I am the one who rang. */
export type CallView = { id: string; kind: CallKind; status: CallStatus; mine: boolean; caller: 'student' | 'staff'; answeredAt: string | null };
export type CallSignal = { id: number; kind: 'offer' | 'answer' | 'ice'; data: unknown };
