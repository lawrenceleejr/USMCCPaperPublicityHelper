/* USMCC Publicity Helper: the carousel editor.

   The page talks to /api: on the desktop the Rust program answers (files in
   ~/.usmcc, exports to a folder, Claude with the key in the keychain); in
   Lite (the web version) web/lite.js answers the same requests in the
   browser. Sheets (paper, posts, export, theme, carousels, menu) live in
   sheets.js; drawing in render.js. */

'use strict';

const LITE = window.UsmccLite || null;
const R = window.Render;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

async function api(method, url, body, raw) {
  const r = await fetch(url, {
    method,
    headers: { 'X-USMCC': '1', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new Error((data && data.error) || `${r.status} ${r.statusText}`);
  return data;
}

/* ------------------------------------------------------------------ state */

const S = {
  info: {},
  settings: {},
  doc: null,
  cur: 0, // slide index
  sel: null, // selected layer id
  crop: false, // crop mode for the selected image
  guides: false,
  base: '', // the doc as last committed (for undo)
  undo: [],
  redo: [],
  lastLabel: '',
  lastAt: 0,
  view: { scale: 1, dpr: 1 },
};
window.S = S;

const slide = () => S.doc.slides[S.cur];
const size = () => R.sizeOf(S.doc);
const theme = () => R.themeOf(S.doc);
const selLayer = () => (S.sel && slide() ? slide().layers.find((l) => l.id === S.sel) : null) || null;

function newDoc(name) {
  return { v: 1, id: uid(), name: name || 'Untitled carousel', updated: Date.now(), size: 'portrait', theme: 'editorial', paper: null, posts: null, slides: [blankSlide()] };
}
function blankSlide() {
  return { id: uid(), bg: null, layers: [] };
}

/* ------------------------------------------------------------------ changes, undo, saving */

// Text placed by "Make slides" flows: each block carries `flow: {g, gap}`
// (the logo `flow: {g, logo: true}`) and the group is stacked the way the
// theme places text (from the bottom, the top or the middle, logo in the
// opposite corner) whenever the theme, the size or the words change. Moving
// one of them by hand fixes the group where it is.
function reflow(s, t = theme(), sz = size()) {
  const { w: W, h: H } = sz;
  const groups = new Map();
  for (const l of s.layers) if (l.flow) (groups.get(l.flow.g) || groups.set(l.flow.g, []).get(l.flow.g)).push(l);
  for (const ls of groups.values()) {
    const texts = ls.filter((l) => l.kind === 'text');
    const logo = ls.find((l) => l.kind === 'logo');
    let total = 0;
    texts.forEach((l, i) => (total += R.bounds(l, t, W, H).h + (i ? l.flow.gap || 0 : 0)));
    const lh = logo ? logo.h : 0;
    let y = t.valign === 'top' ? R.SAFE : t.valign === 'middle' ? (H - total) / 2 + lh / 3 : H - R.SAFE - total;
    texts.forEach((l, i) => {
      if (i) y += l.flow.gap || 0;
      l.x = R.SAFE;
      l.w = W - 2 * R.SAFE;
      l.y = Math.round(y);
      y += R.bounds(l, t, W, H).h;
    });
    if (logo) {
      const lw = logo.h * R.LOGO_RATIO;
      const pos = t.valign === 'top' ? [W - R.SAFE - lw, H - R.SAFE - logo.h] : t.valign === 'middle' ? [(W - lw) / 2, R.SAFE] : t.align === 'right' ? [R.SAFE, R.SAFE] : [W - R.SAFE - lw, R.SAFE];
      logo.x = Math.round(pos[0]);
      logo.y = Math.round(pos[1]);
      delete logo.variant;
    }
  }
}
const MOVES = new Set(['move', 'resize', 'rotate', 'pinch', 'nudge', 'scale', 'logo corner']);

// Record a change made to S.doc. Changes with the same label within a
// second (typing, slider drags) fold into one undo step.
function changed(label = '', opts = {}) {
  const now = Date.now();
  const moved = selLayer();
  if (moved && moved.flow && MOVES.has(label)) for (const l of slide().layers) if (l.flow && l.flow.g === moved.flow.g) delete l.flow;
  for (const s of opts.all ? S.doc.slides : [slide()]) if (s) reflow(s);
  const fold = label && label === S.lastLabel && now - S.lastAt < 1000;
  if (!fold) {
    S.undo.push(S.base);
    if (S.undo.length > 150) S.undo.shift();
  }
  S.redo = [];
  S.base = JSON.stringify(S.doc);
  S.lastLabel = label;
  S.lastAt = now;
  dirtyThumbs(opts.all ? null : [slide() && slide().id, ...(opts.slides || [])]);
  scheduleSave();
  if (!opts.quiet) refresh();
  else requestRender();
}

function restore(json) {
  const keepSlide = slide() && slide().id;
  S.doc = JSON.parse(json);
  S.base = json;
  const i = S.doc.slides.findIndex((s) => s.id === keepSlide);
  S.cur = clamp(i >= 0 ? i : S.cur, 0, S.doc.slides.length - 1);
  if (!selLayer()) S.sel = null;
  S.lastLabel = '';
  dirtyThumbs(null);
  scheduleSave();
  refresh();
}
function undo() {
  if (!S.undo.length) return toast('Nothing to undo');
  S.redo.push(S.base);
  restore(S.undo.pop());
}
function redo() {
  if (!S.redo.length) return toast('Nothing to redo');
  S.undo.push(S.base);
  restore(S.redo.pop());
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.doc) return;
  S.doc.updated = Date.now();
  try {
    await api('PUT', `/api/doc/${S.doc.id}`, S.doc);
    if (S.settings.lastDoc !== S.doc.id) saveSettings({ lastDoc: S.doc.id });
  } catch (e) {
    toast('Could not save: ' + e.message, 4000);
  }
}
window.addEventListener('pagehide', () => S.doc && saveNow());
document.addEventListener('visibilitychange', () => document.hidden && S.doc && saveNow());

async function saveSettings(patch) {
  Object.assign(S.settings, patch);
  try {
    await api('PUT', '/api/settings', S.settings);
  } catch {}
}

function openDoc(doc) {
  S.doc = doc;
  if (!doc.slides || !doc.slides.length) doc.slides = [blankSlide()];
  S.base = JSON.stringify(doc);
  S.undo = [];
  S.redo = [];
  S.cur = 0;
  S.sel = null;
  S.crop = false;
  dirtyThumbs(null);
  buildStrip();
  refresh();
  for (const s of doc.slides) for (const l of s.layers) if (l.kind === 'image') R.ensure(l.asset, loadAsset).catch(() => {});
}

/* ------------------------------------------------------------------ assets */

const blobs = new Map();
async function loadAsset(id) {
  if (blobs.has(id)) return blobs.get(id);
  const b = await api('GET', `/api/asset/${id}`);
  blobs.set(id, b);
  return b;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };

// Store a picture: big photos are brought down to 3240 px on the long edge
// (three times the slide width), named by a hash of their bytes.
async function storeAsset(blob) {
  let b = blob;
  if (/^image\/(jpeg|png|webp|heic|heif)/.test(blob.type) || !blob.type) {
    try {
      const bmp = await createImageBitmap(blob);
      const big = Math.max(bmp.width, bmp.height);
      if (big > 3240 || !EXT[blob.type]) {
        const k = Math.min(1, 3240 / big);
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const png = blob.type === 'image/png';
        b = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92));
        c.width = c.height = 0;
      }
      bmp.close && bmp.close();
    } catch {}
  }
  const bytes = new Uint8Array(await b.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const id = [...hash.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('') + '.' + (EXT[b.type] || 'jpg');
  const typed = new Blob([bytes], { type: b.type || 'image/jpeg' });
  blobs.set(id, typed);
  await api('PUT', `/api/asset/${id}`, typed, true);
  await R.ensure(id, loadAsset);
  return id;
}

/* ------------------------------------------------------------------ the stage */

const stage = $('#stage');
const sctx = stage.getContext('2d');
const wrap = $('#stage-wrap');
const overlay = $('#overlay');
const selbox = $('#selbox');

function fitStage() {
  const { w: W, h: H } = size();
  const r = wrap.getBoundingClientRect();
  const pad = TOUCH ? 14 : 28;
  const scale = Math.max(0.05, Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  if (stage.width !== Math.round(cw * dpr) || stage.height !== Math.round(ch * dpr)) {
    stage.width = Math.round(cw * dpr);
    stage.height = Math.round(ch * dpr);
  }
  stage.style.width = cw + 'px';
  stage.style.height = ch + 'px';
  S.view = { scale: cw / W, dpr };
}

let frame = 0;
function requestRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderNow();
  });
}
function renderNow() {
  if (!S.doc) return;
  fitStage();
  R.drawSlide(sctx, S.doc, slide(), S.view.scale * S.view.dpr);
  drawOverlay();
  const empty = S.doc.slides.length === 1 && !slide().layers.length;
  $('#empty-hint').hidden = !empty;
}
new ResizeObserver(() => requestRender()).observe(wrap);
R.onReady = () => {
  requestRender();
  dirtyThumbs(null);
};

