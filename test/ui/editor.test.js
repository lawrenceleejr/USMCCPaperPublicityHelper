'use strict';
/* The carousel editor in a browser, against the desktop's own server:
   build a carousel from a sheet row, photos and plots; export it as JPEGs,
   PNGs and a PDF; undo; reload; and stay quick: flipping slides and moving
   a layer must paint within 50 ms of the key press.

   Run: npm run build:cli && npm run test:ui */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { desktop, launch, pictures, imageSize, watchErrors, filePicker, ROW } = require('./helpers');

const BUDGET_MS = 50;
let srv;
let browser;
let pics;

test.before(async () => {
  srv = await desktop();
  browser = await launch();
  const page = await browser.newPage();
  pics = await pictures(page, srv.home);
  await page.close();
});
test.after(async () => {
  await browser?.close();
  srv?.stop();
});

async function open(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = watchErrors(page);
  page.choose = filePicker(page);
  await page.addInitScript(() => {
    window.__keys = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'keydown') window.__keys.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 0, buffered: true });
  });
  await page.goto(srv.base + '/');
  await page.waitForFunction(() => window.S && S.doc);
  return { page, errors };
}

async function addFiles(page, files) {
  page.choose(files);
  await page.keyboard.press('a');
}

test('a carousel from a sheet row, a photo and a plot, exported three ways', async () => {
  const { page, errors } = await open();
  await page.keyboard.press('n'); // a fresh carousel is opened at start; N adds a slide
  await page.evaluate(() => Sheets.newDoc());
  await page.keyboard.press('p');
  await page.fill('#sheet-body textarea', ROW);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => S.doc.paper && S.doc.paper.paperTitle === 'Novel Muon Collider Design');
  await page.click('text=Make slides');
  await page.waitForFunction(() => S.doc.slides.length === 3);
  const cover = await page.evaluate(() => S.doc.slides[0].layers.map((l) => l.kind + (l.role ? ':' + l.role : '')));
  assert.deepEqual(cover, ['shade', 'text:eyebrow', 'text:title', 'text:caption', 'logo']);
  assert.equal(await page.evaluate(() => S.doc.name), 'A Better Way to Collide Muons');

  // the photo goes full bleed under the theme light on the cover; the plot
  // onto a new slide, fitted on a card
  await addFiles(page, [pics.photo, pics.plot]);
  await page.waitForFunction(() => S.doc.slides.length === 4);
  const placed = await page.evaluate(() => {
    const photo = S.doc.slides[0].layers[0];
    const plot = S.doc.slides[1].layers.find((l) => l.kind === 'image');
    return { photo: [photo.kind, photo.fit, photo.x, photo.y, photo.w, photo.h], plot: [plot.fit, !!plot.card] };
  });
  assert.deepEqual(placed.photo, ['image', 'cover', 0, 0, 1080, 1350]);
  assert.deepEqual(placed.plot, ['contain', true]);

  // typing in the title re-stacks the cover from the bottom
  await page.evaluate(() => U.go(0));
  const before = await page.evaluate(() => S.doc.slides[0].layers.find((l) => l.role === 'eyebrow').y);
  await page.evaluate(() => {
    S.sel = S.doc.slides[0].layers.find((l) => l.role === 'title').id;
    U.refresh();
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(' at Higher Luminosity and Lower Cost');
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => S.doc.slides[0].layers.find((l) => l.role === 'eyebrow').y);
  assert.ok(after < before, `the eyebrow should move up as the title grows (${before} → ${after})`);

  for (const [fmt, ext] of [
    ['jpeg', 'jpg'],
    ['png', 'png'],
  ]) {
    await page.evaluate((f) => U.saveSettings({ format: f }), fmt);
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Saved \d/.test(document.querySelector('#sheet-body').textContent), null, { timeout: 30000 });
    const dir = path.join(srv.out, 'a-better-way-to-collide-muons');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort();
    assert.deepEqual(files, [1, 2, 3, 4].map((i) => `a-better-way-to-collide-muons-0${i}.${ext}`));
    for (const f of files) assert.deepEqual(imageSize(fs.readFileSync(path.join(dir, f))), [1080, 1350], f);
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.partial')));
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => U.saveSettings({ format: 'pdf' }));
  await page.keyboard.press('e');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Saved \d/.test(document.querySelector('#sheet-body').textContent), null, { timeout: 30000 });
  const pdf = fs.readFileSync(path.join(srv.out, 'a-better-way-to-collide-muons', 'a-better-way-to-collide-muons.pdf'), 'latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 4);
  assert.match(pdf, /\/Count 4/);

  // the exported cover is the photo under the theme, not a blank slide
  const jpg = fs.readFileSync(path.join(srv.out, 'a-better-way-to-collide-muons', 'a-better-way-to-collide-muons-01.jpg'));
  assert.ok(jpg.length > 40000, `cover is ${jpg.length} bytes`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('undo, redo, and the carousel is still there after a reload', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => Sheets.newDoc());
  const n0 = await page.evaluate(() => S.doc.slides[0].layers.length);
  await page.keyboard.press('t');
  await page.keyboard.type('Hello muons');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // deselect
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers[0].text), 'Hello muons');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers.length), n0);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers[0].text), 'Hello muons');
  await page.keyboard.press('n');
  await page.keyboard.press('d');
  await page.waitForTimeout(700); // autosave
  const id = await page.evaluate(() => S.doc.id);
  await page.reload();
  await page.waitForFunction(() => window.S && S.doc);
  assert.equal(await page.evaluate(() => S.doc.id), id);
  assert.equal(await page.evaluate(() => S.doc.slides.length), 3);
  assert.equal(await page.evaluate(() => S.doc.slides[0].layers[0].text), 'Hello muons');
  assert.deepEqual(errors, []);
  await page.close();
});

