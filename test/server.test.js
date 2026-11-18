'use strict';
// Black-box tests of the Rust server (`usmcc --serve`). Build first:
//   npm run build:cli   (cargo build --release --no-default-features …)
// Nothing here touches the network: arXiv and Claude are not called.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = process.env.USMCC_BIN || path.join(ROOT, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'usmcc.exe' : 'usmcc');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'sample_row.txt'), 'utf8');
const HEADER =
  'Timestamp\tEmail Address\tPaper Title\tOptional less technical title\tAuthor list / Collaboration\tDate of publication or posting\tCategory\tPublic abstract/description\tLink to paper\tFigures/materials OK to repost?\tAdditional comments?';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usmcc-'));
const home = path.join(tmp, 'home');
const exportDir = path.join(tmp, 'exports');
let proc;
let base;
let port;

async function api(method, url, body, { raw, headers } = {}) {
  const r = await fetch(base + url, {
    method,
    headers: { 'X-USMCC': '1', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, headers: r.headers, data: type.startsWith('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

// fetch() won't send a forged Host header; plain http can.
function rawGet(p, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

/* a tiny tar writer: ustar headers, GNU long names */
function tarHeader(name, size, type) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.fill(' ', 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
function tar(files) {
  const parts = [];
  for (const [name, data] of files) {
    if (Buffer.byteLength(name) > 100) {
      const n = Buffer.from(name + '\0');
      parts.push(tarHeader('././@LongLink', n.length, 'L'), pad(n));
    }
    parts.push(tarHeader(name, data.length, '0'), pad(Buffer.from(data)));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

test.before(async () => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ exportDir }));
  const env = { ...process.env, USMCC_HOME: home };
  delete env.ANTHROPIC_API_KEY;
  proc = spawn(BIN, ['--serve', '--no-open', '--port', '0'], { env });
  base = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
  });
  port = Number(base.split(':').pop());
});

test.after(() => {
  proc?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('serves the page', async () => {
  const r = await fetch(base + '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.strictEqual((await fetch(base + '/nope.js')).status, 404);
  assert.strictEqual(await rawGet('/../Cargo.toml', { Host: `127.0.0.1:${port}` }), 403);
});

test('only the page itself may use the API', async () => {
  assert.strictEqual(await rawGet('/api/info', { Host: 'evil.example' }), 403);
  assert.strictEqual(await rawGet('/api/info', { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' }), 403);
  assert.strictEqual(await rawGet('/api/info', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }), 200);
  const noHeader = await fetch(base + '/api/parse-row', { method: 'POST', body: JSON.stringify({ text: SAMPLE }) });
  assert.strictEqual(noHeader.status, 403);
});

test('info and settings', async () => {
  const { data } = await api('GET', '/api/info');
  assert.strictEqual(data.shell, 'browser');
  assert.strictEqual(data.keychain, false);
  assert.strictEqual(data.hasKey, false);
  assert.strictEqual(data.exportDir, exportDir);
  const s = await api('GET', '/api/settings');
  assert.deepStrictEqual(s.data, { exportDir });
  assert.strictEqual((await api('PUT', '/api/settings', [1])).status, 400);
  assert.strictEqual((await api('PUT', '/api/settings', { exportDir, model: 'claude-sonnet-5-5' })).status, 200);
  assert.strictEqual((await api('GET', '/api/settings')).data.model, 'claude-sonnet-5-5');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, 'settings.json'))).model, 'claude-sonnet-5-5');
});

test('parse a row from the sheet', async () => {
  const want = {
    timestamp: '2024-01-15 10:30:00',
    email: 'author@example.com',
    paperTitle: 'Novel Muon Collider Design',
    plainTitle: 'A Better Way to Collide Muons',
    authors: 'C. Anderson, S. Neddermeyer',
    publicationDate: '2024-01-10',
    category: 'accelerator',
    publicAbstract: 'This paper presents a novel design for a muon collider. The design achieves higher luminosity with reduced beam emittance.',
    paperLink: 'https://arxiv.org/abs/2401.12345',
    figuresOk: true,
    additionalComments: 'Please highlight the energy efficiency aspect.',
  };
  assert.deepStrictEqual((await api('POST', '/api/parse-row', { text: SAMPLE })).data, want);
  assert.deepStrictEqual((await api('POST', '/api/parse-row', { text: HEADER + '\n' + SAMPLE })).data, want);
  const bad = await api('POST', '/api/parse-row', { text: 'just\ttwo' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /title/);
});

test('arXiv links and ids', async () => {
  const cases = {
    'https://arxiv.org/abs/2401.12345': '2401.12345',
    'https://arxiv.org/pdf/2401.12345v2.pdf': '2401.12345v2',
    'https://arxiv.org/e-print/2401.12345': '2401.12345',
    'arXiv:2401.12345': '2401.12345',
    '2401.12345': '2401.12345',
    'https://arxiv.org/abs/hep-th/0701123': 'hep-th/0701123',
  };
  for (const [url, id] of Object.entries(cases)) {
    const { data } = await api('GET', '/api/arxiv?url=' + encodeURIComponent(url));
    assert.deepStrictEqual(data, { id, abs: `https://arxiv.org/abs/${id}`, pdf: `https://arxiv.org/pdf/${id}`, src: `https://arxiv.org/src/${id}` });
  }
  assert.strictEqual((await api('GET', '/api/arxiv?url=' + encodeURIComponent('https://example.com/x.pdf'))).status, 400);
  assert.strictEqual((await api('GET', '/api/arxiv/pdf?url=nope')).status, 400);
});

test('figures from a source archive', async () => {
  const long = 'figures/' + 'a'.repeat(120) + '/plot.pdf';
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const archive = zlib.gzipSync(
    tar([
      ['main.tex', '\\documentclass{article}'],
      ['figs/beam.png', png],
      ['.hidden.png', 'x'],
      ['__MACOSX/figs/._beam.png', 'x'],
      [long, '%PDF-1.4 fake'],
      ['photo.jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ])
  );
  const { status, data } = await api('POST', '/api/figures', archive, { raw: true });
  assert.strictEqual(status, 200, JSON.stringify(data));
  assert.deepStrictEqual(
    data.figures.map((f) => [f.name, f.mime]),
    [
      ['figs/beam.png', 'image/png'],
      [long, 'application/pdf'],
      ['photo.jpeg', 'image/jpeg'],
    ]
  );
  assert.deepStrictEqual(Buffer.from(data.figures[0].data, 'base64'), png);
  // a paper whose source is one TeX file
  const tex = await api('POST', '/api/figures', zlib.gzipSync('\\documentclass{article}\\begin{document}x\\end{document}'), { raw: true });
  assert.strictEqual(tex.status, 400);
  assert.match(tex.data.error, /single TeX file/);
  assert.strictEqual((await api('POST', '/api/figures', Buffer.from('hello'), { raw: true })).status, 400);
});

test('posts from the submission (no AI)', async () => {
  const row = (await api('POST', '/api/parse-row', { text: SAMPLE })).data;
  row.publicAbstract = 'A sentence about muons. '.repeat(30);
  const { status, data } = await api('POST', '/api/posts', { row, mode: 'offline', thread: true });
  assert.strictEqual(status, 200);
  assert.ok([...data.twitter].length <= 280, data.twitter);
  assert.ok([...data.bluesky].length <= 300);
  assert.ok(data.twitter.endsWith(row.paperLink));
  assert.match(data.twitter, /^USMCC Featured Paper — A Better Way to Collide Muons/);
  assert.strictEqual(data.thread.length, 2);
  assert.match(data.linkedin, /C\. Anderson/);
  assert.match(data.markdown, /^---\ntitle: 'A Better Way to Collide Muons'\n/);
  assert.match(data.markdown, /externalUrl: 'https:\/\/arxiv\.org\/abs\/2401\.12345'/);
  assert.match(data.markdown, /date: '2024-01-10'/);
  const noThread = await api('POST', '/api/posts', { row, mode: 'offline', thread: false });
  assert.strictEqual(noThread.data.thread, null);
  assert.strictEqual((await api('POST', '/api/posts', { mode: 'offline' })).status, 400);
});

test('Claude needs a key (and there is no keychain without the app)', async () => {
  const row = (await api('POST', '/api/parse-row', { text: SAMPLE })).data;
  const r = await api('POST', '/api/posts', { row, mode: 'claude', model: 'claude-opus-5-5', thread: false });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /API key/);
  assert.deepStrictEqual((await api('GET', '/api/key')).data, { set: false, keychain: false });
  const set = await api('POST', '/api/key', { key: 'sk-ant-test' });
  assert.strictEqual(set.status, 400);
  assert.match(set.data.error, /ANTHROPIC_API_KEY/);
  assert.deepStrictEqual((await api('POST', '/api/key/test')).data, { ok: false, error: 'No API key' });
});

test('carousels and their files', async () => {
  const bytes = Buffer.from('fake png bytes');
  const asset = 'abcdef0123456789.png';
  assert.strictEqual((await api('PUT', '/api/asset/' + asset, bytes, { raw: true })).status, 200);
  assert.deepStrictEqual((await api('PUT', '/api/asset/' + asset, bytes, { raw: true })).data, { ok: true, size: bytes.length });
  const got = await api('GET', '/api/asset/' + asset);
  assert.strictEqual(got.type, 'image/png');
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.deepStrictEqual(got.data, bytes);
  assert.strictEqual((await api('PUT', '/api/asset/BAD.png', bytes, { raw: true })).status, 400);
  assert.strictEqual((await api('GET', '/api/asset/0000000000000000.png')).status, 404);

  const a = { name: 'First', updated: 1000, slides: [{ layers: [{ asset }] }, {}] };
  const b = { name: 'Second', updated: 2000, slides: [{}] };
  assert.strictEqual((await api('PUT', '/api/doc/c_a', a)).status, 200);
  assert.strictEqual((await api('PUT', '/api/doc/c_b', b)).status, 200);
  assert.strictEqual((await api('PUT', '/api/doc/c_bad', 'not an object')).status, 400);
  assert.strictEqual((await api('PUT', '/api/doc/..', a)).status, 404);
  assert.deepStrictEqual((await api('GET', '/api/doc/c_a')).data, a);
  assert.deepStrictEqual((await api('GET', '/api/docs')).data, [
    { id: 'c_b', name: 'Second', updated: 2000, count: 1 },
    { id: 'c_a', name: 'First', updated: 1000, count: 2 },
  ]);

  // deleting a carousel removes files nothing uses any more (older than 10 min)
  const assetFile = path.join(home, 'assets', asset);
  const orphan = path.join(home, 'assets', '9999999999999999.jpg');
  fs.writeFileSync(orphan, 'x');
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(assetFile, old, old);
  fs.utimesSync(orphan, old, old);
  await api('DELETE', '/api/doc/c_b');
  assert.ok(fs.existsSync(assetFile), 'still used by c_a');
  assert.ok(!fs.existsSync(orphan), 'unused');
  await api('DELETE', '/api/doc/c_a');
  assert.ok(!fs.existsSync(assetFile));
  assert.strictEqual((await api('GET', '/api/doc/c_a')).status, 404);
  assert.deepStrictEqual((await api('GET', '/api/docs')).data, []);
});

test('export writes slides into the export folder', async () => {
  const jpg = Buffer.alloc(5000, 7);
  const url = '/api/export?folder=' + encodeURIComponent('Muon carousel') + '&file=slide-01.jpg';
  const r = await api('POST', url, jpg, { raw: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const dest = path.join(exportDir, 'Muon carousel', 'slide-01.jpg');
  assert.deepStrictEqual(r.data, { skipped: false, path: dest });
  assert.deepStrictEqual(fs.readFileSync(dest), jpg);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(dest)), ['slide-01.jpg'], 'no .partial left behind');
  assert.deepStrictEqual((await api('POST', url, jpg, { raw: true })).data, { skipped: true, path: dest });
  // a changed slide replaces the old one
  const r2 = await api('POST', url, Buffer.alloc(6000, 1), { raw: true });
  assert.strictEqual(r2.data.skipped, false);
  assert.strictEqual(fs.statSync(dest).size, 6000);
  for (const bad of ['../x', 'a/b', '', '.hidden', 'x'.repeat(121)]) {
    const q = '/api/export?folder=' + encodeURIComponent(bad) + '&file=a.jpg';
    assert.strictEqual((await api('POST', q, jpg, { raw: true })).status, 400, bad);
  }
  // reveal only inside the export folder
  assert.strictEqual((await api('POST', '/api/reveal', { path: '/etc/passwd' })).status, 400);
  assert.strictEqual((await api('POST', '/api/open', { url: 'file:///etc/passwd' })).status, 400);
  assert.strictEqual((await api('POST', '/api/choose-export-dir')).data.dir, null);
});
