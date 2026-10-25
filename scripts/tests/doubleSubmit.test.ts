// Run with: npx tsx scripts/tests/doubleSubmit.test.ts  (pure)
import { isRecent, isStaleMove, justDid, splitDuplicates } from '../../src/lib/doubleSubmit';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-10-25T12:00:00Z');
const at = (s: number) => new Date(NOW - s * 1000).toISOString();
const slot = (o: Partial<{ starts_at: string; trainer: string | null; created_by: string | null; created_at: string }> = {}) => ({ starts_at: '2026-10-26T15:00:00.000Z', trainer: 'trainer@x.org', created_by: 'me@x.org', created_at: at(8), ...o });
const base = { who: 'me@x.org', trainer: 'trainer@x.org', now: NOW };

eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [slot()], base), { fresh: [], dupes: ['2026-10-26T15:00:00.000Z'] }, 'the same session made 8 seconds ago is a double click');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [slot({ starts_at: '2026-10-26 15:00:00+00' })], base).dupes.length, 1, 'the database may write the time in its own format; it is still the same moment');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z', '2026-11-02T15:00:00.000Z'], [slot()], base), { fresh: ['2026-11-02T15:00:00.000Z'], dupes: ['2026-10-26T15:00:00.000Z'] }, 'a weekly series keeps the weeks that are not made yet');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [slot({ created_at: at(600) })], base).fresh.length, 1, 'the same time made ten minutes ago is a deliberate second session');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [slot({ created_by: 'other@x.org' })], base).fresh.length, 1, 'someone else making the same time is not my double click');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [slot({ trainer: 'other@x.org' })], base).fresh.length, 1, 'a different trainer is a different session');
eq(splitDuplicates(['2026-10-26T16:00:00.000Z'], [slot()], base).fresh.length, 1, 'a different time is a different session');
eq(splitDuplicates(['2026-10-26T15:00:00.000Z'], [], base), { fresh: ['2026-10-26T15:00:00.000Z'], dupes: [] }, 'nothing recent: nothing is blocked');

// ---- a password-reset link asked for twice ----
eq([justDid(undefined, 'abc', NOW), justDid('', 'abc', NOW)], [false, false], 'nothing asked yet: send it');
eq(justDid(`abc:${NOW - 10_000}`, 'abc', NOW), true, 'the same address 10 seconds ago: a repeated tap, do not send again');
eq(justDid(`abc:${NOW - 90_000}`, 'abc', NOW), false, 'a minute and a half later it is a fresh request');
eq(justDid(`zzz:${NOW - 5_000}`, 'abc', NOW), false, 'another address is another request');
eq(justDid('abc:not-a-number', 'abc', NOW), false, 'a damaged cookie never blocks anyone');

// ---- an email that was only just sent ----
eq([isRecent(at(20), NOW), isRecent(at(119), NOW), isRecent(at(130), NOW)], [true, true, false], 'two minutes is the window');
eq([isRecent(null, NOW), isRecent('garbage', NOW), isRecent(new Date(NOW + 60_000).toISOString(), NOW)], [false, false, false], 'no date, a broken date or a date in the future never blocks');

// ---- a stage moved up or down twice ----
eq([isStaleMove('2', 2), isStaleMove('2', 3), isStaleMove(null, 3), isStaleMove('', 3), isStaleMove(undefined, 0)], [false, true, false, false, false], 'a click from where the stage is moves it; from where it was is stale; a click with no position still works');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
