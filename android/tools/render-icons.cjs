// Draws every launcher, notification and splash picture of the Android app from store/icon-mark.svg.
// Run:  node android/tools/render-icons.cjs   (needs Playwright, e.g. `npm i -g playwright`)
// The mark is a generated placeholder (a W on the WhiteRock red); replace store/icon-mark.svg when real icon artwork exists.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const res = path.join(root, 'app/src/main/res');
const svg = fs.readFileSync(path.join(root, 'store/icon-mark.svg'), 'utf8');
const inner = svg.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect width="512" height="512" fill="#e8333a"\/>/, '');
const RED = '#e8333a';
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;
const scaled = (s, body) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${body}</g>`;
const rounded = wrap(`<defs><clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath></defs><g clip-path="url(#c)"><rect width="512" height="512" fill="${RED}"/>${scaled(.9, inner)}</g>`);
const foreground = wrap(scaled(.62, inner));                       // adaptive icon layer: the mark inside the 66% safe zone
const mono = (body) => body.replace(/#ffffff|#2d2f8f/g, '#000000');
const monochrome = wrap(scaled(.62, mono(inner)));                 // Android 13 themed icon: one colour, the system tints it
const notif = wrap(scaled(.86, inner.replace(/#2d2f8f/g, '#ffffff'))); // status bar: white on transparent
const splash = wrap(scaled(.5, rounded.replace(/<svg[^>]*>|<\/svg>/g, '')));  // the rounded tile at half size on a transparent square
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  const page = await b.newPage();
  const draw = async (markup, size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  for (const [d, k] of Object.entries(DENS)) {
    await draw(rounded, Math.round(48 * k), path.join(res, `mipmap-${d}/ic_launcher.png`));
    await draw(foreground, Math.round(108 * k), path.join(res, `mipmap-${d}/ic_launcher_foreground.png`));
    await draw(monochrome, Math.round(108 * k), path.join(res, `mipmap-${d}/ic_launcher_monochrome.png`));
    await draw(notif, Math.round(24 * k), path.join(res, `drawable-${d}/ic_notification_icon.png`));
    await draw(splash, Math.round(300 * k), path.join(res, `drawable-${d}/splash.png`));
  }
  await draw(svg, 512, path.join(root, 'store/play-icon-512.png'));   // the Play Store listing icon: square, Play rounds it
  await b.close();
})();
