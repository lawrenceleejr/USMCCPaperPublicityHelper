/* USMCC Publicity Helper Lite: the web version.

   On the desktop a small Rust program answers the page's /api requests.
   Here there is no program, so this script answers the same requests in the
   browser and app.js works unchanged:

   - carousels, pictures and settings are kept on this device (IndexedDB),
   - reading a sheet row, arXiv links, a paper's source (.tar.gz) and drafting
     the posts use the desktop app's own Rust code (src-tauri/src/paper.rs)
     compiled to WebAssembly (lite/wasm),
   - arXiv PDFs and sources are fetched straight from arxiv.org,
   - exports go to the share sheet on phones and tablets (Save to Photos),
     a folder (Chrome, Edge) or Downloads.

   Nothing is uploaded anywhere. Writing the posts with Claude needs an API
   key kept safely, so that stays in the desktop app. */

(function () {
  'use strict';
  const LITE = (window.UsmccLite = {});
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;

  /* ---------------------------------------------------------- the Rust code (WebAssembly) */

  let wasm = null;
  const wasmReady = (async () => {
    const r = await fetch(document.querySelector('meta[name="usmcc-wasm"]')?.content || 'usmcc.wasm');
    wasm = (await WebAssembly.instantiate(await r.arrayBuffer(), {})).instance.exports;
  })();
  function call(fn, bytes) {
    const p = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
    try {
      const res = BigInt.asUintN(64, wasm[fn](p, bytes.length));
      const op = Number(res >> 32n);
      const n = Number(res & 0xffffffffn);
      const out = new Uint8Array(wasm.memory.buffer, op, n).slice();
      wasm.dealloc(op, n);
      return JSON.parse(new TextDecoder().decode(out));
    } finally {
      wasm.dealloc(p, bytes.length);
    }
  }
  const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ---------------------------------------------------------- storage (IndexedDB) */

  let dbp = null;
  function db() {
    if (!dbp)
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('usmcc-lite', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('docs');
          r.result.createObjectStore('assets');
          r.result.createObjectStore('kv');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('storage is full'));
    });
  }
  const get = (s, k) => tx(s, 'readonly', (o) => o.get(k));
  const put = (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k));
  const del = (s, k) => tx(s, 'readwrite', (o) => o.delete(k));
  const all = (s) => tx(s, 'readonly', (o) => o.getAll());
  const keys = (s) => tx(s, 'readonly', (o) => o.getAllKeys());
  // ask the browser not to clear what is kept here
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------------------------------------------------------- the API */

  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const fail = (status, error) => json({ error }, status);
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const ASSET = /^[a-z0-9]{8,64}(\.[a-z0-9]{1,5})?$/;
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf' };

  async function bodyBytes(init) {
    const b = init.body;
    if (!b) return new Uint8Array();
    if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer());
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return new TextEncoder().encode(String(b));
  }
  const bodyJson = async (init) => JSON.parse(new TextDecoder().decode(await bodyBytes(init)) || '{}');

  async function arxiv(url) {
    await wasmReady;
    return call('arxiv', enc(url || ''));
  }
  // The last source download, so reading a paper's details and then its
  // figures fetches the tarball once.
  let lastSrc = null;
  async function fetchArxiv(url, kind) {
    const a = await arxiv(url);
    if (a.error) return { error: a.error, status: 400 };
    if (kind === 'src' && lastSrc && lastSrc.id === a.id) return { bytes: lastSrc.bytes, a };
    try {
      const r = await realFetch(kind === 'pdf' ? a.pdf : a.src);
      if (!r.ok) return { error: `arXiv answered ${r.status} for ${a.id}`, status: 502 };
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (kind === 'src') lastSrc = { id: a.id, bytes };
      return { bytes, a };
    } catch (e) {
      return { error: `Could not reach arXiv (${e.message}). Download the ${kind === 'pdf' ? 'PDF' : 'source'} and add it here instead.`, status: 502 };
    }
  }
  // 2611.21813 → 2026-11 (old ids: hep-ph/0601001 → 2006-01)
  function idDate(id) {
    const m = /(?:^|\/)(\d{2})(\d{2})[.\d]/.exec(id || '');
    if (!m) return '';
    const y = +m[1];
    return `${y < 91 ? 2000 + y : 1900 + y}-${m[2]}`;
  }

  async function handle(url, init) {
    const u = new URL(url, location.href);
    const p = u.pathname.replace(/^.*?\/api\//, '/api/');
    const m = (init.method || 'GET').toUpperCase();
    const q = (k) => u.searchParams.get(k);
    try {
      if (p === '/api/info') return json({ shell: 'lite', version: LITE.version || '', keychain: false, hasKey: false, exportDir: null, canChooseDir: false });
      if (p === '/api/settings') {
        if (m === 'PUT') {
          await put('kv', 'settings', await bodyJson(init));
          return json({ ok: true });
        }
        return json((await get('kv', 'settings')) || {});
      }
      if (p === '/api/docs') {
        const docs = await all('docs');
        return json(docs.map((d) => ({ id: d.id, name: d.name, updated: d.updated || 0, count: (d.slides || []).length })).sort((a, b) => b.updated - a.updated));
      }
      let mm = p.match(/^\/api\/doc\/(.+)$/);
      if (mm) {
        const id = decodeURIComponent(mm[1]);
        if (!ID.test(id)) return fail(400, 'bad id');
        if (m === 'PUT') {
          await put('docs', id, await bodyJson(init));
          return json({ ok: true });
        }
        if (m === 'DELETE') {
          await del('docs', id);
          await gc();
          return json({ ok: true });
        }
        const d = await get('docs', id);
        return d ? json(d) : fail(404, 'no such carousel');
      }
      mm = p.match(/^\/api\/asset\/(.+)$/);
      if (mm) {
        const id = decodeURIComponent(mm[1]);
        if (!ASSET.test(id)) return fail(400, 'bad asset id');
        if (m === 'PUT') {
          const have = await get('assets', id);
          const blob = init.body instanceof Blob ? init.body : new Blob([await bodyBytes(init)]);
          if (!have) await put('assets', id, { blob: new Blob([blob], { type: MIME[id.split('.').pop()] || blob.type }), at: Date.now() });
          return json({ ok: true, size: blob.size });
        }
        const a = await get('assets', id);
        return a ? new Response(a.blob, { headers: { 'Content-Type': a.blob.type || 'application/octet-stream' } }) : fail(404, 'no such picture');
      }
      if (p === '/api/parse-row') {
        await wasmReady;
        const r = call('parse_row', enc((await bodyJson(init)).text || ''));
        return r.error ? fail(400, r.error) : json(r);
      }
      if (p === '/api/arxiv') {
        const a = await arxiv(q('url'));
        return a.error ? fail(400, a.error) : json(a);
      }
      if (p === '/api/arxiv/meta') {
        // arXiv's API doesn't answer other sites' pages (no CORS), but its
        // source download does: read the title, authors and abstract from the
        // paper's own TeX (the figures sheet reuses the same download)
        const r = await fetchArxiv(q('url'), 'src');
        if (r.error) return fail(r.status, r.error);
        const row = call('archive_meta', r.bytes);
        if (row.error) return fail(404, row.error);
        row.paperLink = r.a.abs;
        if (!row.publicationDate) row.publicationDate = idDate(r.a.id);
        return json(row);
      }
      if (p === '/api/arxiv/pdf') {
        const r = await fetchArxiv(q('url'), 'pdf');
        return r.error ? fail(r.status, r.error) : new Response(r.bytes, { headers: { 'Content-Type': 'application/pdf' } });
      }
      if (p === '/api/arxiv/figures' || p === '/api/figures') {
        let bytes;
        if (p === '/api/figures') bytes = await bodyBytes(init);
        else {
          const r = await fetchArxiv(q('url'), 'src');
          if (r.error) return fail(r.status, r.error);
          bytes = r.bytes;
        }
        await wasmReady;
        const r = call('figures', bytes);
        return r.error ? fail(400, r.error) : json(r);
      }
      if (p === '/api/posts') {
        const b = await bodyJson(init);
        if (b.mode === 'claude') return fail(400, 'Writing the posts with Claude is in the desktop app.');
        await wasmReady;
        const r = call('posts', enc({ row: b.row, thread: !!b.thread, today: today() }));
        return r.error ? fail(400, r.error) : json(r);
      }
      if (p === '/api/key') return json({ set: false, keychain: false });
      if (p === '/api/open') {
        const { url: to } = await bodyJson(init);
        if (/^https?:\/\//.test(to)) window.open(to, '_blank', 'noopener');
        return json({ ok: true });
      }
      if (p === '/api/window' || p === '/api/reveal') return json({ ok: true });
      if (p === '/api/export' || p === '/api/choose-export-dir') return fail(400, 'In Lite, exports go through the share sheet or your browser.');
      return fail(404, 'not in Lite');
    } catch (e) {
      return fail(500, e.message || String(e));
    }
  }

  // Pictures no carousel uses any more (older than ten minutes, so one just
  // added to an unsaved carousel stays).
  async function gc() {
    const docs = JSON.stringify(await all('docs'));
    const now = Date.now();
    for (const k of await keys('assets')) {
      if (docs.includes(k)) continue;
      const a = await get('assets', k);
      if (a && now - (a.at || 0) > 600_000) await del('assets', k);
    }
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && /^\/api\//.test(url)) return handle(url, init || {});
    return realFetch(input, init);
  };

  /* ---------------------------------------------------------- exports */

  const canShareFiles = () => {
    try {
      return touch && !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
    } catch {
      return false;
    }
  };
  LITE.mode = canShareFiles() ? 'share' : 'showDirectoryPicker' in window ? 'folder' : 'download';
  let folder = null;

  LITE.destLabel = (fmt) => {
    if (LITE.mode === 'share') return fmt === 'pdf' ? 'The share sheet: Save to Files, or straight to LinkedIn' : 'The share sheet: Save Images puts them in Photos';
    if (LITE.mode === 'folder') return folder ? `The folder “${folder.name}”` : 'A folder you choose';
    return 'Your Downloads folder';
  };

  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  // Deliver exported files. On phones the share sheet needs a fresh tap, so
  // a button is offered (Enter works too); resolves with what happened.
  LITE.deliver = async function (files, resultEl) {
    if (LITE.mode === 'folder') {
      try {
        folder = folder || (await window.showDirectoryPicker({ id: 'usmcc-export', mode: 'readwrite' }));
        for (const f of files) {
          const h = await folder.getFileHandle(f.name, { create: true });
          const w = await h.createWritable();
          await w.write(f);
          await w.close();
        }
        return `Saved ${files.length} file${files.length === 1 ? '' : 's'} to “${folder.name}”.`;
      } catch (e) {
        if (e && e.name === 'AbortError') return 'No folder chosen.';
        LITE.mode = 'download';
      }
    }
    if (LITE.mode === 'download' || !resultEl) {
      for (const f of files) {
        download(f);
        await new Promise((r) => setTimeout(r, 250)); // browsers drop downloads fired all at once
      }
      return `Saved ${files.length} file${files.length === 1 ? '' : 's'} to Downloads.`;
    }
    return new Promise((resolve) => {
      resultEl.replaceChildren();
      const n = files.length;
      const images = files.every((f) => f.type.startsWith('image/'));
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = images ? `Save ${n} image${n === 1 ? '' : 's'}…` : 'Share the PDF…';
      b.onclick = async () => {
        try {
          await navigator.share({ files });
          LITE.pendingShare = null;
          resolve(images ? 'Done. In Photos they are in order, ready to post as a carousel.' : 'Done.');
        } catch (e) {
          if (e && e.name === 'AbortError') return; // closed the sheet: tap again
          LITE.pendingShare = null;
          resolve('Could not share: ' + e.message);
        }
      };
      const tip = document.createElement('span');
      tip.className = 'muted';
      tip.textContent = images ? '  then Save Images' : '  then Save to Files or pick an app';
      resultEl.append(b, tip);
      LITE.pendingShare = b;
      b.focus();
    });
  };

  document.documentElement.classList.add('lite');
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('lite'));
})();