// Slide coordinates of a pointer event.
function slidePoint(e) {
  const r = stage.getBoundingClientRect();
  return [(e.clientX - r.left) / S.view.scale, (e.clientY - r.top) / S.view.scale];
}

let snapLines = [];
function drawOverlay() {
  const r = stage.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  Object.assign(overlay.style, { left: r.left - wr.left + 'px', top: r.top - wr.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const k = S.view.scale;
  const g = $('#guides');
  g.replaceChildren();
  const { w: W, h: H } = size();
  if (S.guides) {
    const safe = el('i', 'safe');
    Object.assign(safe.style, { left: R.SAFE * k + 'px', top: R.SAFE * k + 'px', width: (W - 2 * R.SAFE) * k + 'px', height: (H - 2 * R.SAFE) * k + 'px' });
    const v = el('i', 'v mid');
    v.style.left = (W / 2) * k + 'px';
    const h = el('i', 'h mid');
    h.style.top = (H / 2) * k + 'px';
    g.append(safe, v, h);
  }
  for (const [dir, at] of snapLines) {
    const line = el('i', dir);
    if (dir === 'v') line.style.left = at * k + 'px';
    else line.style.top = at * k + 'px';
    g.append(line);
  }
  const l = selLayer();
  if (!l) {
    selbox.hidden = true;
    $('#crop-tip').hidden = true;
    return;
  }
  const b = R.bounds(l, theme(), W, H);
  selbox.hidden = false;
  selbox.className = `k-${l.kind}${S.crop && l.kind === 'image' ? ' crop' : ''}`;
  Object.assign(selbox.style, {
    left: b.x * k + 'px',
    top: b.y * k + 'px',
    width: b.w * k + 'px',
    height: b.h * k + 'px',
    transform: l.rot ? `rotate(${l.rot}deg)` : '',
  });
  const tip = $('#crop-tip');
  tip.hidden = !(S.crop && l.kind === 'image');
  tip.textContent = TOUCH ? 'Drag to move the picture, pinch to zoom · tap Done' : 'Drag to move the picture, scroll to zoom · C or Esc when done';
}

/* ------------------------------------------------------------------ gestures */

const pointers = new Map(); // pointerId -> {x, y}
let gest = null;
let lastTap = { t: 0, id: null };

function spanSiblings(l) {
  if (!l.span) return [];
  const out = [];
  S.doc.slides.forEach((s, i) => {
    if (i === S.cur) return;
    for (const m of s.layers) if (m.span === l.span) out.push({ layer: m, offset: (i - S.cur) * size().w });
  });
  return out;
}
function syncSpan(l) {
  for (const { layer: m, offset } of spanSiblings(l)) {
    Object.assign(m, { ...l, id: m.id, x: l.x - offset });
  }
}

wrap.addEventListener('pointerdown', (e) => {
  if (e.button && e.button !== 0) return;
  wrap.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const l = selLayer();
  if (pointers.size === 2 && gest && l) {
    // a second finger: pinch to scale and turn (or zoom the picture in crop mode)
    const [a, b] = [...pointers.values()];
    gest = {
      type: S.crop && l.kind === 'image' ? 'pinch-crop' : 'pinch',
      d0: Math.hypot(b.x - a.x, b.y - a.y),
      a0: Math.atan2(b.y - a.y, b.x - a.x),
      start: JSON.parse(JSON.stringify(l)),
      moved: true,
    };
    return;
  }
  if (pointers.size > 1) return;
  const [x, y] = slidePoint(e);
  const handle = e.target.closest && e.target.closest('#selbox .h');
  if (handle && l) {
    gest = { type: handle.dataset.h === 'rot' ? 'rotate' : 'resize', h: handle.dataset.h, x0: x, y0: y, start: JSON.parse(JSON.stringify(l)), moved: false };
    e.preventDefault();
    return;
  }
  if (S.crop && l && l.kind === 'image') {
    gest = { type: 'pan', x0: x, y0: y, start: { px: l.px ?? 0.5, py: l.py ?? 0.5 }, moved: false };
    return;
  }
  const hit = R.layerAt(S.doc, slide(), x, y);
  if (hit) {
    if (hit.id !== S.sel) {
      S.sel = hit.id;
      S.crop = false;
      refresh();
    }
    gest = { type: 'move', x0: x, y0: y, start: { x: hit.x, y: hit.y }, moved: false, id: hit.id };
  } else {
    gest = { type: 'empty', x0: x, y0: y, cx: e.clientX, moved: false };
  }
});

wrap.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gest) return;
  const l = selLayer();
  const [x, y] = slidePoint(e);
  const { w: W, h: H } = size();
  const tol = 3 / S.view.scale;
  if (!gest.moved && gest.x0 !== undefined && Math.hypot(x - gest.x0, y - gest.y0) < tol * 2) return;
  gest.moved = true;
  if (gest.type === 'move' && l) {
    let nx = gest.start.x + (x - gest.x0);
    let ny = gest.start.y + (y - gest.y0);
    [nx, ny] = snap(l, nx, ny, e.altKey);
    l.x = Math.round(nx);
    l.y = Math.round(ny);
    syncSpan(l);
    requestRender();
  } else if (gest.type === 'pan' && l) {
    const pic = R.picture(l) || R.ready(l.asset);
    if (!pic) return;
    const p = R.placement(l, pic.w, pic.h);
    l.px = clamp(gest.start.px - (x - gest.x0) / p.w, 0, 1);
    l.py = clamp(gest.start.py - (y - gest.y0) / p.h, 0, 1);
    clampPan(l);
    syncSpan(l);
    requestRender();
  } else if (gest.type === 'resize' && l) {
    resize(l, gest, x, y, e.shiftKey);
    syncSpan(l);
    requestRender();
  } else if (gest.type === 'rotate' && l) {
    const b = R.bounds(gest.start, theme(), W, H);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
    a = e.shiftKey ? Math.round(a / 15) * 15 : a;
    for (const t of [-180, -90, 0, 90, 180]) if (Math.abs(a - t) < 4) a = t;
    l.rot = Math.round(((a + 540) % 360) - 180);
    if (l.rot === -180) l.rot = 180;
    requestRender();
  } else if ((gest.type === 'pinch' || gest.type === 'pinch-crop') && l && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const f = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, gest.d0);
    const turn = ((Math.atan2(b.y - a.y, b.x - a.x) - gest.a0) * 180) / Math.PI;
    if (gest.type === 'pinch-crop') {
      l.zoom = clamp((gest.start.zoom || 1) * f, l.fit === 'contain' ? 0.2 : 1, 8);
      clampPan(l);
    } else {
      scaleLayer(l, gest.start, f);
      if (Math.abs(turn) > 6 || gest.start.rot) l.rot = Math.round((gest.start.rot || 0) + turn);
    }
    syncSpan(l);
    requestRender();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size) return;
  const g = gest;
  gest = null;
  snapLines = [];
  if (!g) return;
  if (g.moved && g.type !== 'empty') {
    changed(g.type, { slides: spanSlideIds(selLayer()) });
    return;
  }
  if (g.type === 'empty') {
    // a swipe across an empty part of the slide flips slides (touch)
    const dx = e.clientX - g.cx;
    if (TOUCH && Math.abs(dx) > 50) return go(S.cur + (dx < 0 ? 1 : -1));
    if (S.sel || S.crop) {
      S.sel = null;
      S.crop = false;
      refresh();
    }
    return;
  }
  // a tap: double-tap edits text or crops a picture
  const now = Date.now();
  const l = selLayer();
  if (l && lastTap.id === l.id && now - lastTap.t < 350) {
    lastTap = { t: 0, id: null };
    if (l.kind === 'text') editText();
    else if (l.kind === 'image') toggleCrop();
    return;
  }
  lastTap = { t: now, id: l && l.id };
  drawOverlay();
}
wrap.addEventListener('pointerup', endPointer);
wrap.addEventListener('pointercancel', endPointer);
wrap.addEventListener('lostpointercapture', endPointer);

