#!/usr/bin/env node
// Fetches the slide and interface fonts from Google Fonts into web/fonts/,
// with web/fonts/fonts.css and the licences (OFL.txt). Kept in the repo so
// the desktop app and Lite work offline and slides draw alike everywhere.
//   node scripts/fetch-fonts.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'web/fonts');
const FAMILIES = [
  ['Inter', 'ital,opsz,wght@0,14..32,100..900;1,14..32,100..900', 'inter'],
  ['Fraunces', 'ital,opsz,wght@0,9..144,300..900;1,9..144,300..900', 'fraunces'],
  ['Instrument Serif', 'ital@0;1', 'instrumentserif'],
  ['Source Serif 4', 'ital,opsz,wght@0,8..60,200..900;1,8..60,200..900', 'sourceserif4'],
  ['Anton', '', 'anton'],
  ['Manrope', 'wght@200..800', 'manrope'],
  ['Newsreader', 'ital,opsz,wght@0,6..72,200..800;1,6..72,200..800', 'newsreader'],
  ['IBM Plex Sans', 'ital,wght@0,100..700;1,100..700', 'ibmplexsans'],
  ['IBM Plex Mono', 'ital,wght@0,400;0,500;0,600;1,400', 'ibmplexmono'],
];
const SUBSETS = new Set(['latin', 'latin-ext', 'greek']);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const q = FAMILIES.map(([f, axes]) => 'family=' + f.replace(/ /g, '+') + (axes ? ':' + axes : '')).join('&');
const css = await (await fetch(`https://fonts.googleapis.com/css2?${q}&display=swap`, { headers: { 'User-Agent': UA } })).text();
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.woff2')) fs.rmSync(path.join(dir, f));
const out = [];
let total = 0;
for (const [, subset, block] of css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face\s*\{[^}]*\})/g)) {
  if (!SUBSETS.has(subset)) continue;
  const fam = block.match(/font-family: '([^']+)'/)[1];
  const style = block.match(/font-style: (\w+)/)[1];
  const weight = block.match(/font-weight: ([\d ]+);/)[1].trim();
  const url = block.match(/url\((https:[^)]+)\)/)[1];
  const name = `${fam.toLowerCase().replace(/ /g, '-')}-${style}${/ /.test(weight) ? '' : '-' + weight}-${subset}.woff2`;
  if (!fs.existsSync(path.join(dir, name))) {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(dir, name), buf);
    total += buf.length;
  }
  out.push(`/* ${fam} ${style} ${weight} ${subset} */\n` + block.replace(url, name));
}
fs.writeFileSync(
  path.join(dir, 'fonts.css'),
  `/* Fonts from Google Fonts (fonts.google.com), kept here so the app works
   offline and slides draw the same everywhere. SIL Open Font License 1.1:
   see OFL.txt. Made by scripts/fetch-fonts.mjs. */\n` + out.join('\n') + '\n'
);
let ofl = '';
for (const [fam, , slug] of FAMILIES) {
  const t = await (await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`)).text();
  ofl += `===== ${fam} =====\n\n${t.trim()}\n\n`;
}
fs.writeFileSync(path.join(dir, 'OFL.txt'), ofl);
console.log(`${out.length} faces, ${Math.round(total / 1024)} KB → web/fonts`);
