// A phone whose browser is showing the desktop version of a site (Chrome's "Desktop site", Safari's "Request Desktop Website") lays the page out about
// a thousand pixels wide and shrinks it to fit the screen, so everything looks tiny. The page cannot switch that off itself (desktop mode ignores the
// viewport tag), so it notices and tells the person how to. Pure, so the rules are tested.

export type DesktopSignals = {
  touchPoints: number;   // navigator.maxTouchPoints
  coarse: boolean;       // matchMedia('(pointer: coarse)')
  innerWidth: number;    // the width the page is laid out at, in CSS pixels
  innerHeight: number;   // and its height: tells upright from sideways
  screenW: number;       // screen.width
  screenH: number;       // screen.height
  scale?: number | null; // visualViewport.scale: below 1 when the page has been shrunk to fit
  ua: string;            // navigator.userAgent
};

/** True for a touch device with a phone-sized screen that is showing a desktop-sized page. Tablets and computers are left alone. */
export function looksLikePhoneInDesktopMode(s: DesktopSignals): boolean {
  if (!(s.touchPoints > 0) || !s.coarse) return false;
  const short = Math.min(s.screenW, s.screenH), long = Math.max(s.screenW, s.screenH);
  if (!(short > 0) || short >= 700) return false;
  const shrunk = typeof s.scale === 'number' && s.scale > 0 && s.scale < 0.75;      // the browser zoomed the page out to fit
  const upright = s.innerHeight > s.innerWidth;
  const wide = s.innerWidth > (upright ? short : long) * 1.15;                        // laid out much wider than the screen is across (some browsers do not swap screen.width when turned, so compare by side)
  const desktopAgent = !/mobi|android|iphone|ipod/i.test(s.ua);                       // desktop browsers do not call themselves mobile
  return shrunk || wide || desktopAgent;
}

/** How much to enlarge the notice so it reads at normal size even though the whole page is shrunk. Never smaller than 1, never more than 4. */
export function noticeScale(scale: number | null | undefined, innerWidth: number, screenW: number, screenH: number): number {
  const fit = Math.min(screenW, screenH) / Math.max(1, innerWidth);
  const s = typeof scale === 'number' && scale > 0 ? scale : fit;
  return Math.min(4, Math.max(1, 1 / s));
}
