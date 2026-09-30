#!/usr/bin/env node
// Headless browser harness: open a page of the running dev server, drive it with keys, capture screenshots,
// console output and errors. Uses the locally installed Edge/Chrome through puppeteer-core.
//
// Usage:
//   node tools/shot.mjs --url "/?scene=track&track=test-oval" --out shots/track.png
//   node tools/shot.mjs --url "/?quickrace=test-oval&char=serika&autopilot=1" --wait 8000 --shots 3 --interval 2000 --out shots/race.png
//   node tools/shot.mjs --url "/" --keys "Enter@1500,ArrowDown@2500,Enter@3000" --wait 5000 --out shots/menu.png
//   node tools/shot.mjs --url "/?scene=drive" --hold "ArrowUp@500-6000,ArrowLeft@2000-3000" --wait 6500 --out shots/drive.png
//   node tools/shot.mjs --url "/?scene=hud" --eval "window.__ssk && window.__ssk.state" --out shots/hud.png
//
// Options:
//   --url       path (relative to --base) or absolute URL             (default "/")
//   --base      dev server origin                                    (default http://localhost:5173)
//   --out       screenshot path (.png). With --shots N, files get suffixes -1, -2, ...
//   --wait      ms to wait after load before the (first) screenshot   (default 4000)
//   --shots     number of screenshots                                 (default 1)
//   --interval  ms between screenshots                                (default 1000)
//   --width/--height viewport                                         (default 1280x720)
//   --keys      comma list of taps "Key@ms" (ms after load)             e.g. "Enter@1000,Space@1200"
//   --hold      comma list of holds "Key@startMs-endMs"                 e.g. "ArrowUp@500-8000"
//   --click     comma list "x:y@ms" mouse clicks
//   --eval      JS expression evaluated at the end; result printed as JSON
//   --swiftshader  use SwiftShader software GL instead of the hardware GPU (slower, for debugging GPU issues)
//   --quiet     only print errors
// Output: prints console messages (warnings/errors always), page errors and failed requests.
// Exit code 2 if the page threw uncaught errors.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const base = opt('base', 'http://localhost:5173');
let url = opt('url', '/');
if (!/^https?:/.test(url)) url = base.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
const out = opt('out', null);
const wait = Number(opt('wait', 4000));
const shots = Number(opt('shots', 1));
const interval = Number(opt('interval', 1000));
const width = Number(opt('width', 1280));
const height = Number(opt('height', 720));
const quiet = !!opt('quiet', false);
const useGpu = !opt('swiftshader', false);
const evalExpr = opt('eval', null);

const parseList = (s) => (typeof s === 'string' && s.length ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const taps = parseList(opt('keys', '')).map((k) => {
  const [key, at] = k.split('@');
  return { key, at: Number(at || 0) };
});
const holds = parseList(opt('hold', '')).map((k) => {
  const [key, range] = k.split('@');
  const [a, b] = (range || '0-1000').split('-').map(Number);
  return { key, start: a, end: b };
});
const clicks = parseList(opt('click', '')).map((c) => {
  const [xy, at] = c.split('@');
  const [x, y] = xy.split(':').map(Number);
  return { x, y, at: Number(at || 0) };
});

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Set CHROME_PATH.');
  process.exit(1);
}

const glArgs = useGpu
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  dumpio: !!process.env.SSK_DUMPIO,
  args: [
    ...glArgs,
    `--window-size=${width},${height}`,
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width, height },
  protocolTimeout: 120000,
});

let pageErrors = 0;
const t0 = Date.now();
const stamp = () => `${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s`;
try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const type = msg.type();
    if (quiet && type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (text.includes('[vite]')) return;
    console.log(`[${stamp()}] console.${type}: ${text}`);
  });
  page.on('pageerror', (err) => {
    pageErrors++;
    console.log(`[${stamp()}] PAGE ERROR: ${err.stack || err.message || err}`);
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (u.includes('fonts.g')) return;
    console.log(`[${stamp()}] REQUEST FAILED: ${u} ${req.failure()?.errorText || ''}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) console.log(`[${stamp()}] HTTP ${res.status()}: ${res.url()}`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const loadedAt = Date.now();

  // schedule input
  const timers = [];
  const at = (ms, fn) =>
    timers.push(
      new Promise((resolve) =>
        setTimeout(async () => {
          try {
            await fn();
          } catch (e) {
            console.log(`input error: ${e.message}`);
          }
          resolve();
        }, Math.max(0, ms - (Date.now() - loadedAt)))
      )
    );
  for (const t of taps) at(t.at, () => page.keyboard.press(t.key, { delay: 60 }));
  for (const h of holds) {
    at(h.start, () => page.keyboard.down(h.key));
    at(h.end, () => page.keyboard.up(h.key));
  }
  for (const c of clicks) at(c.at, () => page.mouse.click(c.x, c.y));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(wait);
  for (let i = 0; i < shots; i++) {
    if (out) {
      let file = out;
      if (shots > 1) {
        const ext = path.extname(out) || '.png';
        file = out.slice(0, out.length - ext.length) + `-${i + 1}` + ext;
      }
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      await page.screenshot({ path: file });
      console.log(`[${stamp()}] screenshot -> ${file}`);
    }
    if (i < shots - 1) await sleep(interval);
  }
  await Promise.race([Promise.all(timers), sleep(100)]);
  if (evalExpr) {
    try {
      const r = await page.evaluate((expr) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(expr);
        return JSON.stringify(v, (k, val) => (typeof val === 'number' ? Math.round(val * 1000) / 1000 : val), 1);
      }, evalExpr);
      console.log(`EVAL ${evalExpr} =>\n${r}`);
    } catch (e) {
      console.log(`EVAL ERROR: ${e.message}`);
    }
  }
} finally {
  await browser.close();
}
if (pageErrors) {
  console.log(`\n${pageErrors} uncaught page error(s).`);
  process.exit(2);
}
