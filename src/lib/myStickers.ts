// "My stickers": animated GIF / WebP / PNG stickers a person saves on this device (kept in the browser's own storage, never uploaded until sent).
export type MySticker = { id: string; blob: Blob; name: string; type: string; at: number };
const DB = 'wr-stickers', ST = 's', MAX_BYTES = 2 * 1024 * 1024, MAX_COUNT = 60;
export const STICKER_TYPES = /^image\/(gif|webp|png)$/;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((res, rej) => { const q = f(db.transaction(ST, mode).objectStore(ST)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
};
export const listMine = async (): Promise<MySticker[]> => ((await run('readonly', (s) => s.getAll())) as MySticker[]).sort((a, b) => b.at - a.at);
export const removeMine = (id: string) => run('readwrite', (s) => s.delete(id));
export const stickerExt = (type: string) => (type === 'image/gif' ? 'gif' : type === 'image/webp' ? 'webp' : 'png');
/** Saves a file as a sticker. Returns an error message, or null when saved. */
export async function addMine(f: File): Promise<string | null> {
  if (!STICKER_TYPES.test(f.type)) return 'Stickers can be GIF, WebP or PNG images.';
  if (f.size > MAX_BYTES) return 'That sticker is over 2 MB. Pick a smaller one.';
  const have = await listMine();
  if (have.length >= MAX_COUNT) return 'You have 60 stickers saved. Remove one first.';
  await run('readwrite', (s) => s.put({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, blob: f, name: f.name, type: f.type, at: Date.now() } satisfies MySticker));
  return null;
}
