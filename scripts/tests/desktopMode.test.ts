// Run with: npx tsx scripts/tests/desktopMode.test.ts  (pure)
import { looksLikePhoneInDesktopMode, noticeScale, type DesktopSignals } from '../../src/lib/desktopMode';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const phone = (o: Partial<DesktopSignals> = {}): DesktopSignals => ({ touchPoints: 5, coarse: true, innerWidth: 412, innerHeight: 800, screenW: 412, screenH: 915, scale: 1, ua: MOBILE_UA, ...o });

// a phone in its normal mode: no notice
ok(!looksLikePhoneInDesktopMode(phone()), 'a phone in normal mode gets no notice');
ok(!looksLikePhoneInDesktopMode(phone({ innerWidth: 915, innerHeight: 412, scale: 1 })), 'a phone turned sideways (page as wide as the long side) gets no notice');
ok(!looksLikePhoneInDesktopMode(phone({ scale: 2.5 })), 'a phone the person has pinched in on gets no notice');
ok(!looksLikePhoneInDesktopMode(phone({ scale: undefined })), 'no zoom reading is fine');

// a phone in desktop mode, however it shows
ok(looksLikePhoneInDesktopMode(phone({ innerWidth: 980, scale: 0.42, ua: DESKTOP_UA })), 'Chrome desktop mode: wide page, shrunk, desktop agent');
ok(looksLikePhoneInDesktopMode(phone({ innerWidth: 980, innerHeight: 2100, scale: 1 })), 'a page laid out far wider than the screen is caught even with a mobile agent');
ok(looksLikePhoneInDesktopMode(phone({ scale: 0.5 })), 'a page shrunk to half is caught on its own');
ok(looksLikePhoneInDesktopMode(phone({ ua: DESKTOP_UA })), 'a desktop agent on a phone-sized touch screen is caught on its own');
ok(looksLikePhoneInDesktopMode({ touchPoints: 5, coarse: true, innerWidth: 980, innerHeight: 2100, screenW: 390, screenH: 844, scale: 0.4, ua: MAC_UA }), 'iPhone Safari "Request Desktop Website" (Mac agent) is caught');
ok(!looksLikePhoneInDesktopMode({ touchPoints: 5, coarse: true, innerWidth: 390, innerHeight: 700, screenW: 390, screenH: 844, scale: 1, ua: IPHONE_UA }), 'an iPhone in normal mode gets no notice');

// iPhone Safari does not swap screen.width when turned: a normal sideways page must not look wide
ok(!looksLikePhoneInDesktopMode({ touchPoints: 5, coarse: true, innerWidth: 844, innerHeight: 390, screenW: 390, screenH: 844, scale: 1, ua: IPHONE_UA }), 'an iPhone turned sideways in normal mode gets no notice');

// things that are not phones
ok(!looksLikePhoneInDesktopMode({ touchPoints: 0, coarse: false, innerWidth: 1440, innerHeight: 900, screenW: 1920, screenH: 1080, scale: 1, ua: DESKTOP_UA }), 'a computer gets no notice');
ok(!looksLikePhoneInDesktopMode({ touchPoints: 10, coarse: false, innerWidth: 1280, innerHeight: 700, screenW: 1366, screenH: 768, scale: 1, ua: DESKTOP_UA }), 'a touch laptop with a mouse gets no notice');
ok(!looksLikePhoneInDesktopMode({ touchPoints: 5, coarse: true, innerWidth: 1280, innerHeight: 1800, screenW: 800, screenH: 1280, scale: 0.62, ua: DESKTOP_UA }), 'a tablet is left alone');
ok(!looksLikePhoneInDesktopMode(phone({ screenW: 0, screenH: 0, innerWidth: 980, ua: DESKTOP_UA })), 'unknown screen size gives no notice');
ok(!looksLikePhoneInDesktopMode(phone({ touchPoints: 0, innerWidth: 980, ua: DESKTOP_UA })), 'no touch, no notice');
ok(!looksLikePhoneInDesktopMode(phone({ coarse: false, innerWidth: 980, ua: DESKTOP_UA })), 'a fine pointer, no notice');

// how much the notice is enlarged so it can be read
eq(noticeScale(1, 412, 412, 915), 1, 'a normal page is not enlarged');
eq(Math.round(noticeScale(0.42, 980, 412, 915) * 100) / 100, 2.38, 'a page shrunk to 0.42 is enlarged 2.38 times');
eq(noticeScale(undefined, 980, 412, 915) > 2.3 && noticeScale(undefined, 980, 412, 915) < 2.5, true, 'with no zoom reading, the screen and page widths give the same');
eq(noticeScale(0.05, 980, 412, 915), 4, 'never more than 4 times');
eq(noticeScale(3, 412, 412, 915), 1, 'a pinched-in page does not make the notice smaller than normal');
eq(noticeScale(0, 412, 412, 915), 1, 'a bad zoom value falls back to the screen and page widths');
eq(noticeScale(NaN as unknown as number, 412, 412, 915), 1, 'NaN falls back too');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