wrap.addEventListener(
  'wheel',
  (e) => {
    const l = selLayer();
    if (!l) return;
    if (S.crop && l.kind === 'image') {
      e.preventDefault();
      l.zoom = clamp((l.zoom || 1) * Math.exp(-e.deltaY * 0.0025), l.fit === 'contain' ? 0.2 : 1, 8);
      clampPan(l);
      syncSpan(l);
      requestRender();
      changed('zoom', { quiet: true });
    } else if (e.ctrlKey) {
      // a trackpad pinch
      e.preventDefault();
      scaleLayer(l, JSON.parse(JSON.stringify(l)), Math.exp(-e.deltaY * 0.01));
      syncSpan(l);
      requestRender();
      changed('scale', { quiet: true });
    }
  },
  { passive: false }
);

const spanSlideIds = (l) => (l && l.span ? S.doc.slides.filter((s) => s.layers.some((m) => m.span === l.span)).map((s) => s.id) : []);

// Keep a covering picture from showing a gap after zooming out.
function clampPan(l) {
  const pic = R.ready(l.asset);
  if (!pic) return;
  const turns = ((l.turn || 0) % 4 + 4) % 4;
  const pw = turns % 2 ? pic.h : pic.w;
  const ph = turns % 2 ? pic.w : pic.h;
  const p = R.placement(l, pw, ph);
  if (p.w > l.w) l.px = clamp(l.px ?? 0.5, l.w / 2 / p.w, 1 - l.w / 2 / p.w);
  if (p.h > l.h) l.py = clamp(l.py ?? 0.5, l.h / 2 / p.h, 1 - l.h / 2 / p.h);
}

// Snap a moving layer's edges and centre to the slide's centre lines, its
// edges and the safe margin. Alt turns snapping off.
function snap(l, nx, ny, off) {
  snapLines = [];
  if (off) return [nx, ny];
  const { w: W, h: H } = size();
  const b = R.bounds(l, theme(), W, H);
  const tol = 7 / S.view.scale;
  const xs = [0, R.SAFE, W / 2, W - R.SAFE, W];
  const ys = [0, R.SAFE, H / 2, H - R.SAFE, H];
  let bx = null;
  let by = null;
  for (const [off2, list, axis] of [
    [[0, b.w / 2, b.w], xs, 'x'],
    [[0, b.h / 2, b.h], ys, 'y'],
  ]) {
    let best = null;
    for (const o of off2)
      for (const t of list) {
        const v = (axis === 'x' ? nx : ny) + o;
        const d = Math.abs(v - t);
        if (d < tol && (!best || d < best.d)) best = { d, at: t, o };
      }
    if (best) {
      if (axis === 'x') bx = best;
      else by = best;
    }
  }
  if (bx) {
    nx = bx.at - bx.o;
    snapLines.push(['v', bx.at]);
  }
  if (by) {
    ny = by.at - by.o;
    snapLines.push(['h', by.at]);
  }
  return [nx, ny];
}

// Scale a layer about its centre by f (from its state at gesture start).
function scaleLayer(l, s, f) {
  const { w: W, h: H } = size();
  const b = R.bounds(s, theme(), W, H);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (l.kind === 'image') {
    l.w = Math.max(40, Math.round(s.w * f));
    l.h = Math.max(40, Math.round(s.h * f));
    l.x = Math.round(cx - l.w / 2);
    l.y = Math.round(cy - l.h / 2);
  } else if (l.kind === 'text') {
    const st = R.textStyle(s, theme());
    l.size = clamp(Math.round(st.size * f), 10, 400);
    l.w = Math.max(60, Math.round(s.w * f));
    l.x = Math.round(cx - l.w / 2);
    const nb = R.bounds(l, theme(), W, H);
    l.y = Math.round(cy - nb.h / 2);
  } else if (l.kind === 'logo') {
    l.h = clamp(Math.round(s.h * f), 30, 1200);
    l.x = Math.round(cx - (l.h * R.LOGO_RATIO) / 2);
    l.y = Math.round(cy - l.h / 2);
  }
}

