// Run with: npx tsx scripts/tests/backupRetention.test.ts  (pure)
import { KEEP_DEFAULT, clampKeep, expiredBackups, isBackupName, readKeep } from '../../src/lib/backupRetention';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const day = (n: number) => `portal-2026-10-${String(n).padStart(2, '0')}.json.gz`;
const days = Array.from({ length: 20 }, (_, i) => day(i + 1));          // 1 to 20 October

eq(expiredBackups(days, 14), days.slice(0, 6), 'with 20 stored and 14 kept, the six oldest go');
eq(expiredBackups([...days].reverse(), 14), days.slice(0, 6), 'the order the storage lists them in does not matter');
eq(expiredBackups(days, 20), [], 'exactly as many as the limit: nothing goes');
eq(expiredBackups(days.slice(0, 5), 14), [], 'fewer than the limit: nothing goes');
eq(expiredBackups(days, 3), days.slice(0, 17), 'a lower limit removes more');
eq(expiredBackups(days, 0).length, days.length - 3, 'a limit of zero is lifted to the minimum of three: some backups always remain');
eq(expiredBackups(days, -5).length, days.length - 3, 'a negative limit is treated the same way');
eq(expiredBackups(['notes.txt', '.emptyFolderPlaceholder', 'portal-latest.json.gz', 'portal-2026-10-01.json', day(2), day(3)], 3), [], 'files the backup job did not make are never counted or deleted');
eq(expiredBackups(['portal-2025-12-31.json.gz', 'portal-2026-01-01.json.gz', 'portal-2026-01-02.json.gz', 'portal-2026-01-03.json.gz'], 3), ['portal-2025-12-31.json.gz'], 'it works across a year boundary');

eq([clampKeep(1), clampKeep(14), clampKeep(500), clampKeep('30'), clampKeep(7.6), clampKeep('abc'), clampKeep(undefined), clampKeep(null), clampKeep(''), clampKeep('  ')], [3, 14, 90, 30, 8, KEEP_DEFAULT, KEEP_DEFAULT, KEEP_DEFAULT, KEEP_DEFAULT, KEEP_DEFAULT], 'the limit is a whole number from 3 to 90, and 14 when it is missing or not a number');
eq([readKeep({ keep: 21 }), readKeep({ keep: 'x' }), readKeep(null), readKeep({}), readKeep({ keep: 1000 })], [21, KEEP_DEFAULT, KEEP_DEFAULT, KEEP_DEFAULT, 90], 'the saved setting is read safely');
ok(isBackupName('portal-2026-10-25.json.gz') && !isBackupName('portal-2026-10-25.json.gz.bak') && !isBackupName('../portal-2026-10-25.json.gz') && !isBackupName('portal-26-10-25.json.gz'), 'only exact backup file names count');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
