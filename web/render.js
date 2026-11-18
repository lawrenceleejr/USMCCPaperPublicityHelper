/* USMCC Publicity Helper: the slide renderer.

   One function draws a slide onto a canvas, at any scale. The editor's stage,
   the slide strip, the theme previews and the exported JPEG/PNG files all use
   it, so what you see is exactly what gets saved.

   A slide is a background colour plus layers, drawn in order:
     image  a photo, plot or PDF page in a frame (cover or fit, pan and zoom
            inside the frame, light adjustments, rounded corners, a card behind)
     shade  the theme's light: tint and gradients over everything below it
     text   eyebrow / title / body / caption, styled by the theme unless
            overridden on the layer
     logo   the USMCC mark
   Coordinates are slide pixels: every slide is 1080 wide. */

(function () {
  'use strict';

  const SIZES = {
    portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', note: 'Instagram, LinkedIn' },
    square: { w: 1080, h: 1080, label: 'Square 1:1', note: 'Instagram, X, Bluesky' },
    story: { w: 1080, h: 1920, label: 'Story 9:16', note: 'Stories, Reels' },
  };

  const FONTS = {
    sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
    serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  };

  // The six looks of the original carousel designer, as data. Gradient
  // layers: ['r', cx, cy, r, blend, opacity, stops] or ['l', angle, blend,
  // opacity, stops]; positions are fractions of the slide.
  const THEMES = {
    "editorial": { "name": "Editorial", "base": "#0a0a0a", "tint": [ "#0d1b2a", 0.35, "multiply" ], "layers": [ [ "r", 0.3, 0.7, 1.1, "normal", 1, [ [ 0, "rgba(0,0,0,0)" ], [ 0.5, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0.5)" ] ] ], [ "r", 0.2, 0.15, 0.75, "screen", 1, [ [ 0, "rgba(245,200,66,0.22)" ], [ 0.55, "rgba(245,200,66,0)" ] ] ], [ "r", 0.5, 1.35, 1.4, "multiply", 1, [ [ 0, "rgba(0,0,0,0.92)" ], [ 0.3, "rgba(0,0,0,0.7)" ], [ 0.55, "rgba(0,0,0,0.32)" ], [ 0.85, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0)" ] ] ], [ "r", 0.5, 0.5, 0.95, "multiply", 0.9, [ [ 0.55, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0.55)" ] ] ] ], "align": "left", "valign": "bottom", "logo": "light", "shadow": 0.4, "colors": { "eyebrow": "#f5c842", "title": "#ffffff", "body": "#ffffff", "caption": "#cbd5e1" }, "type": { "eyebrow": { "size": 30, "lh": 1.2, "ls": 6, "weight": 600, "italic": false, "upper": true, "font": "sans" }, "title": { "size": 92, "lh": 1.04, "ls": -1, "weight": 700, "italic": false, "upper": false, "font": "sans" }, "body": { "size": 38, "lh": 1.35, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 28, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": true, "upper": false, "font": "sans" } } },
    "bold_sans": { "name": "Bold Sans", "base": "#1a1a2e", "tint": [ "#3c1d6e", 0.6, "multiply" ], "layers": [ [ "r", 0.5, 0.5, 0.95, "normal", 1, [ [ 0, "rgba(20,15,40,0.85)" ], [ 0.45, "rgba(20,15,40,0.55)" ], [ 0.8, "rgba(20,15,40,0.15)" ], [ 1, "rgba(20,15,40,0)" ] ] ], [ "r", 0.5, 0.3, 0.7, "screen", 1, [ [ 0, "rgba(168,85,247,0.45)" ], [ 0.55, "rgba(124,58,237,0.10)" ], [ 1, "rgba(124,58,237,0)" ] ] ], [ "r", 0.5, 0.5, 0.95, "multiply", 1, [ [ 0.45, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0.75)" ] ] ] ], "align": "center", "valign": "middle", "logo": "light", "shadow": 0.4, "colors": { "eyebrow": "#fbbf24", "title": "#ffffff", "body": "#ffffff", "caption": "#e9d5ff" }, "type": { "eyebrow": { "size": 30, "lh": 1.2, "ls": 10, "weight": 700, "italic": false, "upper": true, "font": "sans" }, "title": { "size": 100, "lh": 1, "ls": -1, "weight": 700, "italic": false, "upper": false, "font": "sans" }, "body": { "size": 36, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 28, "lh": 1.4, "ls": 1, "weight": 500, "italic": true, "upper": false, "font": "serif" } } },
    "punch": { "name": "Punch", "base": "#020617", "tint": [ "#ef4444", 0.5, "multiply" ], "layers": [ [ "r", 0.25, 0.25, 1.05, "normal", 1, [ [ 0, "rgba(0,0,0,0)" ], [ 0.5, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0.55)" ] ] ], [ "r", -0.25, -0.25, 1.9, "multiply", 1, [ [ 0, "rgba(239,68,68,0.92)" ], [ 0.25, "rgba(239,68,68,0.45)" ], [ 0.5, "rgba(239,68,68,0.10)" ], [ 0.7, "rgba(2,6,23,0.30)" ], [ 0.9, "rgba(2,6,23,0.7)" ], [ 1, "rgba(2,6,23,0.92)" ] ] ], [ "r", 0.12, 0.1, 0.4, "screen", 1, [ [ 0, "rgba(253,224,71,0.55)" ], [ 1, "rgba(253,224,71,0)" ] ] ], [ "r", 0.95, 0.95, 0.7, "multiply", 1, [ [ 0, "rgba(0,0,0,0.6)" ], [ 1, "rgba(0,0,0,0)" ] ] ] ], "align": "left", "valign": "top", "logo": "light", "shadow": 0.4, "colors": { "eyebrow": "#fde047", "title": "#ffffff", "body": "#ffffff", "caption": "#fca5a5" }, "type": { "eyebrow": { "size": 32, "lh": 1.2, "ls": 8, "weight": 700, "italic": false, "upper": true, "font": "sans" }, "title": { "size": 140, "lh": 0.92, "ls": 1, "weight": 400, "italic": false, "upper": false, "font": "sans" }, "body": { "size": 32, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 26, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" } } },
    "ocean": { "name": "Ocean", "base": "#0c4a6e", "tint": [ "#082f49", 0.3, "multiply" ], "layers": [ [ "r", 0.3, 0.7, 1.1, "normal", 1, [ [ 0, "rgba(125,211,252,0.10)" ], [ 0.55, "rgba(0,0,0,0)" ], [ 1, "rgba(2,20,35,0.5)" ] ] ], [ "r", 0.5, 0.2, 0.65, "screen", 1, [ [ 0, "rgba(125,211,252,0.40)" ], [ 0.6, "rgba(125,211,252,0.05)" ], [ 1, "rgba(125,211,252,0)" ] ] ], [ "r", 0.5, 1.45, 1.5, "multiply", 1, [ [ 0, "rgba(8,47,73,0.95)" ], [ 0.35, "rgba(8,47,73,0.55)" ], [ 0.7, "rgba(8,47,73,0.10)" ], [ 1, "rgba(8,47,73,0)" ] ] ], [ "r", 0.5, 0.5, 1, "multiply", 1, [ [ 0.55, "rgba(0,0,0,0)" ], [ 1, "rgba(0,0,0,0.45)" ] ] ] ], "align": "left", "valign": "bottom", "logo": "light", "shadow": 0.4, "colors": { "eyebrow": "#bae6fd", "title": "#f0f9ff", "body": "#f0f9ff", "caption": "#cbd5e1" }, "type": { "eyebrow": { "size": 26, "lh": 1.2, "ls": 4, "weight": 500, "italic": false, "upper": true, "font": "sans" }, "title": { "size": 96, "lh": 1.05, "ls": -0.5, "weight": 400, "italic": false, "upper": false, "font": "sans" }, "body": { "size": 36, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 28, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" } } },
    "soft_serif": { "name": "Soft Serif", "base": "#f5f0e8", "tint": [ "#7c2d12", 0.22, "multiply" ], "layers": [ [ "r", 0.3, 0.7, 1.05, "normal", 1, [ [ 0, "rgba(255,236,200,0.28)" ], [ 0.5, "rgba(255,236,200,0.05)" ], [ 1, "rgba(64,28,8,0.45)" ] ] ], [ "r", 0.5, 1.5, 1.7, "multiply", 1, [ [ 0, "rgba(64,28,8,0.7)" ], [ 0.25, "rgba(120,53,15,0.4)" ], [ 0.55, "rgba(245,200,140,0.18)" ], [ 0.85, "rgba(255,236,180,0.20)" ], [ 1, "rgba(255,236,180,0.30)" ] ] ], [ "r", 0.5, 0.05, 0.55, "screen", 1, [ [ 0, "rgba(255,228,180,0.45)" ], [ 1, "rgba(255,228,180,0)" ] ] ] ], "align": "left", "valign": "bottom", "logo": "dark", "shadow": 0, "colors": { "eyebrow": "#92400e", "title": "#1c1917", "body": "#1c1917", "caption": "#57534e" }, "type": { "eyebrow": { "size": 26, "lh": 1.2, "ls": 5, "weight": 600, "italic": false, "upper": true, "font": "sans" }, "title": { "size": 108, "lh": 1, "ls": -0.5, "weight": 500, "italic": false, "upper": false, "font": "serif" }, "body": { "size": 34, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 28, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": true, "upper": false, "font": "serif" } } },
    "minimal_mono": { "name": "Minimal Mono", "base": "#f7f7f4", "tint": [ "#0a0a0a", 0.18, "multiply" ], "layers": [ [ "r", 0.25, 0.25, 0.95, "normal", 1, [ [ 0, "rgba(255,255,255,0.40)" ], [ 0.45, "rgba(255,255,255,0.10)" ], [ 1, "rgba(0,0,0,0.18)" ] ] ], [ "r", 0.5, -0.3, 1.3, "normal", 1, [ [ 0, "rgba(255,255,255,0.65)" ], [ 0.55, "rgba(247,247,244,0.08)" ], [ 1, "rgba(247,247,244,0)" ] ] ], [ "r", 0.5, 1.25, 1.2, "multiply", 1, [ [ 0, "rgba(0,0,0,0.16)" ], [ 0.55, "rgba(0,0,0,0.04)" ], [ 1, "rgba(0,0,0,0)" ] ] ], [ "r", 0.85, 0.12, 0.55, "multiply", 1, [ [ 0, "rgba(124,58,237,0.14)" ], [ 1, "rgba(124,58,237,0)" ] ] ] ], "align": "left", "valign": "top", "logo": "dark", "shadow": 0, "colors": { "eyebrow": "#7c3aed", "title": "#0a0a0a", "body": "#0a0a0a", "caption": "#52525b" }, "type": { "eyebrow": { "size": 26, "lh": 1.2, "ls": 8, "weight": 600, "italic": false, "upper": true, "font": "mono" }, "title": { "size": 80, "lh": 1.06, "ls": -1.5, "weight": 700, "italic": false, "upper": false, "font": "sans" }, "body": { "size": 32, "lh": 1.4, "ls": 0.5, "weight": 500, "italic": false, "upper": false, "font": "sans" }, "caption": { "size": 24, "lh": 1.4, "ls": 0.5, "weight": 400, "italic": false, "upper": false, "font": "mono" } } } };

  const SAFE = 88; // margin kept clear of text, in slide pixels

  /* ------------------------------------------------------------------ helpers */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function hexToRgb(c) {
    if (!c) return [0, 0, 0];
    const m = String(c).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.replace(/./g, (x) => x + x);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const r = String(c).match(/rgba?\(([^)]+)\)/);
    if (r) return r[1].split(',').slice(0, 3).map((x) => parseFloat(x));
    return [0, 0, 0];
  }
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    if (!r) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ text */

  const ROLES = ['eyebrow', 'title', 'body', 'caption'];

  // The style a text layer is drawn with: the theme's style for its role,
  // with anything set on the layer taking precedence.
  function textStyle(layer, theme) {
    const t = theme.type[layer.role] || theme.type.body;
    const pick = (k, d) => (layer[k] !== undefined && layer[k] !== null ? layer[k] : d);
    return {
      size: pick('size', t.size),
      lh: pick('lh', t.lh),
      ls: pick('ls', t.ls),
      weight: pick('weight', t.weight),
      italic: pick('italic', !!t.italic),
      upper: pick('upper', !!t.upper),
      font: pick('font', t.font),
      color: pick('color', theme.colors[layer.role] || theme.colors.body),
      align: pick('align', theme.align),
      shadow: pick('shadow', theme.shadow),
    };
  }

  const fontString = (st) => `${st.italic ? 'italic ' : ''}${st.weight} ${st.size}px ${FONTS[st.font] || FONTS.sans}`;

  let measureCtx = null;
  function mctx() {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    return measureCtx;
  }
  const HAS_LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

  function setFont(ctx, st) {
    ctx.font = fontString(st);
    if (HAS_LS) ctx.letterSpacing = `${st.ls}px`;
  }
  function widthOf(ctx, s, st) {
    const w = ctx.measureText(s).width;
    return HAS_LS ? w : w + Math.max(0, s.length - 1) * st.ls;
  }

  // Lines of a text layer, wrapped to its width. Cached by content and style.
  const layoutCache = new Map();
  function textLayout(layer, theme) {
    const st = textStyle(layer, theme);
    const text = st.upper ? String(layer.text || '').toUpperCase() : String(layer.text || '');
    const key = JSON.stringify([text, layer.w, st.size, st.weight, st.italic, st.font, st.ls, st.lh]);
    let hit = layoutCache.get(key);
    if (hit) return { ...hit, st };
    const ctx = mctx();
    setFont(ctx, st);
    const lines = [];
    const max = Math.max(10, layer.w);
    for (const para of text.split('\n')) {
      const words = para.split(/ +/);
      let line = '';
      for (const word of words) {
        const tryLine = line ? line + ' ' + word : word;
        if (!line || widthOf(ctx, tryLine, st) <= max) {
          line = tryLine;
          // a single word longer than the box: break it
          while (widthOf(ctx, line, st) > max && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && widthOf(ctx, line.slice(0, cut), st) > max) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        } else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    const lineH = st.size * st.lh;
    hit = { lines, lineH, h: Math.max(lineH, lines.length * lineH), widths: lines.map((l) => widthOf(ctx, l, st)) };
    if (layoutCache.size > 400) layoutCache.clear();
    layoutCache.set(key, hit);
    return { ...hit, st };
  }

  function drawText(ctx, layer, theme) {
    const lay = textLayout(layer, theme);
    const st = lay.st;
    const pad = layer.plate ? Math.round(st.size * 0.45) : 0;
    if (layer.plate) {
      ctx.save();
      ctx.globalAlpha = layer.plate.alpha ?? 0.85;
      ctx.fillStyle = layer.plate.color || '#000';
      roundRect(ctx, layer.x - pad, layer.y - pad, layer.w + pad * 2, lay.h + pad * 2, Math.round(st.size * 0.3));
      ctx.fill();
      ctx.restore();
    }
    setFont(ctx, st);
    ctx.fillStyle = st.color;
    ctx.textBaseline = 'alphabetic';
    if (st.shadow > 0 && !layer.plate) {
      ctx.shadowColor = `rgba(0,0,0,${clamp(st.shadow, 0, 1) * 0.75})`;
      ctx.shadowBlur = st.size * 0.35 * (0.5 + st.shadow);
      ctx.shadowOffsetY = st.size * 0.04;
    }
    // baseline: centre the font's em box in the line
    const base = st.size * 0.8 + (lay.lineH - st.size) / 2;
    lay.lines.forEach((line, i) => {
      const w = lay.widths[i];
      const x = st.align === 'center' ? layer.x + (layer.w - w) / 2 : st.align === 'right' ? layer.x + layer.w - w : layer.x;
      const y = layer.y + i * lay.lineH + base;
      if (HAS_LS || !st.ls) ctx.fillText(line, x, y);
      else {
        let cx = x;
        for (const ch of line) {
          ctx.fillText(ch, cx, y);
          cx += ctx.measureText(ch).width + st.ls;
        }
      }
    });
    if (HAS_LS) ctx.letterSpacing = '0px';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  /* ------------------------------------------------------------------ images */

  // Decoded pictures, capped at 3240 px on the long edge (3× the slide width
  // is plenty, even zoomed in), then rotated / adjusted versions of them.
  const MAX_EDGE = 3240;
  const sources = new Map(); // asset id -> { bmp, w, h } | Promise
  const adjusted = new Map(); // key -> canvas
  let onReady = null; // called when a picture finishes decoding

  function setSource(id, bmp) {
    let w = bmp.width;
    let h = bmp.height;
    const s = Math.min(1, MAX_EDGE / Math.max(w, h));
    if (s < 1) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * s);
      c.height = Math.round(h * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      bmp = c;
      w = c.width;
      h = c.height;
    }
    sources.set(id, { bmp, w, h });
    for (const k of adjusted.keys()) if (k.startsWith(id + '|')) adjusted.delete(k);
  }

  // `load(id)` returns a Blob for the asset (from the server or IndexedDB).
  async function ensure(id, load) {
    const have = sources.get(id);
    if (have && !(have instanceof Promise)) return have;
    if (have) return have;
    const p = (async () => {
      const blob = await load(id);
      let bmp;
      try {
        bmp = await createImageBitmap(blob);
      } catch {
        // SVG and some formats only decode through <img>
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = document.createElement('canvas');
          const scale = img.naturalWidth < 1200 && /svg/.test(blob.type) ? 2400 / Math.max(img.naturalWidth, img.naturalHeight, 1) : 1;
          c.width = Math.max(1, Math.round((img.naturalWidth || 1200) * scale));
          c.height = Math.max(1, Math.round((img.naturalHeight || 900) * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          bmp = c;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      setSource(id, bmp);
      if (onReady) onReady(id);
      return sources.get(id);
    })();
    sources.set(id, p);
    p.catch(() => sources.delete(id));
    return p;
  }

  const ready = (id) => {
    const s = sources.get(id);
    return s && !(s instanceof Promise) ? s : null;
  };

  // Brightness, contrast, saturation, warmth (each −100…100), quarter turns
  // and mirroring, baked into a canvas once per setting. On screen this runs
  // after the frame that asked for it, at up to 2000 px (the stage shows the
  // last version until then), so keys and sliders never wait for it; exports
  // ask for the full-size version and get it straight away.
  const PREVIEW_EDGE = 2000;
  const pending = new Set();
  const lastPic = new Map(); // layer id -> the last picture drawn for it

  function bake(src, layer, maxEdge) {
    const a = layer.adj || {};
    const turns = ((layer.turn || 0) % 4 + 4) % 4;
    const flat = !a.b && !a.c && !a.s && !a.t;
    const k = Math.min(1, maxEdge / Math.max(src.w, src.h));
    const sw = Math.round(src.w * k);
    const sh = Math.round(src.h * k);
    const c = document.createElement('canvas');
    c.width = turns % 2 ? sh : sw;
    c.height = turns % 2 ? sw : sh;
    const x = c.getContext('2d', { willReadFrequently: !flat });
    x.save();
    x.translate(c.width / 2, c.height / 2);
    x.rotate((turns * Math.PI) / 2);
    if (layer.flip) x.scale(-1, 1);
    x.drawImage(src.bmp, -sw / 2, -sh / 2, sw, sh);
    x.restore();
    if (!flat) {
      const img = x.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      const br = (a.b || 0) * 1.28; // ±128 levels
      const ct = (a.c || 0) / 100;
      const cf = ct >= 0 ? 1 + ct * 1.5 : 1 + ct * 0.9;
      const sat = 1 + (a.s || 0) / 100;
      const warm = (a.t || 0) * 0.3;
      for (let i = 0; i < d.length; i += 4) {
        let r = (d[i] + br + warm - 128) * cf + 128;
        let g = (d[i + 1] + br - 128) * cf + 128;
        let b = (d[i + 2] + br - warm - 128) * cf + 128;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = l + (r - l) * sat;
        d[i + 1] = l + (g - l) * sat;
        d[i + 2] = l + (b - l) * sat;
      }
      x.putImageData(img, 0, 0);
    }
    return { bmp: c, w: c.width, h: c.height };
  }

  function picture(layer, full) {
    const src = ready(layer.asset);
    if (!src) return null;
    const a = layer.adj || {};
    const turns = ((layer.turn || 0) % 4 + 4) % 4;
    if (!a.b && !a.c && !a.s && !a.t && !turns && !layer.flip) return src;
    const key = `${layer.asset}|${turns}|${layer.flip ? 1 : 0}|${a.b || 0}|${a.c || 0}|${a.s || 0}|${a.t || 0}|${full ? 'F' : 'P'}`;
    let hit = adjusted.get(key);
    if (!hit && full) {
      hit = bake(src, layer, Infinity);
      remember(key, hit);
    }
    if (hit) {
      lastPic.set(layer.id, hit);
      return hit;
    }
    if (!pending.has(key)) {
      pending.add(key);
      const snapshot = { ...layer, adj: { ...a } };
      setTimeout(() => {
        pending.delete(key);
        if (ready(layer.asset)) remember(key, bake(src, snapshot, PREVIEW_EDGE));
        if (onReady) onReady(layer.asset);
      }, 0);
    }
    return lastPic.get(layer.id) || src;
  }
  function remember(key, pic) {
    if (adjusted.size > 24) adjusted.delete(adjusted.keys().next().value);
    adjusted.set(key, pic);
  }

  // Where the picture sits inside its frame: `zoom` scales from cover (or
  // fit), `px` `py` is the point of the picture at the frame's centre,
  // clamped so a covering picture never shows a gap.
  function placement(layer, pw, ph) {
    const base = layer.fit === 'contain' ? Math.min(layer.w / pw, layer.h / ph) : Math.max(layer.w / pw, layer.h / ph);
    const s = base * (layer.zoom || 1);
    const dw = pw * s;
    const dh = ph * s;
    const cx = (layer.px ?? 0.5) * dw;
    const cy = (layer.py ?? 0.5) * dh;
    let ox = layer.w / 2 - cx;
    let oy = layer.h / 2 - cy;
    ox = dw >= layer.w ? clamp(ox, layer.w - dw, 0) : (layer.w - dw) / 2;
    oy = dh >= layer.h ? clamp(oy, layer.h - dh, 0) : (layer.h - dh) / 2;
    return { x: layer.x + ox, y: layer.y + oy, w: dw, h: dh, s };
  }

  function drawImage(ctx, layer, full) {
    const pic = picture(layer, full);
    const pad = layer.card ? layer.card.pad ?? 24 : 0;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.card) {
      ctx.fillStyle = layer.card.color || '#ffffff';
      roundRect(ctx, layer.x - pad, layer.y - pad, layer.w + pad * 2, layer.h + pad * 2, (layer.radius || 0) + pad * 0.5);
      ctx.fill();
    }
    roundRect(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius || 0);
    ctx.clip();
    if (!pic) {
      // still decoding: a quiet placeholder
      ctx.fillStyle = 'rgba(128,128,128,0.25)';
      ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    } else {
      const p = placement(layer, pic.w, pic.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pic.bmp, p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ shade, logo */

  function drawShade(ctx, layer, theme, W, H) {
    const k = layer.strength ?? 1;
    if (k <= 0) return;
    ctx.save();
    const [tc, ta, tb] = theme.tint;
    ctx.globalCompositeOperation = tb;
    ctx.globalAlpha = clamp(ta * k, 0, 1);
    ctx.fillStyle = tc;
    ctx.fillRect(0, 0, W, H);
    const D = Math.max(W, H);
    for (const g of theme.layers) {
      let grad;
      let blend;
      let op;
      let stops;
      if (g[0] === 'r') {
        const [, cx, cy, r, b, o, s] = g;
        grad = ctx.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, r * D);
        blend = b;
        op = o;
        stops = s;
      } else {
        const [, angle, b, o, s] = g;
        const rad = (angle * Math.PI) / 180;
        const dx = Math.sin(rad);
        const dy = -Math.cos(rad);
        const half = (Math.abs(Math.sin(rad)) * W + Math.abs(Math.cos(rad)) * H) / 2;
        grad = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
        blend = b;
        op = o;
        stops = s;
      }
      for (const [o2, c] of stops) grad.addColorStop(o2, c);
      ctx.globalCompositeOperation = blend;
      ctx.globalAlpha = clamp(op * k, 0, 1);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  const logos = {};
  function logoImage(variant) {
    if (!logos[variant]) {
      const img = new Image();
      img.src = `img/logo-${variant}.png`;
      logos[variant] = img;
      img.decode().then(() => onReady && onReady('logo'), () => {});
    }
    const img = logos[variant];
    return img.complete && img.naturalWidth ? img : null;
  }
  const LOGO_RATIO = 453 / 557;
  async function logosReady() {
    for (const v of ['light', 'dark']) {
      logoImage(v);
      try {
        await logos[v].decode();
      } catch {}
    }
  }

  function drawLogo(ctx, layer, theme) {
    const img = logoImage(layer.variant || theme.logo);
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(img, layer.x, layer.y, layer.h * LOGO_RATIO, layer.h);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ geometry */

  // The box a layer occupies (before rotation), in slide pixels.
  function bounds(layer, theme, W, H) {
    if (layer.kind === 'shade') return { x: 0, y: 0, w: W, h: H };
    if (layer.kind === 'logo') return { x: layer.x, y: layer.y, w: layer.h * LOGO_RATIO, h: layer.h };
    if (layer.kind === 'text') return { x: layer.x, y: layer.y, w: layer.w, h: textLayout(layer, theme).h };
    return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
  }

  function withRotation(ctx, layer, b, fn) {
    if (!layer.rot) return fn();
    ctx.save();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    fn();
    ctx.restore();
  }

  // Slide point -> the layer's own (unrotated) frame.
  function toLocal(layer, b, x, y) {
    if (!layer.rot) return [x, y];
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const a = (-layer.rot * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  // The topmost layer under a slide point (shades are never picked).
  function layerAt(doc, slide, x, y) {
    const theme = themeOf(doc);
    const { w: W, h: H } = sizeOf(doc);
    for (let i = slide.layers.length - 1; i >= 0; i--) {
      const l = slide.layers[i];
      if (l.kind === 'shade' || l.hidden) continue;
      const b = bounds(l, theme, W, H);
      const [lx, ly] = toLocal(l, b, x, y);
      const pad = l.kind === 'text' ? 12 : 0;
      if (lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad) return l;
    }
    return null;
  }

  /* ------------------------------------------------------------------ the slide */

  const themeOf = (doc) => THEMES[doc.theme] || THEMES.editorial;
  const sizeOf = (doc) => SIZES[doc.size] || SIZES.portrait;

  // Draw `slide` into `ctx` (already sized to W*scale × H*scale).
  // opts.skip(layer) leaves layers out (the contrast check renders the
  // backdrop without the text).
  function drawSlide(ctx, doc, slide, scale = 1, opts = {}) {
    const theme = opts.theme || themeOf(doc);
    const { w: W, h: H } = sizeOf(doc);
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = slide.bg || theme.base;
    ctx.fillRect(0, 0, W, H);
    for (const layer of slide.layers) {
      if (layer.hidden || (opts.skip && opts.skip(layer))) continue;
      const b = bounds(layer, theme, W, H);
      withRotation(ctx, layer, b, () => {
        if (layer.kind === 'image') drawImage(ctx, layer, opts.full);
        else if (layer.kind === 'shade') drawShade(ctx, layer, theme, W, H);
        else if (layer.kind === 'text') drawText(ctx, layer, theme);
        else if (layer.kind === 'logo') drawLogo(ctx, layer, theme);
      });
    }
    ctx.restore();
  }

  // Everything a slide needs, decoded (before exporting).
  async function slideReady(doc, slide, load) {
    await logosReady();
    await Promise.all(slide.layers.filter((l) => l.kind === 'image').map((l) => ensure(l.asset, load).catch(() => null)));
  }

  // WCAG "large text" is 24 px, or 18.7 px bold, as read. A 1080 px slide
  // shows about 390 px wide on a phone, so scale by 0.36.
  const isLarge = (st) => st.size * 0.36 >= 24 || (st.size * 0.36 >= 18.66 && st.weight >= 700);

  // WCAG contrast of a text layer against what is behind it: the slide is
  // drawn small without the text, and the backdrop under the text's box
  // averaged (in linear light).
  function textContrast(doc, slide, layer) {
    const theme = themeOf(doc);
    const { w: W, h: H } = sizeOf(doc);
    const scale = 0.25;
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    const x = c.getContext('2d', { willReadFrequently: true });
    drawSlide(x, doc, slide, scale, { skip: (l) => l.kind === 'text' || l.kind === 'logo' });
    const b = bounds(layer, theme, W, H);
    const st = textStyle(layer, theme);
    let bgLum;
    if (layer.plate) bgLum = luminance(hexToRgb(layer.plate.color));
    else {
      const sx = clamp(Math.floor(b.x * scale), 0, c.width - 1);
      const sy = clamp(Math.floor(b.y * scale), 0, c.height - 1);
      const sw = clamp(Math.ceil(b.w * scale), 1, c.width - sx);
      const sh = clamp(Math.ceil(b.h * scale), 1, c.height - sy);
      const d = x.getImageData(sx, sy, sw, sh).data;
      let sum = 0;
      let worst = null;
      const fgL = luminance(hexToRgb(st.color));
      for (let i = 0; i < d.length; i += 4) {
        const l = luminance([d[i], d[i + 1], d[i + 2]]);
        sum += l;
        // the lowest-contrast pixel, for the "worst case" figure
        if (worst === null || contrast(fgL, l) < contrast(fgL, worst)) worst = l;
      }
      bgLum = sum / (d.length / 4);
      return { ratio: contrast(fgL, bgLum), worst: contrast(fgL, worst), large: isLarge(st) };
    }
    const fgL = luminance(hexToRgb(st.color));
    return { ratio: contrast(fgL, bgLum), worst: contrast(fgL, bgLum), large: isLarge(st) };
  }

  window.Render = {
    SIZES,
    THEMES,
    FONTS,
    SAFE,
    ROLES,
    LOGO_RATIO,
    drawSlide,
    slideReady,
    ensure,
    ready,
    setSource,
    textLayout,
    textStyle,
    textContrast,
    bounds,
    toLocal,
    layerAt,
    placement,
    picture,
    themeOf,
    sizeOf,
    logosReady,
    set onReady(fn) {
      onReady = fn;
    },
  };
})();
