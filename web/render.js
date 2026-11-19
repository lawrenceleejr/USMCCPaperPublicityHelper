/* USMCC Publicity Helper: the slide renderer.

   One function draws a slide onto a canvas, at any scale. The editor's stage,
   the slide strip, the theme previews and the exported JPEG/PNG files all use
   it, so what you see is exactly what gets saved.

   A slide shows its window of the carousel's backdrop (the theme's
   gradient and light, one piece across all the slides) and of the
   carousel's background pictures (doc.bg, in carousel coordinates: a
   figure can run behind several slides), then its own layers, in order:
     image  a photo, plot or PDF page in a frame (cover or fit, pan and zoom
            inside the frame, light adjustments, rounded corners, a card behind)
     text   eyebrow / title / body / caption, styled by the theme unless
            overridden on the layer
     logo   the USMCC mark
   ("shade" layers from the first version are no longer drawn: the
   backdrop does their work, without seams.)
   Coordinates are slide pixels: every slide is 1080 wide. */

(function () {
  'use strict';

  const SIZES = {
    portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', note: 'Instagram, LinkedIn' },
    square: { w: 1080, h: 1080, label: 'Square 1:1', note: 'Instagram, X, Bluesky' },
    story: { w: 1080, h: 1920, label: 'Story 9:16', note: 'Stories, Reels' },
  };

  // Typefaces from Google Fonts, kept in web/fonts (fonts.css), each with a
  // system fallback. `sans` `serif` `mono` are older names, still read.
  const SYS_SANS = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
  const SYS_SERIF = '"Iowan Old Style", Palatino, Georgia, serif';
  const SYS_MONO = 'ui-monospace, Menlo, Consolas, monospace';
  const FONT_LIST = [
    ['inter', 'Inter', `"Inter", ${SYS_SANS}`],
    ['manrope', 'Manrope', `"Manrope", ${SYS_SANS}`],
    ['instrument', 'Instrument Serif', `"Instrument Serif", ${SYS_SERIF}`],
    ['sourceserif', 'Source Serif', `"Source Serif 4", ${SYS_SERIF}`],
    ['plex', 'IBM Plex Sans', `"IBM Plex Sans", ${SYS_SANS}`],
    ['anton', 'Anton', `"Anton", Impact, ${SYS_SANS}`],
    ['fraunces', 'Fraunces', `"Fraunces", ${SYS_SERIF}`],
    ['newsreader', 'Newsreader', `"Newsreader", ${SYS_SERIF}`],
    ['plexmono', 'IBM Plex Mono', `"IBM Plex Mono", ${SYS_MONO}`],
  ];
  const FONTS = Object.fromEntries(FONT_LIST.map(([k, , stack]) => [k, stack]));
  FONTS.sans = FONTS.inter;
  FONTS.serif = FONTS.newsreader;
  FONTS.mono = FONTS.plexmono;
  FONTS.bricolage = FONTS.inter; // a face the first themes used

  // The looks. A theme's backdrop is one piece across the whole carousel:
  // `flow` is a gradient from the first slide's left edge to the last one's
  // right edge, with `glow`s of light travelling along it (and a blueprint
  // `grid`), so the panes join without seams when swiped. Figures used as
  // backgrounds get the theme's `treat`ment: `ink` (the plot inverted, its
  // colours kept, its lines glowing on the dark), `print` (the white of the
  // plot dropped into the paper) or `duotone` (in the theme's two colours).
  const T = (font, size, lh, ls, weight, o = {}) => ({ font, size, lh, ls, weight, italic: !!o.italic, upper: !!o.upper });
  const THEMES = {
    midnight: {
      name: 'Midnight', base: '#07111f', dark: true, treat: 'ink', duo: ['#06101d', '#a9cdfa'],
      flow: { angle: 100, stops: [[0, '#050d19'], [0.5, '#0a1c31'], [1, '#061624']], glow: { colors: ['rgba(70,140,255,0.34)', 'rgba(56,189,248,0.22)'], every: 1.35, r: 0.95, ys: [0.1, 0.95] } },
      align: 'left', valign: 'bottom', logo: 'light', shadow: 0.35, fit: 4, rule: true,
      colors: { eyebrow: '#8ec5ff', title: '#f4f7fb', body: '#d5dde7', caption: '#9db0c4' },
      type: { eyebrow: T('plexmono', 26, 1.2, 3, 500, { upper: true }), title: T('instrument', 124, 1.0, -0.5, 400), body: T('sourceserif', 46, 1.38, -0.2, 400), caption: T('inter', 30, 1.35, 0, 500) },
    },
    paper: {
      name: 'Paper', base: '#f3f4f6', dark: false, treat: 'print', duo: ['#14233a', '#f3f4f6'],
      flow: { angle: 90, stops: [[0, '#f8f9fb'], [1, '#e9edf2']] },
      align: 'left', valign: 'bottom', logo: 'dark', shadow: 0, fit: 4, rule: true,
      colors: { eyebrow: '#1f4fd1', title: '#0d1015', body: '#262b32', caption: '#5a6370' },
      type: { eyebrow: T('inter', 26, 1.2, 4, 650, { upper: true }), title: T('newsreader', 112, 1.02, -1.5, 500), body: T('newsreader', 48, 1.36, -0.2, 400), caption: T('inter', 30, 1.35, 0, 500) },
    },
    blueprint: {
      name: 'Blueprint', base: '#0a2340', dark: true, treat: 'ink', duo: ['#0a2340', '#bfe3ff'],
      flow: { angle: 95, stops: [[0, '#0c2a4c'], [1, '#081c35']], glow: { colors: ['rgba(130,205,255,0.16)'], every: 1.8, r: 1.1, ys: [0.3, 0.8] }, grid: { minor: 54, major: 270, color: 'rgba(170,215,255,0.07)', majorColor: 'rgba(170,215,255,0.15)' } },
      align: 'left', valign: 'top', logo: 'light', shadow: 0.25, fit: 4, rule: true,
      colors: { eyebrow: '#9fdcff', title: '#ffffff', body: '#dbe9f7', caption: '#9fbad6' },
      type: { eyebrow: T('plexmono', 26, 1.2, 2, 500, { upper: true }), title: T('plex', 100, 1.04, -1.5, 600), body: T('plex', 44, 1.42, -0.3, 400), caption: T('plexmono', 28, 1.4, 0, 400) },
    },
    ink: {
      name: 'Ink', base: '#0b0b0c', dark: true, treat: 'ink', duo: ['#0b0b0c', '#e4e4e7'],
      flow: { angle: 100, stops: [[0, '#0a0a0b'], [0.5, '#121315'], [1, '#0a0a0b']], glow: { colors: ['rgba(255,255,255,0.07)'], every: 1.6, r: 1.0, ys: [0.2, 0.85] } },
      align: 'left', valign: 'bottom', logo: 'light', shadow: 0.35, fit: 4, rule: true,
      colors: { eyebrow: '#b8c2cc', title: '#ffffff', body: '#d4d4d8', caption: '#8b8b93' },
      type: { eyebrow: T('inter', 26, 1.2, 6, 600, { upper: true }), title: T('fraunces', 108, 1.02, -1, 500), body: T('inter', 44, 1.42, -0.3, 400), caption: T('inter', 30, 1.35, 0, 500) },
    },
    glacier: {
      name: 'Glacier', base: '#eaf2fb', dark: false, treat: 'print', duo: ['#0b2a4f', '#eaf2fb'],
      flow: { angle: 110, stops: [[0, '#f7fbff'], [0.5, '#e5effa'], [1, '#d9e8f6']], glow: { colors: ['rgba(255,255,255,0.85)', 'rgba(150,195,240,0.40)'], every: 1.5, r: 0.9, ys: [0.08, 0.95] } },
      align: 'left', valign: 'bottom', logo: 'dark', shadow: 0, fit: 4, rule: false,
      colors: { eyebrow: '#1d5fa8', title: '#0b1f38', body: '#1d3250', caption: '#4c6481' },
      type: { eyebrow: T('manrope', 26, 1.2, 4, 700, { upper: true }), title: T('manrope', 100, 1.04, -2.5, 700), body: T('manrope', 44, 1.42, -0.3, 500), caption: T('manrope', 30, 1.35, 0, 600) },
    },
    signal: {
      name: 'Signal', base: '#000000', dark: true, treat: 'ink', duo: ['#000000', '#7fb6ff'],
      flow: { angle: 100, stops: [[0, '#000000'], [1, '#03060c']], glow: { colors: ['rgba(0,90,220,0.55)', 'rgba(0,140,255,0.30)'], every: 1.3, r: 0.85, ys: [0.92, 0.12] } },
      align: 'left', valign: 'top', logo: 'light', shadow: 0.3, fit: 4, rule: false,
      colors: { eyebrow: '#62adff', title: '#ffffff', body: '#e4e7ec', caption: '#9aa3af' },
      type: { eyebrow: T('inter', 30, 1.2, 6, 800, { upper: true }), title: T('anton', 128, 1.02, 0.5, 400), body: T('inter', 46, 1.38, -0.2, 500), caption: T('inter', 32, 1.35, 0, 600) },
    },
  };
  // Pull quotes: the words in the theme's reading voice (an italic serif),
  // under a large open quotation mark in the accent colour. [style, mark face, mark weight]
  const QUOTES = {
    midnight: [T('instrument', 76, 1.14, -0.3, 400, { italic: true }), 'instrument', 400],
    paper: [T('newsreader', 66, 1.22, -0.6, 400, { italic: true }), 'newsreader', 400],
    blueprint: [T('plex', 58, 1.32, -0.5, 400, { italic: true }), 'fraunces', 400],
    ink: [T('fraunces', 66, 1.2, -0.6, 400, { italic: true }), 'fraunces', 400],
    glacier: [T('newsreader', 64, 1.22, -0.4, 400, { italic: true }), 'newsreader', 400],
    signal: [T('inter', 58, 1.26, -0.8, 600), 'fraunces', 650],
  };
  for (const [k, [st, face, weight]] of Object.entries(QUOTES)) {
    THEMES[k].type.quote = st;
    THEMES[k].colors.quote = THEMES[k].colors.title;
    THEMES[k].mark = { font: face, weight };
  }
  // carousels made with the first themes open in their nearest new one
  const LEGACY = { editorial: 'ink', bold_sans: 'midnight', punch: 'signal', ocean: 'blueprint', soft_serif: 'paper', minimal_mono: 'glacier' };

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

  const ROLES = ['eyebrow', 'title', 'body', 'caption', 'quote'];

  // The style a text layer is drawn with: the theme's style for its role,
  // with anything set on the layer taking precedence.
  function textStyle(layer, theme) {
    const t = theme.type[layer.role] || theme.type.body;
    const pick = (k, d) => (layer[k] !== undefined && layer[k] !== null ? layer[k] : d);
    return {
      size: pick('size', Math.round(t.size * (layer.k || 1))),
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
    const mk = layer.role === 'quote' && layer.mark !== false ? theme.mark || { font: 'fraunces', weight: 400 } : null;
    const key = JSON.stringify([text, layer.w, st.size, st.weight, st.italic, st.font, st.ls, st.lh, mk]);
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
    hit = { lines, lineH, h: Math.max(lineH, lines.length * lineH), widths: lines.map((l) => widthOf(ctx, l, st)), top: 0, mark: null };
    if (mk) {
      // the mark's ink sits on the box's top edge; the words start below it
      const font = `${mk.weight} ${Math.round(st.size * 3.1)}px ${FONTS[mk.font] || FONTS.serif}`;
      ctx.font = font;
      if (HAS_LS) ctx.letterSpacing = '0px';
      const m = ctx.measureText('\u201C');
      const asc = m.actualBoundingBoxAscent || st.size * 2.2;
      const ink = asc + (m.actualBoundingBoxDescent || -st.size * 1.1);
      const left = m.actualBoundingBoxLeft || 0;
      hit.mark = { font, asc, left, w: left + (m.actualBoundingBoxRight || m.width) };
      hit.top = Math.round(ink + st.size * 0.3);
      hit.h += hit.top;
    }
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
    if (layer.role === 'eyebrow' && theme.rule && !layer.plate && layer.rule !== false) {
      // a hairline above the eyebrow, as in a journal
      const w = Math.min(84, layer.w);
      const x = st.align === 'center' ? layer.x + (layer.w - w) / 2 : st.align === 'right' ? layer.x + layer.w - w : layer.x;
      ctx.fillStyle = st.color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, layer.y - Math.round(st.size * 0.75), w, 2);
      ctx.globalAlpha = 1;
    }
    setFont(ctx, st);
    ctx.fillStyle = st.color;
    ctx.textBaseline = 'alphabetic';
    if (st.shadow > 0 && !layer.plate) {
      ctx.shadowColor = `rgba(0,0,0,${clamp(st.shadow, 0, 1) * 0.75})`;
      ctx.shadowBlur = st.size * 0.35 * (0.5 + st.shadow);
      ctx.shadowOffsetY = st.size * 0.04;
    }
    if (lay.mark) {
      const mk = lay.mark;
      const x = st.align === 'center' ? layer.x + (layer.w - mk.w) / 2 : st.align === 'right' ? layer.x + layer.w - mk.w : layer.x;
      ctx.save();
      ctx.font = mk.font;
      if (HAS_LS) ctx.letterSpacing = '0px';
      ctx.fillStyle = layer.markColor || theme.colors.eyebrow;
      ctx.fillText('\u201C', x + mk.left, layer.y + mk.asc);
      ctx.restore();
    }
    // baseline: centre the font's em box in the line
    const base = lay.top + st.size * 0.8 + (lay.lineH - st.size) / 2;
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

  // The turned / mirrored picture on a canvas, and (with adjustments) its
  // pixels to adjust; adjustRows does `n` rows of them.
  const PIXEL_TREATS = { ink: 1, duotone: 1, mono: 1 };
  // How a picture is drawn: a background by its treatment (or the theme's);
  // a picture on a slide by its `look`, where "auto" (plots and diagrams on
  // white) follows the theme: glowing on dark slides, printed on light ones.
  function treatOf(layer, theme) {
    if (layer.bg) return layer.treat || (theme && theme.treat) || 'natural';
    if (layer.look === 'auto') return theme && theme.dark ? 'ink' : 'print';
    return layer.look || 'natural';
  }
  function bakeStart(src, layer, maxEdge, theme) {
    const a = layer.adj || {};
    const turns = ((layer.turn || 0) % 4 + 4) % 4;
    const treat = treatOf(layer, theme);
    const dim = clamp(layer.dim || 0, 0, 0.9);
    const flat = !a.b && !a.c && !a.s && !a.t && !PIXEL_TREATS[treat] && !dim;
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
    const job = { c, x, row: 0, img: null, blur: layer.blur || 0 };
    if (!flat) {
      job.img = x.getImageData(0, 0, c.width, c.height);
      const ct = (a.c || 0) / 100;
      job.p = { br: (a.b || 0) * 1.28, cf: ct >= 0 ? 1 + ct * 1.5 : 1 + ct * 0.9, sat: 1 + (a.s || 0) / 100, warm: (a.t || 0) * 0.3 };
      job.treat = treat;
      const duo = (theme && theme.duo) || ['#000000', '#ffffff'];
      job.d0 = hexToRgb(duo[0]);
      job.d1 = hexToRgb(duo[1]);
      job.inv = !!(theme && theme.dark); // on a dark slide a plot's white becomes the dark
      // darkening, done to the pixels so a picture that covers only part of
      // the carousel shows no edge: lighter light for a picture screened
      // onto the dark, a fainter print for one multiplied into the paper
      job.dim = dim;
      job.dimUp = treat === 'print';
    }
    return job;
  }
  function adjustRows(job, n) {
    const { img, p } = job;
    const d = img.data;
    const end = Math.min(img.height, job.row + n);
    for (let i = job.row * img.width * 4, e = end * img.width * 4; i < e; i += 4) {
      const r = (d[i] + p.br + p.warm - 128) * p.cf + 128;
      const g = (d[i + 1] + p.br - 128) * p.cf + 128;
      const b = (d[i + 2] + p.br - p.warm - 128) * p.cf + 128;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      let R0 = l + (r - l) * p.sat;
      let G0 = l + (g - l) * p.sat;
      let B0 = l + (b - l) * p.sat;
      if (job.treat === 'ink') {
        // inverted, then the hue turned back: white paper goes black, a blue
        // line stays blue but light
        const ri = 255 - R0;
        const gi = 255 - G0;
        const bi = 255 - B0;
        R0 = -0.574 * ri + 1.43 * gi + 0.144 * bi;
        G0 = 0.426 * ri + 0.43 * gi + 0.144 * bi;
        B0 = 0.426 * ri + 1.43 * gi - 0.856 * bi;
      } else if (job.treat === 'duotone' || job.treat === 'mono') {
        let t = (0.2126 * R0 + 0.7152 * G0 + 0.0722 * B0) / 255;
        if (job.inv) t = 1 - t;
        t = Math.max(0, Math.min(1, t));
        if (job.treat === 'mono') R0 = G0 = B0 = t * 255;
        else {
          R0 = job.d0[0] + (job.d1[0] - job.d0[0]) * t;
          G0 = job.d0[1] + (job.d1[1] - job.d0[1]) * t;
          B0 = job.d0[2] + (job.d1[2] - job.d0[2]) * t;
        }
      }
      if (job.dim) {
        const f = 1 - job.dim;
        if (job.dimUp) {
          R0 = 255 - (255 - R0) * f;
          G0 = 255 - (255 - G0) * f;
          B0 = 255 - (255 - B0) * f;
        } else {
          R0 *= f;
          G0 *= f;
          B0 *= f;
        }
      }
      d[i] = R0;
      d[i + 1] = G0;
      d[i + 2] = B0;
    }
    job.row = end;
    return end >= img.height;
  }
  const bakeEnd = (job) => {
    if (job.img) job.x.putImageData(job.img, 0, 0);
    const c = job.blur ? blurred(job.c, job.blur) : job.c;
    return { bmp: c, w: c.width, h: c.height };
  };
  // A real (Gaussian) blur that works in every browser: Safari's canvas has
  // no filter. Three box blurs approximate a Gaussian; they run on a copy
  // reduced only as far as the blur hides (so enlarging it back shows no
  // steps), with the edge pixels repeated so the borders don't darken. The
  // radius is a fraction of the picture's own width, so the preview and the
  // full-size export look the same. `amount` 0…30.
  const BLUR_AREA = 420000; // working pixels: a few milliseconds
  function blurred(src, amount) {
    const sigma = (amount / 30) * 0.045 * src.width; // up to 4.5% of the width
    if (sigma < 0.5) return src;
    // reduce so that sigma is still ≥ 3 working pixels, and the copy is small
    const k = Math.max(1, Math.min(sigma / 3, Math.sqrt((src.width * src.height) / BLUR_AREA)));
    let cur = src;
    const tw = Math.max(8, Math.round(src.width / k));
    while (cur.width / 2 >= tw) cur = scaled(cur, Math.round(cur.width / 2));
    cur = scaled(cur, tw);
    const x = cur.getContext('2d', { willReadFrequently: true });
    const img = x.getImageData(0, 0, cur.width, cur.height);
    gauss(img.data, cur.width, cur.height, sigma / (src.width / cur.width));
    x.putImageData(img, 0, 0);
    return cur;
  }
  // three box widths whose succession approximates a Gaussian of `sigma`
  function boxes(sigma) {
    const n = 3;
    const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
  }
  function gauss(d, w, h, sigma) {
    const tmp = new Uint8ClampedArray(d.length);
    for (const r of boxes(sigma)) {
      boxPass(d, tmp, w, h, Math.max(1, Math.round(r)), true);
      boxPass(tmp, d, w, h, Math.max(1, Math.round(r)), false);
    }
  }
  // one running-sum box blur along rows (horizontal) or columns, edges repeated
  function boxPass(src, dst, w, h, r, horizontal) {
    const lines = horizontal ? h : w;
    const len = horizontal ? w : h;
    const step = horizontal ? 4 : w * 4;
    const inv = 1 / (2 * r + 1);
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * w * 4 : line * 4;
      for (let c = 0; c < 4; c++) {
        const first = src[base + c];
        const last = src[base + (len - 1) * step + c];
        // the window [i - r, i + r] before its first step: r copies of the edge, then 0 … r-1
        let acc = first * r;
        for (let i = 0; i < r; i++) acc += src[base + Math.min(i, len - 1) * step + c];
        for (let i = 0; i < len; i++) {
          const add = i + r < len ? src[base + (i + r) * step + c] : last;
          acc += add;
          dst[base + i * step + c] = acc * inv;
          const sub = i - r >= 0 ? src[base + (i - r) * step + c] : first;
          acc -= sub;
        }
      }
    }
  }
  function scaled(src, w) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, Math.round((src.height * w) / src.width));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  // All at once (exports).
  function bake(src, layer, maxEdge, theme) {
    const job = bakeStart(src, layer, maxEdge, theme);
    if (job.img) adjustRows(job, Infinity);
    return bakeEnd(job);
  }
  // A few milliseconds at a time (on screen), so a key press always gets in.
  function bakeSoon(src, layer, maxEdge, theme, done) {
    setTimeout(() => {
      const job = bakeStart(src, layer, maxEdge, theme);
      if (!job.img) return done(bakeEnd(job));
      const step = () => {
        const t0 = performance.now();
        let rows = 16;
        while (performance.now() - t0 < 6) {
          if (adjustRows(job, rows)) return done(bakeEnd(job));
          rows = Math.min(rows * 2, 128);
        }
        setTimeout(step, 0);
      };
      step();
    }, 0);
  }

  function picture(layer, full, theme) {
    const src = ready(layer.asset);
    if (!src) return null;
    const a = layer.adj || {};
    const turns = ((layer.turn || 0) % 4 + 4) % 4;
    const treat = treatOf(layer, theme);
    const blur = layer.blur || 0;
    const dim = layer.dim || 0;
    if (!a.b && !a.c && !a.s && !a.t && !turns && !layer.flip && !PIXEL_TREATS[treat] && !blur && !dim) return src;
    const duo = theme && PIXEL_TREATS[treat] ? `${theme.duo}|${theme.dark}` : '';
    const key = `${layer.asset}|${turns}|${layer.flip ? 1 : 0}|${a.b || 0}|${a.c || 0}|${a.s || 0}|${a.t || 0}|${treat}|${duo}|${blur}|${dim}|${full ? 'F' : 'P'}`;
    let hit = adjusted.get(key);
    if (!hit && full) {
      hit = bake(src, { ...layer, blur }, Infinity, theme);
      remember(key, hit);
    }
    if (hit) {
      lastPic.set(layer.id, hit);
      return hit;
    }
    if (!pending.has(key)) {
      pending.add(key);
      const snapshot = { ...layer, adj: { ...a }, blur };
      bakeSoon(src, snapshot, PREVIEW_EDGE, theme, (pic) => {
        pending.delete(key);
        if (ready(layer.asset)) remember(key, pic);
        if (onReady) onReady(layer.asset);
      });
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

  const BLEND = { ink: 'screen', print: 'multiply' };
  function drawImage(ctx, layer, full, theme) {
    const pic = picture(layer, full, theme);
    const treat = treatOf(layer, theme);
    const card = layer.card && !layer.bg && treat === 'natural';
    const pad = card ? layer.card.pad ?? 24 : 0;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? (layer.bg ? 0.3 : 1);
    ctx.globalCompositeOperation = BLEND[treat] || 'source-over';
    if (card) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = layer.card.color || '#ffffff';
      roundRect(ctx, layer.x - pad, layer.y - pad, layer.w + pad * 2, layer.h + pad * 2, (layer.radius || 0) + pad * 0.5);
      ctx.fill();
      ctx.restore();
    }
    roundRect(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius || 0);
    ctx.clip();
    if (!pic) {
      // still decoding: a quiet placeholder
      ctx.fillStyle = 'rgba(128,128,128,0.25)';
      ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    } else if (layer.bg && (layer.fadeL || layer.fadeR)) {
      drawFaded(ctx, layer, pic);
    } else {
      const p = placement(layer, pic.w, pic.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pic.bmp, p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }

  // A background in a sequence melts into the next: its edges fade out over
  // `fadeL` / `fadeR` carousel pixels (an eased ramp). Drawn into a scratch
  // canvas the size of what this slide shows of it, masked, then laid on.
  let fadeCanvas = null;
  const EASE = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((t) => [t, t * t * (3 - 2 * t)]);
  function drawFaded(ctx, layer, pic) {
    const m = ctx.getTransform();
    const sx = Math.hypot(m.a, m.b) || 1;
    const sy = Math.hypot(m.c, m.d) || 1;
    const x0 = Math.max(layer.x, -m.e / sx);
    const x1 = Math.min(layer.x + layer.w, (ctx.canvas.width - m.e) / sx);
    const y0 = Math.max(layer.y, -m.f / sy);
    const y1 = Math.min(layer.y + layer.h, (ctx.canvas.height - m.f) / sy);
    if (x1 <= x0 || y1 <= y0) return;
    const ow = Math.max(1, Math.ceil((x1 - x0) * sx));
    const oh = Math.max(1, Math.ceil((y1 - y0) * sy));
    if (!fadeCanvas) fadeCanvas = document.createElement('canvas');
    const c = fadeCanvas;
    if (c.width < ow || c.height < oh) {
      c.width = Math.max(c.width, ow);
      c.height = Math.max(c.height, oh);
    }
    const f = c.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, ow, oh);
    f.setTransform(sx, 0, 0, sy, -x0 * sx, -y0 * sy);
    const p = placement(layer, pic.w, pic.h);
    f.imageSmoothingQuality = 'high';
    f.drawImage(pic.bmp, p.x, p.y, p.w, p.h);
    f.globalCompositeOperation = 'destination-in';
    const g = f.createLinearGradient(layer.x, 0, layer.x + layer.w, 0);
    const L = clamp((layer.fadeL || 0) / layer.w, 0, 0.5);
    const Rt = clamp((layer.fadeR || 0) / layer.w, 0, 0.5);
    if (L) for (const [t, a] of EASE) g.addColorStop(t * L, `rgba(0,0,0,${a})`);
    else g.addColorStop(0, '#000');
    if (Rt) for (const [t, a] of EASE) g.addColorStop(1 - Rt + t * Rt, `rgba(0,0,0,${1 - a})`);
    else g.addColorStop(1, '#000');
    f.fillStyle = g;
    f.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(c, 0, 0, ow, oh, x0, y0, x1 - x0, y1 - y0);
  }

  /* ------------------------------------------------------------------ shade, logo */

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

  /* ------------------------------------------------------------------ the backdrop */

  // The theme's backdrop for slide `i` of `n`: drawn as one piece n slides
  // wide and shifted, so neighbouring slides meet exactly.
  function drawBackdrop(ctx, theme, W, H, i, n) {
    const f = theme.flow;
    if (!f) return;
    const TW = W * n;
    ctx.save();
    ctx.translate(-i * W, 0);
    const rad = ((f.angle ?? 90) * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(dx) * TW + Math.abs(dy) * H) / 2;
    const g = ctx.createLinearGradient(TW / 2 - dx * half, H / 2 - dy * half, TW / 2 + dx * half, H / 2 + dy * half);
    for (const [o, c] of f.stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(i * W, 0, W, H);
    // light travelling along the carousel: one glow every `every` slides,
    // alternating between the heights in `ys`
    if (f.glow) {
      const gl = f.glow;
      const step = W * gl.every;
      const count = Math.ceil(TW / step) + 1;
      for (let k = -1; k < count; k++) {
        const cx = (k + 0.5) * step;
        if (cx + gl.r * W < i * W || cx - gl.r * W > (i + 1) * W) continue;
        const cy = gl.ys[((k % gl.ys.length) + gl.ys.length) % gl.ys.length] * H;
        const color = gl.colors[((k % gl.colors.length) + gl.colors.length) % gl.colors.length];
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gl.r * W);
        rg.addColorStop(0, color);
        rg.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
        ctx.fillStyle = rg;
        ctx.fillRect(i * W, 0, W, H);
      }
    }
    if (f.grid) {
      const gr = f.grid;
      ctx.lineWidth = 1.5;
      for (const [stepPx, color] of [
        [gr.minor, gr.color],
        [gr.major, gr.majorColor],
      ]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        // offset by half a small cell, so no line falls on a seam between slides
        const o = gr.minor / 2;
        for (let x = Math.ceil((i * W - o) / stepPx) * stepPx + o; x <= (i + 1) * W; x += stepPx) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, H);
        }
        for (let y = o; y <= H; y += stepPx) {
          ctx.moveTo(i * W, y + 0.5);
          ctx.lineTo((i + 1) * W, y + 0.5);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // "02 / 05", quietly, in the corner the words leave free.
  function drawFolio(ctx, theme, W, H, i, n) {
    const st = { ...theme.type.caption, font: 'plexmono', size: 24, weight: 500, italic: false, ls: 1.5 };
    setFont(ctx, st);
    ctx.fillStyle = theme.colors.caption;
    ctx.globalAlpha = 0.85;
    ctx.textBaseline = 'alphabetic';
    const t = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    // the margin the words and the logo leave: below the text on themes that
    // set it from the bottom, above it on themes that set it from the top
    const tw = widthOf(ctx, t, st);
    const y = theme.valign === 'top' ? SAFE - 30 : H - SAFE + 52;
    const x = theme.valign === 'middle' ? (W - tw) / 2 : W - SAFE - tw;
    ctx.fillText(t, x, y);
    ctx.globalAlpha = 1;
    if (HAS_LS) ctx.letterSpacing = '0px';
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

  // The topmost layer under a slide point: the slide's own, then the
  // carousel's backgrounds (which are in carousel coordinates, so offset by
  // the slide's place). Shades are never picked.
  function layerAt(doc, slide, x, y, index) {
    const theme = themeOf(doc);
    const { w: W, h: H } = sizeOf(doc);
    const hit = (l, px) => {
      const b = bounds(l, theme, W, H);
      const [lx, ly] = toLocal(l, b, px, y);
      const pad = l.kind === 'text' ? 12 : 0;
      return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
    };
    for (let i = slide.layers.length - 1; i >= 0; i--) {
      const l = slide.layers[i];
      if (l.kind === 'shade' || l.hidden) continue;
      if (hit(l, x)) return l;
    }
    const off = (index ?? Math.max(0, doc.slides.indexOf(slide))) * W;
    const bg = doc.bg || [];
    for (let i = bg.length - 1; i >= 0; i--) if (!bg[i].hidden && hit(bg[i], x + off)) return bg[i];
    return null;
  }

  /* ------------------------------------------------------------------ the slide */

  const themeOf = (doc) => THEMES[doc.theme] || THEMES[LEGACY[doc.theme]] || THEMES.midnight;
  const sizeOf = (doc) => SIZES[doc.size] || SIZES.portrait;

  // Draw `slide` into `ctx` (already sized to W*scale × H*scale): the
  // carousel's backdrop and backgrounds (its window of them), then its own
  // layers. opts.skip(layer) leaves layers out (the contrast check renders
  // the backdrop without the text); opts.index / opts.count place a slide
  // that is not in doc.slides (theme previews).
  function drawSlide(ctx, doc, slide, scale = 1, opts = {}) {
    const theme = opts.theme || themeOf(doc);
    const { w: W, h: H } = sizeOf(doc);
    const n = opts.count ?? Math.max(1, doc.slides.length);
    const i = opts.index ?? Math.max(0, doc.slides.indexOf(slide));
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = slide.bg || theme.base;
    ctx.fillRect(0, 0, W, H);
    if (!slide.bg) drawBackdrop(ctx, theme, W, H, i, n);
    // the carousel's background pictures, in carousel coordinates
    if (!opts.noBg && doc.bg && doc.bg.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.translate(-i * W, 0);
      for (const l of doc.bg) {
        if (l.hidden || l.x > (i + 1) * W || l.x + l.w < i * W || (opts.skip && opts.skip(l))) continue;
        const b = bounds(l, theme, W, H);
        withRotation(ctx, l, b, () => drawImage(ctx, l, opts.full, theme));
      }
      ctx.restore();
    }
    for (const layer of slide.layers) {
      if (layer.hidden || layer.kind === 'shade' || (opts.skip && opts.skip(layer))) continue;
      const b = bounds(layer, theme, W, H);
      withRotation(ctx, layer, b, () => {
        if (layer.kind === 'image') drawImage(ctx, layer, opts.full, theme);
        else if (layer.kind === 'text') drawText(ctx, layer, theme);
        else if (layer.kind === 'logo') drawLogo(ctx, layer, theme);
      });
    }
    if (doc.folio !== false && n > 1 && !opts.noFolio) drawFolio(ctx, theme, W, H, i, n);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ fonts */

  // Canvas text only uses a web font once it has loaded, and a line measured
  // with a fallback font is the wrong length: load faces before drawing,
  // and when one arrives, measure again and redraw.
  const fontsOK = typeof document !== 'undefined' && document.fonts;
  if (fontsOK)
    document.fonts.addEventListener('loadingdone', () => {
      layoutCache.clear();
      if (onReady) onReady('font');
    });
  const loadFace = (st, text) => (fontsOK ? document.fonts.load(fontString({ ...st, size: 40 }), text || 'Aa') : Promise.resolve()).catch(() => {});

  // Every theme's faces (at start, so the theme picker and new text are ready).
  function warmFonts() {
    const jobs = [];
    for (const t of Object.values(THEMES)) {
      for (const r of ROLES) jobs.push(loadFace(t.type[r], 'Aa1 τμ'));
      jobs.push(loadFace({ font: t.mark.font, weight: t.mark.weight, italic: false }, '\u201C'));
    }
    return Promise.all(jobs);
  }

  // The faces a slide's text uses, for exactly its characters.
  function fontsReady(doc, slide) {
    const theme = themeOf(doc);
    const jobs = slide.layers.filter((l) => l.kind === 'text').map((l) => loadFace(textStyle(l, theme), String(l.text || 'A')));
    if (slide.layers.some((l) => l.role === 'quote')) jobs.push(loadFace({ font: theme.mark.font, weight: theme.mark.weight, italic: false }, '\u201C'));
    return Promise.all(jobs);
  }

  // Everything a slide needs, decoded and loaded (before exporting).
  async function slideReady(doc, slide, load) {
    await fontsReady(doc, slide);
    layoutCache.clear();
    await logosReady();
    const pics = [...slide.layers, ...(doc.bg || [])].filter((l) => l.kind === 'image');
    await Promise.all(pics.map((l) => ensure(l.asset, load).catch(() => null)));
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
    FONT_LIST,
    warmFonts,
    fontsReady,
    SAFE,
    ROLES,
    LOGO_RATIO,
    LEGACY,
    drawBackdrop,
    treatOf,
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