// Drag a handle. Corners keep the proportions (Shift frees them for
// pictures); edges change one side (a picture's frame crops it).
function resize(l, g, x, y, free) {
  const s = g.start;
  const { w: W, h: H } = size();
  const b = R.bounds(s, theme(), W, H);
  // work in the layer's unrotated frame
  const [lx, ly] = R.toLocal(s, b, x, y);
  const [ox, oy] = R.toLocal(s, b, g.x0, g.y0);
  const dx = lx - ox;
  const dy = ly - oy;
  const h = g.h;
  let nx = b.x;
  let ny = b.y;
  let nw = b.w;
  let nh = b.h;
  if (h.includes('e')) nw = b.w + dx;
  if (h.includes('w')) {
    nw = b.w - dx;
    nx = b.x + dx;
  }
  if (h.includes('s')) nh = b.h + dy;
  if (h.includes('n')) {
    nh = b.h - dy;
    ny = b.y + dy;
  }
  const corner = h.length === 2;
  if (corner && (l.kind !== 'image' || !free)) {
    const f = Math.max(nw / b.w, nh / b.h, 0.05);
    nw = b.w * f;
    nh = b.h * f;
    if (h.includes('w')) nx = b.x + b.w - nw;
    if (h.includes('n')) ny = b.y + b.h - nh;
  }
  nw = Math.max(30, nw);
  nh = Math.max(30, nh);
  if (l.kind === 'image') {
    Object.assign(l, { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
    clampPan(l);
  } else if (l.kind === 'text') {
    if (corner) {
      const f = nw / b.w;
      l.size = clamp(Math.round(R.textStyle(s, theme()).size * f), 10, 400);
    }
    Object.assign(l, { x: Math.round(nx), w: Math.round(nw) });
    if (h.includes('n')) l.y = Math.round(b.y + b.h - R.bounds(l, theme(), W, H).h);
  } else if (l.kind === 'logo') {
    Object.assign(l, { x: Math.round(nx), y: Math.round(ny), h: Math.round(nh) });
  }
}

/* ------------------------------------------------------------------ slides */

function go(i) {
  if (!S.doc) return;
  const n = clamp(i, 0, S.doc.slides.length - 1);
  if (n === S.cur) return;
  S.cur = n;
  S.sel = null;
  S.crop = false;
  refresh();
  const t = $$('.thumb')[n];
  if (t) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function addSlide(after = S.cur, s = blankSlide()) {
  S.doc.slides.splice(after + 1, 0, s);
  S.cur = after + 1;
  S.sel = null;
  buildStrip();
  changed('add slide');
  return s;
}
function duplicateSlide() {
  const s = JSON.parse(JSON.stringify(slide()));
  s.id = uid();
  for (const l of s.layers) {
    l.id = uid();
    delete l.span;
  }
  addSlide(S.cur, s);
  toast('Slide duplicated');
}
function deleteSlide() {
  if (S.doc.slides.length === 1) {
    S.doc.slides[0] = blankSlide();
  } else S.doc.slides.splice(S.cur, 1);
  S.cur = clamp(S.cur, 0, S.doc.slides.length - 1);
  S.sel = null;
  buildStrip();
  changed('delete slide');
  toast(`Slide deleted · ${MAC ? '⌘' : 'Ctrl+'}Z to undo`);
}
function moveSlide(d) {
  const j = S.cur + d;
  if (j < 0 || j >= S.doc.slides.length) return;
  const [s] = S.doc.slides.splice(S.cur, 1);
  S.doc.slides.splice(j, 0, s);
  S.cur = j;
  buildStrip();
  changed('move slide', { all: true });
}

/* ------------------------------------------------------------------ layers */

function addLayer(l, { below } = {}) {
  l.id = l.id || uid();
  if (below) slide().layers.unshift(l);
  else slide().layers.push(l);
  S.sel = l.kind === 'shade' ? null : l.id;
  S.crop = false;
  changed('add ' + l.kind);
  return l;
}

function addText(role = 'body', text) {
  const { w: W, h: H } = size();
  const t = theme();
  const defaults = { eyebrow: 'USMCC Featured Paper', title: 'A headline', body: 'Say what the work found, in a sentence or two.', caption: 'Authors · arXiv:0000.00000' };
  const l = { kind: 'text', role, text: text ?? defaults[role], x: R.SAFE, w: W - 2 * R.SAFE, y: 0 };
  const h = R.bounds(l, t, W, H).h;
  l.y = Math.round((H - h) / 2);
  addLayer(l);
  if (text === undefined) editText(true);
  return l;
}

function addLogo() {
  const { w: W } = size();
  const h = 150;
  addLayer({ kind: 'logo', h, x: Math.round(W - R.SAFE - h * R.LOGO_RATIO), y: R.SAFE });
}

function ensureShade() {
  if (slide().layers.some((l) => l.kind === 'shade')) return toast('This slide already has the theme light');
  // above the pictures, below the words
  const i = slide().layers.findIndex((l) => l.kind !== 'image');
  const s = { id: uid(), kind: 'shade', strength: 1 };
  if (i < 0) slide().layers.push(s);
  else slide().layers.splice(i, 0, s);
  changed('shade');
}

// How a new picture goes on a slide: photos fill it (full bleed), plots and
// PDF pages are fitted inside the margins on a card.
function placePicture(id, opts = {}) {
  const pic = R.ready(id);
  const { w: W, h: H } = size();
  const photo = opts.photo ?? /\.(jpg|webp)$/.test(id);
  let l;
  if (photo) {
    l = { kind: 'image', asset: id, x: 0, y: 0, w: W, h: H, fit: 'cover', zoom: 1, px: 0.5, py: 0.5 };
    return addLayer(l, { below: true });
  }
  const maxW = W - 2 * R.SAFE;
  const maxH = H * 0.62;
  const ar = pic ? pic.w / pic.h : 4 / 3;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) {
    h = maxH;
    w = h * ar;
  }
  const dark = theme().logo === 'light' && !slide().bg; // a dark slide: plots go on a white card
  l = { kind: 'image', asset: id, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h), fit: 'contain', zoom: 1, px: 0.5, py: 0.5, radius: 6, card: dark ? { color: '#ffffff', pad: 20 } : null };
  return addLayer(l);
}

function slideHasPicture(s) {
  return s.layers.some((l) => l.kind === 'image');
}

// Pictures (Blobs) onto slides: the first onto this slide if it has none,
// each of the rest onto a new slide after it.
async function addPictures(list, opts = {}) {
  let first = true;
  let n = 0;
  for (const item of list) {
    const blob = item.blob || item;
    try {
      const id = await storeAsset(blob);
      if (!(first && !slideHasPicture(slide()))) addSlide(S.cur);
      first = false;
      placePicture(id, { photo: opts.photo ?? item.photo });
      n++;
    } catch (e) {
      toast(`Could not add ${item.name || 'that file'}: ${e.message}`, 4000);
    }
  }
  if (n) buildStrip();
  return n;
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isArchive = (f) => /\.(tar\.gz|tgz|tar|gz)$/i.test(f.name || '') || /gzip|x-tar/.test(f.type);
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|svg|heic)$/i.test(f.name || '');

async function addFiles(files) {
  files = [...files];
  const pics = files.filter((f) => isImage(f) && !isPdf(f));
  if (pics.length) {
    toast(pics.length === 1 ? 'Adding the picture…' : `Adding ${pics.length} pictures…`);
    const n = await addPictures(pics.map((f) => ({ blob: f, name: f.name, photo: /jpe?g|heic|webp/i.test(f.type || f.name) })));
    if (n) toast(n === 1 ? 'Added' : `Added ${n} pictures, one per slide`);
  }
  for (const f of files.filter(isPdf)) await Sheets.pdf(f);
  for (const f of files.filter((f) => isArchive(f) && !isPdf(f))) await Sheets.archive(f);
  if (!files.some((f) => isImage(f) || isPdf(f) || isArchive(f))) toast('Those files are not pictures, PDFs or a paper’s source (.tar.gz)', 4000);
}

function pickFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,application/pdf,.pdf,.svg,.tar,.gz,.tgz';
  input.hidden = true;
  input.onchange = () => {
    const files = [...input.files];
    input.remove();
    if (files.length) addFiles(files);
  };
  document.body.append(input);
  input.click();
}

function deleteLayer() {
  const l = selLayer();
  if (!l) return;
  const sibs = spanSiblings(l);
  slide().layers = slide().layers.filter((m) => m !== l);
  if (sibs.length) for (const s of S.doc.slides) s.layers = s.layers.filter((m) => !(l.span && m.span === l.span));
  S.sel = null;
  S.crop = false;
  changed('delete layer', { all: !!sibs.length });
}
function duplicateLayer() {
  const l = selLayer();
  if (!l) return;
  const c = JSON.parse(JSON.stringify(l));
  c.id = uid();
  delete c.span;
  c.x += 24;
  c.y += 24;
  slide().layers.splice(slide().layers.indexOf(l) + 1, 0, c);
  S.sel = c.id;
  changed('duplicate layer');
}
function restack(d) {
  const l = selLayer();
  if (!l) return;
  const ls = slide().layers;
  const i = ls.indexOf(l);
  const j = clamp(i + d, 0, ls.length - 1);
  if (i === j) return;
  ls.splice(i, 1);
  ls.splice(j, 0, l);
  changed('restack');
  toast(d > 0 ? 'Brought forward' : 'Sent backward');
}

function toggleCrop() {
  const l = selLayer();
  if (!l || l.kind !== 'image') return toast('Select a picture to crop it');
  S.crop = !S.crop;
  refresh();
}
function toggleFill() {
  const l = selLayer();
  if (!l || l.kind !== 'image') return toast('Select a picture first');
  l.fit = l.fit === 'contain' ? 'cover' : 'contain';
  l.zoom = 1;
  l.px = l.py = 0.5;
  syncSpan(l);
  changed('fit', { slides: spanSlideIds(l) });
  toast(l.fit === 'cover' ? 'Fills its frame' : 'Fits inside its frame');
}
function fillSlide() {
  const l = selLayer();
  if (!l || l.kind !== 'image') return;
  const { w: W, h: H } = size();
  Object.assign(l, { x: 0, y: 0, w: W, h: H, fit: 'cover', zoom: 1, px: 0.5, py: 0.5, rot: 0, radius: 0, card: null });
  const ls = slide().layers;
  ls.splice(ls.indexOf(l), 1);
  ls.unshift(l);
  changed('fill slide');
}
function rotate90() {
  const l = selLayer();
  if (!l || l.kind !== 'image') return toast('Select a picture to turn it');
  l.turn = ((l.turn || 0) + 1) % 4;
  const pic = R.ready(l.asset);
  if (pic && l.fit === 'contain') {
    // a fitted picture: turn the frame with it
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    [l.w, l.h] = [l.h, l.w];
    l.x = Math.round(cx - l.w / 2);
    l.y = Math.round(cy - l.h / 2);
  }
  syncSpan(l);
  changed('turn', { slides: spanSlideIds(l) });
}