test('every tool has a key and a place in the menu', async () => {
  const { page } = await open();
  const items = await page.evaluate(() => U.MENU.flatMap((g) => g.items.map(([id, label, key]) => ({ id, label, key }))));
  const keyless = items.filter((i) => !i.key && i.id !== 'new');
  assert.deepEqual(keyless, []);
  const keys = items.map((i) => i.key).filter((k) => k.length === 1);
  assert.equal(new Set(keys).size, keys.length, 'a key is used twice');
  // and the macOS menu bar lists them too
  const gui = fs.readFileSync(path.join(__dirname, '..', '..', 'src-tauri', 'src', 'gui.rs'), 'utf8');
  const missing = items.map((i) => i.id).filter((id) => !gui.includes(`"${id}"`) && !['nextlayer', 'edit', 'menu', 'undo', 'redo', 'slideleft', 'slideright', 'shade'].includes(id));
  assert.deepEqual(missing, [], 'tools missing from the macOS menu bar (gui.rs)');
  await page.close();
});

function report(name, d) {
  const s = d.slice().sort((a, b) => a - b);
  console.log(`  ${name}: ${d.length} presses took ≥16 ms · max ${s.at(-1) ?? '-'} ms (budget ${BUDGET_MS} ms)`);
  assert.deepEqual(
    d.filter((x) => x > BUDGET_MS),
    [],
    `${name}: key presses slower than ${BUDGET_MS} ms to the next paint`
  );
}

test(`flipping slides and moving a layer paint within ${BUDGET_MS} ms`, async () => {
  const { page, errors } = await open();
  await page.evaluate(() => Sheets.newDoc());
  const photos = [];
  for (let i = 0; i < 6; i++) {
    const p = path.join(srv.home, `p${i}.jpg`);
    fs.copyFileSync(pics.photo, p);
    // a different byte at the end so each is its own picture
    fs.appendFileSync(p, Buffer.from([i]));
    photos.push(p);
  }
  await addFiles(page, photos);
  await page.waitForFunction(() => S.doc.slides.length === 6, null, { timeout: 30000 });
  // adjustments on every other slide (worked out off the key path)
  await page.evaluate(() => {
    S.doc.slides.forEach((s, i) => i % 2 && (s.layers[0].adj = { b: 20, c: 10, s: -30, t: 15 }));
    U.changed('test', { all: true });
  });
  await page.evaluate(() => U.go(0));
  await page.waitForTimeout(800);
  await page.evaluate(() => (window.__keys = []));
  for (let i = 0; i < 20; i++) {
    const before = await page.evaluate(() => S.cur);
    await page.keyboard.press(i % 10 < 5 ? ']' : '[');
    const now = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(S.cur))));
    assert.notEqual(now, before, 'the slide did not change');
  }
  await page.waitForTimeout(300);
  report('flipping slides', await page.evaluate(() => window.__keys.slice()));

  // a selected layer: arrows move it
  await page.evaluate(() => {
    S.sel = S.doc.slides[S.cur].layers[0].id;
    U.refresh();
  });
  await page.evaluate(() => (window.__keys = []));
  const x0 = await page.evaluate(() => S.doc.slides[S.cur].layers[0].x);
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => S.doc.slides[S.cur].layers[0].x), x0 - 200);
  report('moving a layer', await page.evaluate(() => window.__keys.slice()));
  assert.deepEqual(errors, []);
  await page.close();
});
