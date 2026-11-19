'use strict';
// Shared by the UI tests: start the desktop server or a static server for
// the built Lite, launch Chromium, and make test pictures.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const BIN = process.env.USMCC_BIN || path.join(ROOT, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'usmcc.exe' : 'usmcc');

function listen(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    proc.stderr.on('data', (d) => (out += d));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('did not start: ' + out)), 10000);
  });
}

// The desktop server with its own data folder; exports go to <home>/out.
async function desktop() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usmcc-ui-'));
  const proc = spawn(BIN, ['--serve', '--no-open', '--port', '0'], { env: { ...process.env, USMCC_HOME: home } });
  const base = await listen(proc);
  await fetch(base + '/api/settings', { method: 'PUT', headers: { 'X-USMCC': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ exportDir: path.join(home, 'out'), autoFigure: false }) });
  return { base, home, out: path.join(home, 'out'), stop: () => proc.kill() };
}

// A static server for a built Lite folder (as GitHub Pages serves it).
async function lite(dir) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-lite.mjs'), dir, '0']);
  const base = await listen(proc);
  return { base, stop: () => proc.kill() };
}

// CHROMIUM_PATH: use an installed Chromium instead of Playwright's own.
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// A photo (JPEG, 4000×3000) and a plot (PNG, 1600×1000), drawn in the page.
async function pictures(page, dir) {
  const [photo, plot, red] = await page.evaluate(() => {
    const mk = (w, h, plot) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      if (plot) {
        x.fillStyle = '#fff';
        x.fillRect(0, 0, w, h);
        x.strokeStyle = '#1f77b4';
        x.lineWidth = 6;
        x.beginPath();
        for (let i = 0; i < w; i += 10) x.lineTo(i, h / 2 - Math.sin(i / 60) * (h / 3));
        x.stroke();
        return c.toDataURL('image/png').split(',')[1];
      }
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#3a6ea5');
      g.addColorStop(1, '#c96d2d');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        x.fillStyle = `hsla(${i * 37},60%,50%,.6)`;
        x.beginPath();
        x.arc((i * 97) % w, (i * 61) % h, 80, 0, 7);
        x.fill();
      }
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    };
    // a second photo, plain red (to tell where one background gives way)
    const r = document.createElement('canvas');
    r.width = 2400;
    r.height = 1600;
    const rx = r.getContext('2d');
    rx.fillStyle = '#c0281e';
    rx.fillRect(0, 0, 2400, 1600);
    return [mk(4000, 3000, false), mk(1600, 1000, true), r.toDataURL('image/jpeg', 0.9).split(',')[1]];
  });
  const p = { photo: path.join(dir, 'photo.jpg'), plot: path.join(dir, 'plot.png'), red: path.join(dir, 'red.jpg') };
  fs.writeFileSync(p.photo, Buffer.from(photo, 'base64'));
  fs.writeFileSync(p.plot, Buffer.from(plot, 'base64'));
  fs.writeFileSync(p.red, Buffer.from(red, 'base64'));
  return p;
}

// Width and height of a JPEG (from its SOF marker) or PNG (IHDR).
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

// Answer the page's file picker with the next files given to choose().
// (A listener registered up front: a one-off waitForEvent can miss the
// picker when it opens straight away.)
function filePicker(page) {
  let next = null;
  page.on('filechooser', async (fc) => {
    if (next) {
      const f = next;
      next = null;
      await fc.setFiles(f);
    }
  });
  return (files) => (next = files);
}

// Collect page errors so a test can assert there were none.
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const ROW = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'sample_row.txt'), 'utf8').trim();

module.exports = { ROOT, BIN, desktop, lite, launch, pictures, imageSize, watchErrors, filePicker, ROW };