// Spread a picture across this and the next slides, so the carousel reads
// as one wide image when swiped.
function spread(n) {
  const l = selLayer();
  if (!l || l.kind !== 'image') return toast('Select a picture to spread it across slides');
  const { w: W, h: H } = size();
  if (l.span) {
    // already spread: take it back to this slide
    for (const s of S.doc.slides) if (s !== slide()) s.layers = s.layers.filter((m) => m.span !== l.span);
    delete l.span;
    Object.assign(l, { x: 0, y: 0, w: W, h: H });
    changed('unspread', { all: true });
    return toast('Back on one slide');
  }
  n = n || clamp(S.doc.slides.length - S.cur, 2, 3);
  while (S.doc.slides.length < S.cur + n) S.doc.slides.push(blankSlide());
  l.span = uid();
  Object.assign(l, { x: 0, y: 0, w: W * n, h: H, fit: 'cover', zoom: 1, px: 0.5, py: 0.5, rot: 0, radius: 0, card: null });
  const ls = slide().layers;
  ls.splice(ls.indexOf(l), 1);
  ls.unshift(l);
  for (let k = 1; k < n; k++) {
    const s = S.doc.slides[S.cur + k];
    s.layers = s.layers.filter((m) => !(m.kind === 'image' && m.x <= 0 && m.y <= 0 && m.w >= W && m.h >= H));
    s.layers.unshift({ ...JSON.parse(JSON.stringify(l)), id: uid(), x: -W * k });
  }
  buildStrip();
  changed('spread', { all: true });
  toast(`Spread across ${n} slides · X again to undo the spread`);
}

/* ------------------------------------------------------------------ the strip */

const thumbs = new Map(); // slide id -> canvas
let dirty = new Set();
let thumbTimer = 0;
function dirtyThumbs(ids) {
  if (!S.doc) return;
  if (ids === null) for (const s of S.doc.slides) dirty.add(s.id);
  else for (const id of ids) if (id) dirty.add(id);
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(drawThumbs, 180);
}
function drawThumbs() {
  const { w: W, h: H } = size();
  const ch = TOUCH ? 46 : 70;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const s of S.doc.slides) {
    if (!dirty.has(s.id)) continue;
    const c = thumbs.get(s.id);
    if (!c) continue;
    const k = (ch * dpr) / H;
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    c.style.height = ch + 'px';
    c.style.width = Math.round((W * ch) / H) + 'px';
    R.drawSlide(c.getContext('2d'), S.doc, s, k);
    dirty.delete(s.id);
  }
}

function buildStrip() {
  const strip = $('#strip');
  strip.replaceChildren();
  S.doc.slides.forEach((s, i) => {
    const b = el('button', 'thumb' + (i === S.cur ? ' on' : ''));
    b.title = `Slide ${i + 1}`;
    let c = thumbs.get(s.id);
    if (!c) {
      c = document.createElement('canvas');
      thumbs.set(s.id, c);
      dirty.add(s.id);
    }
    b.append(c, el('span', 'n', String(i + 1)));
    b.onclick = () => {
      if (b.dataset.dragged) return;
      go(i);
    };
    b.addEventListener('pointerdown', (e) => thumbDrag(e, i, b));
    strip.append(b);
  });
  const add = el('button', 'add-slide', '+');
  add.title = 'New slide (N)';
  add.onclick = () => addSlide();
  strip.append(add);
  dirtyThumbs([]);
  drawThumbs();
}

