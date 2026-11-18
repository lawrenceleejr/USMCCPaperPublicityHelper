#!/usr/bin/env node
// Sample carousels from real muon collider papers, for looking at the
// slides' design: node scripts/samples.mjs [out] [--offline] [--theme NAME]
//
// Each row of tests/fixtures/papers.tsv (sheet format) goes through the app
// as a person would use it: paste the row, Make slides, add two of the
// paper's figures from arXiv (unless --offline), in a different theme per
// paper (or --theme). Every slide is exported as the app exports it, and
// all of them are laid out on one contact sheet: <out>/contact.png.
// Needs: npm run build:cli; CHROMIUM_PATH to use an installed Chromium.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--theme'))) || path.join(root, 'build/samples'));
const rows = fs.readFileSync(path.join(root, 'tests/fixtures/papers.tsv'), 'utf8').trim().split('\n');
const bin = process.env.USMCC_BIN || path.join(root, 'src-tauri/target/release', process.platform === 'win32' ? 'usmcc.exe' : 'usmcc');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usmcc-samples-'));
const proc = spawn(bin, ['--serve', '--no-open', '--port', '0'], { env: { ...process.env, USMCC_HOME: home } });
const base = await new Promise((resolve, reject) => {
  let o = '';
  proc.stdout.on('data', (d) => {
    o += d;
    const m = o.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (m) resolve(m[0]);
  });
  setTimeout(() => reject(new Error('server did not start')), 10000);
});
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(base + '/');
await page.waitForFunction(() => window.S && S.doc && window.Sheets);
const themes = await page.evaluate(() => Object.keys(Render.THEMES));
const sheet = [];

for (const [i, row] of rows.entries()) {
  const theme = opt('--theme') || themes[i % themes.length];
  const r = await page.evaluate(
    async ({ row, theme, offline }) => {
      await Sheets.newDoc();
      S.doc.theme = theme;
      S.doc.paper = await U.api('POST', '/api/parse-row', { text: row });
      Sheets.paper();
      [...document.querySelectorAll('#sheet-body button')].find((b) => b.textContent.startsWith('Make slides')).click();
      let note = '';
      if (!offline) {
        try {
          const f = await U.api('GET', '/api/arxiv/figures?url=' + encodeURIComponent(S.doc.paper.paperLink));
          // the paper's first two figures, with their captions
          const pics = f.figures.slice(0, 2);
          const blob = (x) => new Blob([Uint8Array.from(atob(x.data), (c) => c.charCodeAt(0))], { type: x.mime });
          const items = [];
          for (const x of pics) items.push({ blob: await Sheets.figurePng(blob(x)), name: x.name, caption: x.caption, photo: false });
          U.go(1);
          await U.addPictures(items, { photo: false });
          note = `${pics.length} figures`;
        } catch (e) {
          note = 'no figures: ' + e.message;
        }
      }
      const files = [];
      for (const s of S.doc.slides) {
        const b = await U.renderSlide(s, 'image/png');
        const buf = new Uint8Array(await b.arrayBuffer());
        let bin = '';
        for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
        files.push(btoa(bin));
      }
      return { files, note, title: S.doc.paper.plainTitle || S.doc.paper.paperTitle };
    },
    { row, theme, offline: flag('--offline') }
  );
  const names = r.files.map((b64, k) => {
    const n = `${String(i + 1).padStart(2, '0')}-${theme}-${k + 1}.png`;
    fs.writeFileSync(path.join(out, n), Buffer.from(b64, 'base64'));
    return n;
  });
  sheet.push({ theme, title: r.title, names });
  console.log(`${i + 1}. ${theme}: ${r.title.slice(0, 70)} · ${names.length} slides · ${r.note}`);
}

// one contact sheet: a row per paper
const html = `<!doctype html><meta charset=utf-8><style>
body{margin:0;padding:24px;background:#111;color:#bbb;font:13px -apple-system,Helvetica,sans-serif}
.row{display:flex;gap:10px;margin:0 0 22px;align-items:flex-start}.row img{height:300px;display:block}
.lbl{width:150px;flex:none}.lbl b{display:block;color:#eee;font-weight:500;margin-bottom:4px}</style>
${sheet.map((s) => `<div class=row><div class=lbl><b>${s.theme}</b>${s.title.replace(/</g, '&lt;')}</div>${s.names.map((n) => `<img src="${n}">`).join('')}</div>`).join('')}`;
fs.writeFileSync(path.join(out, 'contact.html'), html);
const cp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await cp.goto('file://' + path.join(out, 'contact.html'));
await cp.waitForTimeout(500);
await cp.screenshot({ path: path.join(out, 'contact.png'), fullPage: true });
await browser.close();
proc.kill();
console.log(`→ ${path.relative(process.cwd(), path.join(out, 'contact.png'))}`);
