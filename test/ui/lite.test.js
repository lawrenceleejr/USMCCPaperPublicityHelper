'use strict';
/* Lite, the web version: the same page answering /api in the browser, with
   the desktop's own Rust code compiled to WebAssembly. It must read a sheet
   row, a paper's source and draft the posts exactly as the desktop does, keep
   carousels on the device, export, and work on a phone by touch.

   Run: npm run build:cli && npm run test:lite (builds Lite first) */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { devices } = require('playwright');
const { ROOT, desktop, lite, launch, pictures, watchErrors, ROW } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usmcc-lite-'));
const liteDir = path.join(tmp, 'lite');
let browser;
let srv;
let web;

test.before(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-lite.mjs'), liteDir], { stdio: 'inherit' });
  srv = await desktop();
  web = await lite(liteDir);
  browser = await launch();
});
test.after(async () => {
  await browser?.close();
  srv?.stop();
  web?.stop();
});

// A paper's source: a tar.gz with a TeX file and two figures.
function sourceTarball() {
  const entries = [
    ['main.tex', Buffer.from('\\documentclass{article}\\begin{document}Hi\\end{document}')],
    ['figs/flux.png', fs.readFileSync(path.join(ROOT, 'web', 'img', 'logo-light.png'))],
    ['figs/layout.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')],
  ];
  const blocks = [];
  for (const [name, data] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

async function openLite(opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(web.base + '/');
  await page.waitForFunction(() => window.S && S.doc && window.UsmccLite);
  return { ctx, page, errors };
}

const desktopApi = async (method, url, body, raw) => {
  const r = await fetch(srv.base + url, { method, headers: { 'X-USMCC': '1', ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ? body : body && JSON.stringify(body) });
  return r.json();
};

test('Lite reads rows, arXiv links and paper sources exactly as the desktop', async () => {
  const { ctx, page, errors } = await openLite();
  const tgz = sourceTarball();
  const inLite = await page.evaluate(
    async ([row, tgz]) => {
      const call = async (m, u, b, raw) => (await fetch(u, { method: m, headers: raw ? {} : { 'Content-Type': 'application/json' }, body: raw ? b : b && JSON.stringify(b) })).json();
      const bytes = Uint8Array.from(atob(tgz), (c) => c.charCodeAt(0));
      const parsed = await call('POST', '/api/parse-row', { text: row });
      return {
        row: parsed,
        withHeader: await call('POST', '/api/parse-row', { text: 'Timestamp\tEmail Address\tPaper Title\n' + row }),
        arxiv: await call('GET', '/api/arxiv?url=' + encodeURIComponent('https://arxiv.org/pdf/2401.12345v2.pdf')),
        bad: await call('GET', '/api/arxiv?url=' + encodeURIComponent('https://example.com/paper')),
        figures: await call('POST', '/api/figures', new Blob([bytes]), true),
        posts: await call('POST', '/api/posts', { row: parsed, mode: 'offline', thread: true }),
        claude: await call('POST', '/api/posts', { row: parsed, mode: 'claude' }),
      };
    },
    [ROW, tgz.toString('base64')]
  );
  const row = await desktopApi('POST', '/api/parse-row', { text: ROW });
  assert.deepEqual(inLite.row, row);
  assert.deepEqual(inLite.withHeader, await desktopApi('POST', '/api/parse-row', { text: 'Timestamp\tEmail Address\tPaper Title\n' + ROW }));
  assert.deepEqual(inLite.arxiv, await desktopApi('GET', '/api/arxiv?url=' + encodeURIComponent('https://arxiv.org/pdf/2401.12345v2.pdf')));
  assert.ok(inLite.bad.error);
  assert.deepEqual(inLite.figures, await desktopApi('POST', '/api/figures', tgz, true));
  assert.deepEqual(
    inLite.figures.figures.map((f) => f.name),
    ['figs/flux.png', 'figs/layout.svg']
  );
  assert.deepEqual(inLite.posts, await desktopApi('POST', '/api/posts', { row, mode: 'offline', thread: true }));
  assert.match(inLite.claude.error, /desktop app/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Lite keeps carousels on the device and exports them', async () => {
  const { ctx, page, errors } = await openLite({ acceptDownloads: true });
  const pics = await pictures(page, tmp);
  await page.keyboard.press('p');
  await page.fill('#sheet-body textarea', ROW);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => S.doc.paper && S.doc.paper.paperTitle);
  await page.click('text=Make slides');
  const fc = page.waitForEvent('filechooser');
  await page.keyboard.press('a');
  await (await fc).setFiles([pics.photo]);
  await page.waitForFunction(() => S.doc.slides[0].layers[0].kind === 'image', null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => window.S && S.doc && S.doc.slides.length === 3);
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers[0].kind), 'image');
  // no folder access in a test browser: exports download
  await page.evaluate(() => (UsmccLite.mode = 'download'));
  await page.keyboard.press('e');
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Saved 3 files to Downloads/.test(document.querySelector('#sheet-body').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  assert.deepEqual(downloads.sort(), [1, 2, 3].map((i) => `a-better-way-to-collide-muons-0${i}.jpg`));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Lite on a phone: fits the screen, and a finger moves text', async () => {
  const { ctx, page, errors } = await openLite({ ...devices['iPhone 13'] });
  assert.ok(await page.evaluate(() => document.body.classList.contains('touch')));
  await page.tap('#toolbar [data-cmd=paper]');
  await page.fill('#sheet-body textarea', ROW);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => S.doc.paper && S.doc.paper.paperTitle);
  await page.tap('text=Make slides');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scrolling');
  // the slide takes most of the screen
  const share = await page.evaluate(() => (document.querySelector('#stage').getBoundingClientRect().height / innerHeight));
  assert.ok(share > 0.5, `the slide is ${Math.round(share * 100)}% of the screen height`);
  // tap the title, then drag it up with one finger
  const at = await page.evaluate(() => {
    const l = S.doc.slides[0].layers.find((l) => l.role === 'title');
    const c = document.querySelector('#stage').getBoundingClientRect();
    return { x: c.left + (l.x + l.w / 2) * S.view.scale, y: c.top + (l.y + 50) * S.view.scale, y0: l.y };
  });
  await page.touchscreen.tap(at.x, at.y);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: at.x, y }] });
  await touch('touchStart', at.y);
  for (let i = 1; i <= 10; i++) await touch('touchMove', at.y - i * 8);
  await touch('touchEnd');
  const y1 = await page.evaluate(() => S.doc.slides[0].layers.find((l) => l.role === 'title').y);
  assert.ok(y1 < at.y0 - 100, `the title moved from ${at.y0} to ${y1}`);
  // undo is a button on phones
  await page.tap('#undo-btn');
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers.find((l) => l.role === 'title').y), at.y0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
