// Run with: npx tsx scripts/tests/androidApp.test.ts  (pure)
import { ANDROID_PACKAGE, MAX_FINGERPRINTS, assetLinks, cleanPlayUrl, normalizeFingerprint, parseFingerprints, readSettings } from '../../src/lib/androidApp';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const FP = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const FP2 = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

// one fingerprint, however it was copied
eq(normalizeFingerprint(FP), FP, 'a fingerprint as Google shows it stays as it is');
eq(normalizeFingerprint(FP.toLowerCase()), FP, 'lower case is made upper case');
eq(normalizeFingerprint(FP.replace(/:/g, '')), FP, 'without colons it gets them back');
eq(normalizeFingerprint(`SHA-256: ${FP}`), FP, 'a "SHA-256:" label in front is dropped');
eq(normalizeFingerprint(`  sha256=${FP}  `), FP, 'a "sha256=" label and spaces are dropped');
eq(normalizeFingerprint(FP.replace(/:/g, ' ')), FP, 'spaces between the pairs are accepted');
eq(normalizeFingerprint(FP.slice(0, -3)), null, 'one pair short is not a fingerprint');
eq(normalizeFingerprint(FP + ':00'), null, 'one pair too many is not a fingerprint');
eq(normalizeFingerprint('ZZ' + FP.slice(2)), null, 'letters outside hex are rejected');
eq(normalizeFingerprint('4A:3B:2C'), null, 'a SHA-1 style short value is rejected');
eq(normalizeFingerprint(''), null, 'empty is rejected');

// a pasted list
eq(parseFingerprints(`${FP}\n${FP2}`), { ok: [FP, FP2], bad: [] }, 'one per line');
eq(parseFingerprints(`${FP}, ${FP2}; ${FP}`).ok, [FP, FP2], 'commas, semicolons and repeats: each fingerprint once');
eq(parseFingerprints(`${FP}\nhello\n${FP2}`), { ok: [FP, FP2], bad: ['hello'] }, 'a bad line is reported, the good ones are kept');
eq(parseFingerprints(''), { ok: [], bad: [] }, 'empty text is an empty list');
eq(parseFingerprints('\n\n  \n'), { ok: [], bad: [] }, 'blank lines are ignored');
const many = Array.from({ length: 9 }, (_, i) => `${i.toString(16).padStart(2, '0')}${FP.slice(2)}`).join('\n');
eq(parseFingerprints(many).ok.length, MAX_FINGERPRINTS, 'no more than the limit are kept');

// the Google Play link
eq(cleanPlayUrl(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`), `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`, 'the app page is accepted');
eq(cleanPlayUrl(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&hl=en&gl=GB`), `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`, 'extra parameters are dropped');
eq(cleanPlayUrl(''), null, 'empty is no link');
eq(cleanPlayUrl('https://play.google.com/store/apps/details?id=com.someone.else'), null, 'another app is refused');
eq(cleanPlayUrl(`http://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`), null, 'plain http is refused');
eq(cleanPlayUrl(`https://evil.example/store/apps/details?id=${ANDROID_PACKAGE}`), null, 'another site is refused');
eq(cleanPlayUrl(`https://play.google.com.evil.example/store/apps/details?id=${ANDROID_PACKAGE}`), null, 'a look-alike address is refused');
eq(cleanPlayUrl('javascript:alert(1)'), null, 'a script address is refused');
eq(cleanPlayUrl(null), null, 'nothing is no link');

// the file Android reads
eq(assetLinks([]), [], 'no fingerprints: an empty (valid) file');
const one = assetLinks([FP]);
eq(one, [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FP] } }], 'one fingerprint gives the standard statement');
eq(assetLinks([FP, FP.toLowerCase(), 'nonsense', FP2])[0].target.sha256_cert_fingerprints, [FP, FP2], 'repeats and junk are dropped before they reach the file');
ok(ANDROID_PACKAGE === 'com.whiterock.portal', 'the package name is the one in android/app/build.gradle');

// settings: what is stored plus the environment list
eq(readSettings({ fingerprints: [FP], play_url: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` }), { fingerprints: [FP], playUrl: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` }, 'stored settings are read');
eq(readSettings({ fingerprints: [FP] }, FP2), { fingerprints: [FP, FP2], playUrl: null }, 'the environment list is added to the stored one');
eq(readSettings(null, null), { fingerprints: [], playUrl: null }, 'nothing stored, nothing set');
eq(readSettings({ fingerprints: 'not a list', play_url: 5 }), { fingerprints: [], playUrl: null }, 'a damaged stored value gives nothing instead of failing');
eq(readSettings(undefined, `${FP}, junk`).fingerprints, [FP], 'junk in the environment list is ignored');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