// Drag a slide in the strip to move it (mouse; on touch, the slide panel's
// ← → buttons).
function thumbDrag(e, i, b) {
  if (e.pointerType !== 'mouse' || e.button) return;
  const x0 = e.clientX;
  let target = null;
  const move = (ev) => {
    if (!b.dataset.dragged && Math.abs(ev.clientX - x0) < 8) return;
    b.dataset.dragged = '1';
    b.classList.add('drag');
    $$('.thumb').forEach((t) => t.classList.remove('insert-before', 'insert-after'));
    const ts = $$('.thumb');
    target = ts.length - 1;
    for (let j = 0; j < ts.length; j++) {
      const r = ts[j].getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2) {
        target = j;
        ts[j].classList.add('insert-before');
        break;
      }
    }
    if (target === ts.length - 1 && ev.clientX > ts[ts.length - 1].getBoundingClientRect().right - ts[ts.length - 1].offsetWidth / 2) {
      target = ts.length;
      ts[ts.length - 1].classList.add('insert-after');
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (b.dataset.dragged && target !== null) {
      const j = target > i ? target - 1 : target;
      if (j !== i) {
        const [s] = S.doc.slides.splice(i, 1);
        S.doc.slides.splice(j, 0, s);
        S.cur = j;
        changed('move slide', { all: true });
      }
      setTimeout(buildStrip, 0);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ the inspector */

const insp = $('#insp');

function ctlRow(label, input, val) {
  const r = el('div', 'row');
  const l = el('label', '', label);
  r.append(l, input, val || el('span'));
  return r;
}
// A slider; double-click resets it.
function slider(label, get, set, { min, max, step = 1, def = 0, fmt = (v) => String(Math.round(v)), lbl } = {}) {
  const input = el('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = get();
  const val = el('span', 'val', fmt(get()));
  const apply = (v) => {
    set(v);
    val.textContent = fmt(v);
    requestRender();
    changed(lbl || label, { quiet: true });
  };
  input.oninput = () => apply(parseFloat(input.value));
  input.ondblclick = () => {
    input.value = def;
    apply(def);
  };
  input.title = 'Double-click to reset';
  return ctlRow(label, input, val);
}
function seg(options, value, onPick) {
  const s = el('div', 'seg');
  for (const [v, label, title] of options) {
    const b = el('button', v === value ? 'on' : '', label);
    if (title) b.title = title;
    b.onclick = () => onPick(v);
    s.append(b);
  }
  return s;
}
function grp(label, ...kids) {
  const g = el('div', 'grp');
  if (label) g.append(el('span', 'lbl', label));
  g.append(...kids);
  return g;
}
function actBtn(label, key, fn, on) {
  const b = el('button', 'btn' + (on ? ' on' : ''));
  b.textContent = label;
  if (key && !TOUCH) {
    const k = el('kbd', '', key);
    b.append(k);
  }
  b.onclick = fn;
  return b;
}
function swatches(colors, current, onPick, { custom = true } = {}) {
  const w = el('div', 'sw');
  const seen = new Set();
  for (const [c, title] of colors) {
    if (seen.has(String(c).toLowerCase())) continue;
    seen.add(String(c).toLowerCase());
    const b = el('button', c && current && c.toLowerCase() === current.toLowerCase() ? 'on' : '');
    b.style.background = c;
    b.title = title || c;
    b.onclick = () => onPick(c);
    w.append(b);
  }
  if (custom) {
    const i = el('input');
    i.type = 'color';
    i.value = /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#ffffff';
    i.title = 'Any colour';
    i.oninput = () => onPick(i.value);
    w.append(i);
  }
  return w;
}

let inspFor = '';
function renderInspector(force) {
  const l = selLayer();
  const key = `${S.cur}:${l ? l.id : '-'}:${S.crop}:${S.doc.theme}`;
  if (!force && key === inspFor && insp.contains(document.activeElement) && document.activeElement !== document.body) return;
  inspFor = key;
  const keepOpen = !insp.classList.contains('collapsed');
  insp.replaceChildren();
  const head = el('div', 'ins-head');
  const title = el('h3', '', l ? { image: 'Picture', text: 'Text', logo: 'Logo', shade: 'Theme light' }[l.kind] : `Slide ${S.cur + 1}`);
  head.append(title);
  if (TOUCH) {
    const t = el('button', 'link', keepOpen ? 'Hide' : 'Show');
    t.onclick = () => {
      insp.classList.toggle('collapsed');
      t.textContent = insp.classList.contains('collapsed') ? 'Show' : 'Hide';
      requestRender();
    };
    head.append(t);
  }
  insp.append(head);
  if (!l) slidePanel();
  else if (l.kind === 'image') imagePanel(l);
  else if (l.kind === 'text') textPanel(l);
  else if (l.kind === 'logo') logoPanel(l);
  else if (l.kind === 'shade') shadePanel(l);
}

function slidePanel() {
  const s = slide();
  const t = theme();
  insp.append(
    grp(
      'Background',
      swatches(
        [
          [t.base, 'Theme'],
          ['#ffffff', 'White'],
          ['#000000', 'Black'],
          ['#0a1428', 'Navy'],
          ['#f5f0e8', 'Paper'],
        ],
        s.bg || t.base,
        (c) => {
          s.bg = c === t.base ? null : c;
          changed('bg');
          renderInspector(true);
        }
      )
    )
  );
  insp.append(
    grp(
      'Add',
      el('div', 'acts'),
    )
  );
  const acts = insp.lastChild.lastChild;
  acts.append(
    actBtn('Pictures', 'A', pickFiles),
    actBtn('Text', 'T', () => addText('body')),
    actBtn('Title', '', () => addText('title')),
    actBtn('Logo', 'L', addLogo),
    actBtn('Theme light', '', ensureShade)
  );
  const sl = el('div', 'acts');
  sl.append(
    actBtn('New', 'N', () => addSlide()),
    actBtn('Duplicate', 'D', duplicateSlide),
    actBtn('←', '{', () => moveSlide(-1)),
    actBtn('→', '}', () => moveSlide(1)),
    actBtn('Delete', MAC ? '⌘⌫' : 'Ctrl+⌫', deleteSlide)
  );
  insp.append(grp('Slide', sl));
  if (s.layers.length) {
    const list = el('div', 'layers');
    for (const l of [...s.layers].reverse()) {
      const b = el('button');
      const name = l.kind === 'text' ? l.text.split('\n')[0].slice(0, 40) || '(empty text)' : { image: l.fit === 'cover' ? 'Photo' : 'Picture', logo: 'Logo', shade: 'Theme light' }[l.kind];
      b.append(el('span', '', name), el('span', 'kind', l.kind === 'text' ? l.role : l.span ? 'spread' : ''));
      b.onclick = () => {
        S.sel = l.id;
        refresh();
      };
      list.append(b);
    }
    insp.append(grp('Layers, top first', list));
  }
}

function imagePanel(l) {
  const sync = () => syncSpan(l);
  const a = (l.adj = l.adj || {});
  const frame = el('div', 'acts');
  frame.append(
    actBtn(S.crop ? 'Done cropping' : 'Crop', 'C', toggleCrop, S.crop),
    actBtn(l.fit === 'contain' ? 'Fill frame' : 'Fit in frame', 'B', toggleFill),
    actBtn('Fill slide', '', fillSlide),
    actBtn('Turn 90°', 'R', rotate90),
    actBtn('Mirror', '', () => {
      l.flip = !l.flip;
      sync();
      changed('mirror');
    }),
    actBtn(l.span ? 'Unspread' : 'Spread across slides', 'X', () => spread())
  );
  insp.append(grp('Frame', frame));
  insp.append(
    grp(
      '',
      slider('Zoom', () => l.zoom || 1, (v) => {
        l.zoom = v;
        clampPan(l);
        sync();
      }, { min: l.fit === 'contain' ? 0.2 : 1, max: 5, step: 0.01, def: 1, fmt: (v) => Math.round(v * 100) + '%' }),
      slider('Corners', () => l.radius || 0, (v) => {
        l.radius = v;
        sync();
      }, { min: 0, max: 120 }),
      slider('Opacity', () => (l.opacity ?? 1) * 100, (v) => {
        l.opacity = v / 100;
        sync();
      }, { min: 0, max: 100, def: 100, fmt: (v) => Math.round(v) + '%' }),
      slider('Angle', () => l.rot || 0, (v) => {
        l.rot = v;
      }, { min: -180, max: 180, def: 0, fmt: (v) => Math.round(v) + '°' })
    )
  );
  const adjust = (k, label) =>
    slider(label, () => a[k] || 0, (v) => {
      a[k] = v;
      sync();
    }, { min: -100, max: 100, def: 0, lbl: 'adj-' + k });
  insp.append(grp('Adjust', adjust('b', 'Brightness'), adjust('c', 'Contrast'), adjust('s', 'Saturation'), adjust('t', 'Warmth')));
  const card = el('div', 'acts');
  card.append(
    seg(
      [
        ['none', 'None'],
        ['#ffffff', 'White'],
        ['#000000', 'Black'],
      ],
      l.card ? l.card.color : 'none',
      (v) => {
        l.card = v === 'none' ? null : { color: v, pad: l.card ? l.card.pad : 20 };
        sync();
        changed('card');
        renderInspector(true);
      }
    )
  );
  const cardGrp = grp('Card behind (for plots)', card);
  if (l.card)
    cardGrp.append(
      slider('Margin', () => l.card.pad, (v) => {
        l.card.pad = v;
      }, { min: 0, max: 80, def: 20 })
    );
  insp.append(cardGrp);
  insp.append(layerActions());
}

function textPanel(l) {
  const t = theme();
  const st = R.textStyle(l, t);
  const ta = el('textarea', 'txt');
  ta.id = 'text-edit';
  ta.value = l.text;
  ta.rows = 3;
  ta.oninput = () => {
    l.text = ta.value;
    changed('type', { quiet: true });
    drawOverlay();
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Escape') ta.blur();
  };
  insp.append(grp('', ta));
  insp.append(
    grp(
      'Style',
      seg(
        R.ROLES.map((r) => [r, r[0].toUpperCase() + r.slice(1)]),
        l.role,
        (v) => {
          l.role = v;
          for (const k of ['size', 'k', 'weight', 'italic', 'upper', 'font', 'color', 'lh', 'ls']) delete l[k];
          changed('role');
          renderInspector(true);
        }
      )
    )
  );
  const set = (k, v) => {
    l[k] = v;
    changed('style-' + k);
    renderInspector(true);
  };
  const fmt = el('div', 'acts');
  fmt.append(
    seg(
      [
        ['sans', 'Sans'],
        ['serif', 'Serif'],
        ['mono', 'Mono'],
      ],
      st.font,
      (v) => set('font', v)
    ),
    seg(
      [
        [400, 'Regular'],
        [500, 'Medium'],
        [700, 'Bold'],
      ],
      st.weight >= 650 ? 700 : st.weight >= 450 ? 500 : 400,
      (v) => set('weight', v)
    ),
    seg([[true, 'Italic']], st.italic, () => set('italic', !st.italic)),
    seg([[true, 'CAPS']], st.upper, () => set('upper', !st.upper)),
    seg(
      [
        ['left', 'Left'],
        ['center', 'Centre'],
        ['right', 'Right'],
      ],
      st.align,
      (v) => set('align', v)
    )
  );
  insp.append(grp('', fmt));
  insp.append(
    grp(
      '',
      slider('Size', () => st.size, (v) => {
        l.size = v;
      }, { min: 12, max: 240, def: t.type[l.role].size, lbl: 'size' }),
      slider('Line height', () => st.lh * 100, (v) => {
        l.lh = v / 100;
      }, { min: 80, max: 200, def: t.type[l.role].lh * 100, fmt: (v) => (v / 100).toFixed(2) }),
      slider('Spacing', () => st.ls, (v) => {
        l.ls = v;
      }, { min: -4, max: 16, step: 0.5, def: t.type[l.role].ls, fmt: (v) => String(v) }),
      slider('Shadow', () => st.shadow * 100, (v) => {
        l.shadow = v / 100;
      }, { min: 0, max: 100, def: t.shadow * 100, fmt: (v) => Math.round(v) + '%' })
    )
  );
  insp.append(
    grp(
      'Colour',
      swatches(
        [
          [t.colors[l.role], 'Theme'],
          [t.colors.eyebrow, 'Theme accent'],
          ['#ffffff', 'White'],
          ['#0a1428', 'Navy'],
          ['#000000', 'Black'],
          ['#f0a640', 'Amber'],
        ],
        st.color,
        (c) => set('color', c)
      )
    )
  );
  insp.append(
    grp(
      'Box behind',
      seg(
        [
          ['none', 'None'],
          ['#000000', 'Dark'],
          ['#ffffff', 'Light'],
        ],
        l.plate ? l.plate.color : 'none',
        (v) => set('plate', v === 'none' ? null : { color: v, alpha: 0.82 })
      )
    )
  );
  insp.append(contrastReadout(l));
  const reset = el('div', 'acts');
  reset.append(
    actBtn('Reset style', '', () => {
      for (const k of ['size', 'k', 'weight', 'italic', 'upper', 'font', 'color', 'lh', 'ls', 'shadow', 'align', 'plate']) delete l[k];
      changed('reset style');
      renderInspector(true);
    })
  );
  insp.append(grp('', reset));
  insp.append(layerActions());
}

// Contrast of the text against what is behind it, on a log scale from 1:1
// to 21:1 with the WCAG thresholds marked: the dot is the average backdrop,
// the line runs to the worst spot under the text.
function contrastReadout(l) {
  const g = grp('Contrast');
  g.classList.add('contrast');
  let c;
  try {
    c = R.textContrast(S.doc, slide(), l);
  } catch {
    return g;
  }
  const need = c.large ? 3 : 4.5;
  const pass = c.ratio >= need;
  const fig = el('div');
  fig.append(el('span', 'fig num', c.ratio.toFixed(1) + ' : 1'), el('span', 'verdict' + (pass ? '' : ' bad'), pass ? (c.ratio >= (c.large ? 4.5 : 7) ? '  reads well (AAA)' : '  readable (AA)') : `  needs ${need} : 1 — add a box, shadow or the theme light`));
  const W = 260;
  const x = (v) => 4 + (Math.log(v) / Math.log(21)) * (W - 8);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} 34`);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    svg.append(n);
    return n;
  };
  add('line', { x1: x(1), x2: x(21), y1: 12, y2: 12, stroke: '#3a3936', 'stroke-width': 1 });
  for (const [v, label] of [
    [1, '1'],
    [3, '3'],
    [4.5, '4.5'],
    [7, '7'],
    [21, '21'],
  ]) {
    add('line', { x1: x(v), x2: x(v), y1: 9, y2: 15, stroke: v === need ? '#e9e6df' : '#5a5853', 'stroke-width': 1 });
    add('text', { x: x(v), y: 30, 'text-anchor': v === 1 ? 'start' : v === 21 ? 'end' : 'middle', 'font-size': 9.5, fill: v === need ? '#e9e6df' : '#8a877f' }, label);
  }
  if (c.worst < c.ratio - 0.05) add('line', { x1: x(Math.max(1, c.worst)), x2: x(c.ratio), y1: 12, y2: 12, stroke: pass ? '#8a877f' : '#e5735c', 'stroke-width': 2 });
  add('circle', { cx: x(clamp(c.ratio, 1, 21)), cy: 12, r: 4, fill: pass ? '#e9e6df' : '#e5735c' });
  g.append(fig, svg);
  return g;
}

function logoPanel(l) {
  const t = theme();
  const { w: W, h: H } = size();
  insp.append(
    grp(
      'Version',
      seg(
        [
          [null, 'Theme'],
          ['light', 'For dark'],
          ['dark', 'For light'],
        ],
        l.variant || null,
        (v) => {
          l.variant = v || undefined;
          changed('logo');
          renderInspector(true);
        }
      )
    )
  );
  insp.append(
    grp(
      '',
      slider('Size', () => l.h, (v) => {
        const cx = l.x + (l.h * R.LOGO_RATIO) / 2;
        const cy = l.y + l.h / 2;
        l.h = v;
        l.x = Math.round(cx - (v * R.LOGO_RATIO) / 2);
        l.y = Math.round(cy - v / 2);
      }, { min: 40, max: 600, def: 150 }),
      slider('Opacity', () => (l.opacity ?? 1) * 100, (v) => {
        l.opacity = v / 100;
      }, { min: 0, max: 100, def: 100, fmt: (v) => Math.round(v) + '%' })
    )
  );
  const corners = el('div', 'acts');
  const lw = () => l.h * R.LOGO_RATIO;
  for (const [label, fx, fy] of [
    ['↖', 0, 0],
    ['↗', 1, 0],
    ['↙', 0, 1],
    ['↘', 1, 1],
  ])
    corners.append(
      actBtn(label, '', () => {
        l.x = Math.round(fx ? W - R.SAFE - lw() : R.SAFE);
        l.y = Math.round(fy ? H - R.SAFE - l.h : R.SAFE);
        changed('logo corner');
      })
    );
  insp.append(grp('Corner', corners));
  void t;
  insp.append(layerActions());
}

function shadePanel(l) {
  insp.append(
    grp(
      'The theme’s tint and gradients, over everything below this layer.',
      slider('Strength', () => (l.strength ?? 1) * 100, (v) => {
        l.strength = v / 100;
      }, { min: 0, max: 200, def: 100, fmt: (v) => Math.round(v) + '%' })
    )
  );
  insp.append(layerActions());
}

function layerActions() {
  const a = el('div', 'acts');
  a.append(
    actBtn('Backward', ',', () => restack(-1)),
    actBtn('Forward', '.', () => restack(1)),
    actBtn('Duplicate', MAC ? '⌘D' : 'Ctrl+D', duplicateLayer),
    actBtn('Delete', '⌫', deleteLayer)
  );
  return grp('Layer', a);
}

function editText(selectAll) {
  const l = selLayer();
  if (!l || l.kind !== 'text') return;
  insp.classList.remove('collapsed');
  renderInspector(true);
  const ta = $('#text-edit');
  if (ta) {
    ta.focus();
    if (selectAll) ta.select();
  }
}

/* ------------------------------------------------------------------ refresh */

function refresh() {
  if (!S.doc) return;
  const n = S.doc.slides.length;
  $('#counter').innerHTML = `Slide <b>${S.cur + 1}</b> of ${n}`;
  $('#doc-name').textContent = S.doc.name;
  document.title = `${S.doc.name} · USMCC Publicity Helper`;
  $$('.thumb').forEach((t, i) => t.classList.toggle('on', i === S.cur));
  if ($$('.thumb').length !== n) buildStrip();
  renderInspector();
  requestRender();
}

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ commands, menu, keys */

// Every tool: its key, its place in the Menu and (on macOS) the menu bar.
const MENU = [
  {
    group: 'Carousel',
    items: [
      ['open', 'Your carousels…', 'O', () => Sheets.docs()],
      ['new', 'New carousel', '', () => Sheets.newDoc()],
      ['add', 'Add photos, PDFs, plots…', 'A', pickFiles],
      ['paper', 'Paper…', 'P', () => Sheets.paper()],
      ['posts', 'Write the posts…', 'W', () => Sheets.posts()],
      ['export', 'Export slides…', 'E', () => Sheets.export()],
    ],
  },
  {
    group: 'Slide',
    items: [
      ['newslide', 'New slide', 'N', () => addSlide()],
      ['dupslide', 'Duplicate slide', 'D', duplicateSlide],
      ['delslide', 'Delete slide', MAC ? '⌘⌫' : 'Ctrl+⌫', deleteSlide],
      ['prev', 'Previous slide', '[', () => go(S.cur - 1)],
      ['next', 'Next slide', ']', () => go(S.cur + 1)],
      ['slideleft', 'Move slide left', '{', () => moveSlide(-1)],
      ['slideright', 'Move slide right', '}', () => moveSlide(1)],
      ['theme', 'Theme and size…', 'Y', () => Sheets.theme()],
      ['size', 'Next slide size', 'S', () => Sheets.cycleSize()],
    ],
  },
  {
    group: 'Layer',
    items: [
      ['text', 'Add text', 'T', () => addText('body')],
      ['logo', 'Add the logo', 'L', addLogo],
      ['shade', 'Add the theme light', 'K', ensureShade],
      ['crop', 'Crop picture', 'C', toggleCrop],
      ['fill', 'Fill / fit frame', 'B', toggleFill],
      ['rotate', 'Turn picture 90°', 'R', rotate90],
      ['spread', 'Spread across slides', 'X', () => spread()],
      ['backward', 'Send backward', ',', () => restack(-1)],
      ['forward', 'Bring forward', '.', () => restack(1)],
      ['duplicate', 'Duplicate layer', MAC ? '⌘D' : 'Ctrl+D', duplicateLayer],
      ['delete', 'Delete layer', '⌫', deleteLayer],
      ['edit', 'Edit text', '↵', () => editText()],
    ],
  },
  {
    group: 'Edit',
    items: [
      ['undo', 'Undo', MAC ? '⌘Z' : 'Ctrl+Z', undo],
      ['redo', 'Redo', MAC ? '⇧⌘Z' : 'Ctrl+Y', redo],
      ['nextlayer', 'Select next layer', 'Tab', () => cycleLayer(1)],
    ],
  },
  {
    group: 'View',
    items: [
      ['guides', 'Safe-area guides', 'G', () => {
        S.guides = !S.guides;
        requestRender();
      }],
      ['fullscreen', 'Full screen', 'F', toggleFullscreen],
      ['menu', 'Menu', 'M', () => Sheets.menu()],
      ['keys', 'Keyboard shortcuts', '?', () => Sheets.keys()],
    ],
  },
];
const COMMANDS = {};
for (const g of MENU) for (const [id, , , run] of g.items) COMMANDS[id] = run;
window.usmccCommand = (id) => {
  if (COMMANDS[id]) COMMANDS[id]();
};

function cycleLayer(d) {
  const ls = slide().layers.filter((l) => l.kind !== 'shade');
  if (!ls.length) return;
  const i = ls.findIndex((l) => l.id === S.sel);
  S.sel = ls[(i + d + ls.length) % ls.length].id;
  S.crop = false;
  refresh();
}

async function toggleFullscreen() {
  if (S.info.shell === 'tauri') {
    const r = await api('POST', '/api/window', { fullscreen: !S.fs }).catch(() => null);
    S.fs = r ? r.fullscreen : !S.fs;
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
}

function nudge(dx, dy) {
  const l = selLayer();
  if (!l) return;
  if (S.crop && l.kind === 'image') {
    l.px = clamp((l.px ?? 0.5) + dx / 400, 0, 1);
    l.py = clamp((l.py ?? 0.5) + dy / 400, 0, 1);
    clampPan(l);
  } else {
    l.x += dx;
    l.y += dy;
  }
  syncSpan(l);
  changed('nudge', { quiet: true, slides: spanSlideIds(l) });
  drawOverlay();
}

const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (!S.doc) return;
  const mod = e.metaKey || e.ctrlKey;
  if (Sheets.open()) return Sheets.key(e);
  if (typing(e.target)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const k = e.key;
  const step = e.shiftKey ? 10 : 1;
  const l = selLayer();
  if (mod && (k === 'z' || k === 'Z')) {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    return redo();
  }
  if (mod && (k === 'd' || k === 'D')) {
    e.preventDefault();
    return duplicateLayer();
  }
  if (mod && (k === 'Backspace' || k === 'Delete')) {
    e.preventDefault();
    return deleteSlide();
  }
  if (mod && k === 'e') return; // the desktop's own shortcuts
  if (mod || e.altKey) return;
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    if (l) {
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      return nudge(...d);
    }
    return go(S.cur + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1));
  }
  if (k === 'Escape') {
    if (S.crop) S.crop = false;
    else S.sel = null;
    return refresh();
  }
  if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    return deleteLayer();
  }
  if (k === 'Enter' && l && l.kind === 'text') {
    e.preventDefault();
    return editText();
  }
  if (k === 'Tab') {
    e.preventDefault();
    return cycleLayer(e.shiftKey ? -1 : 1);
  }
  if (k === 'PageUp') return go(S.cur - 1);
  if (k === 'PageDown') return go(S.cur + 1);
  const byKey = {};
  for (const g of MENU) for (const [id, , key] of g.items) if (key && key.length === 1) byKey[key.toLowerCase()] = id;
  const id = byKey[k.toLowerCase()] || (k === '?' ? 'keys' : null);
  if (id) {
    e.preventDefault();
    COMMANDS[id]();
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) COMMANDS[b.dataset.cmd] && COMMANDS[b.dataset.cmd]();
});
$('#doc-name').onclick = () => Sheets.docs();
$('#undo-btn').onclick = undo;
$('#redo-btn').onclick = redo;

/* ------------------------------------------------------------------ drop, paste */

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  $('#drop-hint').hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop-hint').hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').hidden = true;
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) addFiles(files);
});
document.addEventListener('paste', (e) => {
  if (typing(e.target) || Sheets.open()) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    return addFiles(files);
  }
  const text = e.clipboardData?.getData('text') || '';
  if (text.includes('\t') || /arxiv\.org|^\s*(arxiv:)?\d{4}\.\d{4,5}/i.test(text)) {
    e.preventDefault();
    Sheets.paper(text);
  }
});

/* ------------------------------------------------------------------ start */

async function boot() {
  document.body.classList.toggle('touch', TOUCH);
  if (new URLSearchParams(location.search).get('shell') === 'tauri') document.body.classList.add('tauri');
  try {
    S.info = await api('GET', '/api/info');
  } catch (e) {
    S.info = { shell: 'browser' };
  }
  if (S.info.shell === 'tauri') document.body.classList.add('tauri');
  S.settings = await api('GET', '/api/settings').catch(() => ({}));
  let doc = null;
  if (S.settings.lastDoc) doc = await api('GET', `/api/doc/${encodeURIComponent(S.settings.lastDoc)}`).catch(() => null);
  if (!doc) {
    const list = await api('GET', '/api/docs').catch(() => []);
    if (list.length) doc = await api('GET', `/api/doc/${list[0].id}`).catch(() => null);
  }
  openDoc(doc || newDoc());
  R.logosReady().then(() => {
    requestRender();
    dirtyThumbs(null);
  });
}

window.U = {
  S,
  api,
  el,
  $,
  $$,
  clamp,
  uid,
  toast,
  TOUCH,
  MAC,
  LITE,
  MENU,
  COMMANDS,
  slide,
  size,
  theme,
  selLayer,
  changed,
  refresh,
  requestRender,
  buildStrip,
  dirtyThumbs,
  openDoc,
  newDoc,
  blankSlide,
  saveNow,
  saveSettings,
  storeAsset,
  loadAsset,
  addPictures,
  addSlide,
  addLayer,
  reflow,
  go,
  pickFiles,
};

document.addEventListener('DOMContentLoaded', boot);
