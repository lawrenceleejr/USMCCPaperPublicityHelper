/* USMCC Publicity Helper: the sheets (dialogs). Paper, PDF pages, figures,
   posts, export, carousels, theme, menu and keys. */

'use strict';

const Sheets = (() => {
  const { $, $$, el, api, toast, clamp, uid } = window.U;
  const R = window.Render;
  const S = window.U.S;
  const U = window.U;

  const sheet = $('#sheet');
  const body = $('#sheet-body');
  let cur = null; // { name, onEnter, onKey, onClose }

  function show(name, title, cls, build) {
    cur = { name };
    sheet.className = cls || '';
    sheet.hidden = false;
    $('#sheet-title').textContent = title;
    body.replaceChildren();
    body.scrollTop = 0;
    build(body, cur);
    return cur;
  }
  function close() {
    if (!cur) return;
    const c = cur;
    cur = null;
    sheet.hidden = true;
    body.replaceChildren();
    if (c.onClose) c.onClose();
    U.refresh();
  }
  $('#sheet-close').onclick = close;
  sheet.addEventListener('pointerdown', (e) => {
    if (e.target === sheet) close();
  });

  function key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (cur && cur.onKey && cur.onKey(e)) return;
    const typingIn = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (e.key === 'Enter' && cur && cur.onEnter && (!typingIn || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      cur.onEnter();
    }
  }

  const btn = (label, cls, fn, k) => {
    const b = el('button', 'btn ' + (cls || ''), label);
    if (k && !U.TOUCH) b.append(el('kbd', '', k));
    if (fn) b.onclick = fn;
    return b;
  };
  const slug = (s) =>
    String(s || 'carousel')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'carousel';

  async function openUrl(url) {
    if (U.LITE) return window.open(url, '_blank', 'noopener');
    try {
      await api('POST', '/api/open', { url });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  /* ---------------------------------------------------------------- pdf.js */

  let pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import(new URL('vendor/pdf.min.mjs', location.href).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
    }
    return pdfjs;
  }
  async function openPdf(bytes) {
    const lib = await loadPdfjs();
    return lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  }
  // One page as a canvas, `edge` px on its long side.
  async function pageCanvas(pdf, n, edge) {
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = edge / Math.max(v1.width, v1.height);
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(v.width);
    c.height = Math.ceil(v.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: v }).promise;
    page.cleanup();
    return c;
  }
  const canvasBlob = (c, type = 'image/png', q = 0.92) => new Promise((r) => c.toBlob(r, type, q));

  /* ---------------------------------------------------------------- PDF pages */

  async function pdf(file) {
    let doc;
    try {
      const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file;
      doc = await openPdf(bytes);
    } catch (e) {
      return toast('Could not open that PDF: ' + e.message, 4000);
    }
    const name = file.name || 'the paper';
    const picked = [];
    show('pdf', `${name} · ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`, 'wide', (b, c) => {
      b.append(el('p', 'note', 'Tap the pages to add, in the order you want them. Each goes on its own slide; crop to a plot there (C).'));
      const grid = el('div', 'grid-pick');
      const cells = [];
      const addBtn = btn('Add pages', 'primary', add, '↵');
      const update = () => {
        cells.forEach((cell, i) => {
          const k = picked.indexOf(i + 1);
          cell.classList.toggle('on', k >= 0);
          const badge = cell.querySelector('.badge');
          badge.hidden = k < 0;
          badge.textContent = k + 1;
        });
        addBtn.firstChild.textContent = picked.length ? `Add ${picked.length} page${picked.length === 1 ? '' : 's'}` : 'Add pages';
        addBtn.disabled = !picked.length;
      };
      for (let i = 1; i <= doc.numPages; i++) {
        const cell = el('button', 'pick');
        const pic = el('div', 'pic');
        const badge = el('span', 'badge');
        badge.hidden = true;
        cell.append(pic, badge, el('span', 'name', `Page ${i}`));
        cell.onclick = () => {
          const k = picked.indexOf(i);
          if (k >= 0) picked.splice(k, 1);
          else picked.push(i);
          update();
        };
        cells.push(cell);
        grid.append(cell);
      }
      const acts = el('div', 'bar-actions');
      acts.append(
        addBtn,
        btn('Title area of page 1', 'quiet', topOfFirst),
        btn('All pages', 'quiet', () => {
          picked.splice(0, picked.length, ...Array.from({ length: doc.numPages }, (_, i) => i + 1));
          update();
        })
      );
      b.append(acts, grid);
      update();
      c.onEnter = () => picked.length && add();
      c.onClose = () => {
        stop = true;
      };
      // thumbnails, one at a time
      let stop = false;
      (async () => {
        for (let i = 1; i <= doc.numPages && !stop; i++) {
          try {
            const cv = await pageCanvas(doc, i, 360);
            if (stop) break;
            cells[i - 1].querySelector('.pic').append(cv);
          } catch {}
        }
      })();
      async function add() {
        if (!picked.length) return;
        const pages = [...picked];
        close();
        toast(`Adding ${pages.length} page${pages.length === 1 ? '' : 's'}…`, 6000);
        const items = [];
        for (const n of pages) {
          const cv = await pageCanvas(doc, n, 2400);
          items.push({ blob: await canvasBlob(cv), name: `page ${n}`, photo: false });
          cv.width = cv.height = 0;
        }
        const k = await U.addPictures(items, { photo: false });
        toast(`Added ${k} page${k === 1 ? '' : 's'} · crop to a plot with C`);
      }
      async function topOfFirst() {
        close();
        const cv = await pageCanvas(doc, 1, 2400);
        const h = Math.round(cv.height * 0.42);
        const c2 = document.createElement('canvas');
        c2.width = cv.width;
        c2.height = h;
        c2.getContext('2d').drawImage(cv, 0, 0);
        await U.addPictures([{ blob: await canvasBlob(c2), name: 'title area', photo: false }], { photo: false });
        toast('Added the title area of page 1');
      }
    });
  }

  /* ---------------------------------------------------------------- figures */

  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }

  async function archive(file) {
    toast('Reading the paper’s source…', 8000);
    try {
      const r = await api('POST', '/api/figures', file, true);
      figures(r.figures, file.name);
    } catch (e) {
      toast(e.message, 5000);
    }
  }

  async function arxivFigures(link) {
    toast('Getting the figures from arXiv…', 20000);
    try {
      const r = await api('GET', `/api/arxiv/figures?url=${encodeURIComponent(link)}`);
      figures(r.figures, 'arXiv');
    } catch (e) {
      toast(e.message, 6000);
    }
  }

  function figures(list, from) {
    if (!list || !list.length) return toast('No figures found in ' + from, 4000);
    toast(`${list.length} figure${list.length === 1 ? '' : 's'} found`);
    const picked = [];
    const items = list.map((f) => ({ name: f.name, blob: b64ToBlob(f.data, f.mime), mime: f.mime }));
    show('figures', `Figures · ${from}`, 'wide', (b, c) => {
      b.append(el('p', 'note', 'Tap the figures to add, in order. Each goes on its own slide, on a card. PDF figures are drawn at full sharpness.'));
      const addBtn = btn('Add figures', 'primary', add, '↵');
      const grid = el('div', 'grid-pick');
      const cells = items.map((it, i) => {
        const cell = el('button', 'pick');
        const pic = el('div', 'pic');
        const badge = el('span', 'badge');
        badge.hidden = true;
        cell.append(pic, badge, el('span', 'name', it.name.split('/').pop()));
        cell.title = it.name;
        cell.onclick = () => {
          const k = picked.indexOf(i);
          if (k >= 0) picked.splice(k, 1);
          else picked.push(i);
          update();
        };
        grid.append(cell);
        return cell;
      });
      const update = () => {
        cells.forEach((cell, i) => {
          const k = picked.indexOf(i);
          cell.classList.toggle('on', k >= 0);
          cell.querySelector('.badge').hidden = k < 0;
          cell.querySelector('.badge').textContent = k + 1;
        });
        addBtn.firstChild.textContent = picked.length ? `Add ${picked.length} figure${picked.length === 1 ? '' : 's'}` : 'Add figures';
        addBtn.disabled = !picked.length;
      };
      const acts = el('div', 'bar-actions');
      acts.append(addBtn);
      b.append(acts, grid);
      update();
      c.onEnter = () => picked.length && add();
      // previews: PDFs drawn with pdf.js, the rest as they are
      (async () => {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          try {
            if (it.mime === 'application/pdf') {
              const d = await openPdf(new Uint8Array(await it.blob.arrayBuffer()));
              const cv = await pageCanvas(d, 1, 2400);
              it.blob = await canvasBlob(cv);
              it.mime = 'image/png';
              d.destroy();
            }
            const img = new Image();
            img.src = URL.createObjectURL(it.blob);
            cells[i].querySelector('.pic').append(img);
          } catch {
            cells[i].querySelector('.pic').append(el('span', 'muted', 'no preview'));
          }
        }
      })();
      async function add() {
        const chosen = picked.map((i) => items[i]).filter((it) => it.mime !== 'application/pdf');
        close();
        const n = await U.addPictures(
          chosen.map((it) => ({ blob: it.blob, name: it.name, photo: false })),
          { photo: false }
        );
        toast(`Added ${n} figure${n === 1 ? '' : 's'}`);
      }
    });
  }

  /* ---------------------------------------------------------------- paper */

  const FIELDS = [
    ['paperTitle', 'Title'],
    ['plainTitle', 'Plain title'],
    ['authors', 'Authors'],
    ['publicationDate', 'Date'],
    ['category', 'Category'],
    ['paperLink', 'Link'],
    ['publicAbstract', 'Summary', true],
    ['additionalComments', 'Comments', true],
  ];
  const emptyPaper = () => ({ timestamp: '', email: '', paperTitle: '', plainTitle: '', authors: '', publicationDate: '', category: '', publicAbstract: '', paperLink: '', figuresOk: true, additionalComments: '' });

  function paper(text) {
    const P = (S.doc.paper = S.doc.paper || emptyPaper());
    show('paper', 'Paper', '', (b, c) => {
      const paste = el('textarea', 'txt');
      paste.rows = 2;
      paste.placeholder = 'Paste a row from the submission sheet, or an arXiv link';
      const status = el('p', 'note');
      const read = async (t) => {
        t = (t || '').trim();
        if (!t) return;
        status.className = 'note';
        status.textContent = 'Reading…';
        try {
          if (t.includes('\t')) {
            const row = await api('POST', '/api/parse-row', { text: t });
            Object.assign(P, row);
            status.textContent = 'Read the row from the sheet.';
          } else {
            const a = await api('GET', `/api/arxiv?url=${encodeURIComponent(t)}`);
            P.paperLink = a.abs;
            status.textContent = `arXiv ${a.id}: get its figures or PDF below.`;
          }
          U.changed('paper');
          fill();
          paste.value = '';
        } catch (e) {
          status.className = 'note err';
          status.textContent = e.message;
        }
      };
      paste.addEventListener('paste', () => setTimeout(() => read(paste.value), 0));
      paste.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          read(paste.value);
        }
      };
      b.append(paste, status);

      const fields = el('div', 'fields');
      const inputs = {};
      for (const [k, label, long] of FIELDS) {
        const i = el(long ? 'textarea' : 'input', 'txt');
        if (long) i.rows = k === 'publicAbstract' ? 5 : 2;
        i.oninput = () => {
          P[k] = i.value;
          U.changed('paper-' + k, { quiet: true });
        };
        inputs[k] = i;
        fields.append(el('label', '', label), i);
      }
      const ok = el('label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.onchange = () => {
        P.figuresOk = cb.checked;
        U.changed('paper-fig');
      };
      ok.append(cb, document.createTextNode(' The authors are happy for figures to be reposted'));
      fields.append(el('span'), ok);
      const fill = () => {
        for (const [k] of FIELDS) inputs[k].value = P[k] || '';
        cb.checked = !!P.figuresOk;
        arx.hidden = !/arxiv/i.test(P.paperLink || '');
        pdfBtn.hidden = arx.hidden;
      };
      b.append(el('h4', '', 'The paper'), fields);

      const acts = el('div', 'bar-actions');
      const make = btn('Make slides', 'primary', () => {
        if (!P.paperTitle && !P.plainTitle) return (status.className = 'note err'), (status.textContent = 'Add a title first.');
        close();
        makeSlides();
      }, '↵');
      const arx = btn('Figures from arXiv', '', () => {
        close();
        arxivFigures(P.paperLink);
      });
      const pdfBtn = btn('Paper PDF pages', '', async () => {
        toast('Downloading the PDF from arXiv…', 20000);
        try {
          const blob = await api('GET', `/api/arxiv/pdf?url=${encodeURIComponent(P.paperLink)}`);
          close();
          const id = (P.paperLink.match(/(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})/i) || [, 'paper'])[1];
          pdf(new File([blob], `arXiv ${id}.pdf`, { type: 'application/pdf' }));
        } catch (e) {
          toast(e.message, 6000);
        }
      });
      acts.append(make, arx, pdfBtn, btn('Write the posts', 'quiet', () => posts(), 'W'));
      b.append(acts, el('p', 'note', 'Make slides adds a cover, a summary and a closing slide in the current theme. Add photos, figures or PDF pages around them.'));
      fill();
      c.onEnter = () => make.click();
      c.onKey = (e) => {
        if (e.key.toLowerCase() === 'w' && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
          e.preventDefault();
          posts();
          return true;
        }
      };
      if (text) read(text);
      else if (!P.paperTitle) setTimeout(() => paste.focus(), 50);
    });
  }

  function firstSentences(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const parts = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
    let out = '';
    for (const p of parts) {
      if ((out + p).length > max) break;
      out += p;
    }
    return (out || t.slice(0, max - 1) + '…').trim();
  }
  const shortAuthors = (a) => {
    const s = String(a || '').trim();
    if (/collaboration$/i.test(s)) return s;
    const names = s.split(/,| and /).map((x) => x.trim()).filter(Boolean);
    return names.length > 2 ? `${names[0]} et al.` : s;
  };

  // Text blocks stacked as the theme places them (see reflow in app.js),
  // with the logo in the opposite corner.
  function stackSlide(blocks, { logo = true, shade = true } = {}) {
    const s = U.blankSlide();
    const g = uid();
    if (shade) s.layers.push({ id: uid(), kind: 'shade', strength: 1 });
    for (const b of blocks.filter((b) => b.text)) s.layers.push({ id: uid(), kind: 'text', role: b.role, text: b.text, x: 0, w: 100, y: 0, ...(b.k ? { k: b.k } : {}), flow: { g, gap: b.gap || 0 } });
    if (logo) s.layers.push({ id: uid(), kind: 'logo', h: 140, x: 0, y: 0, flow: { g, logo: true } });
    U.reflow(s);
    return s;
  }

  function makeSlides() {
    const P = S.doc.paper;
    const title = (P.plainTitle || P.paperTitle).trim();
    const tk = title.length > 110 ? 0.66 : title.length > 70 ? 0.8 : undefined;
    const link = (P.paperLink || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const cover = stackSlide([
      { role: 'eyebrow', text: 'USMCC Featured Paper' },
      { role: 'title', text: title, gap: 18, k: tk },
      { role: 'caption', text: shortAuthors(P.authors), gap: 36 },
    ]);
    const summary = stackSlide(
      [
        { role: 'eyebrow', text: 'In short' },
        { role: 'body', text: firstSentences(P.publicAbstract, 300), gap: 22 },
      ],
      { logo: false }
    );
    const end = stackSlide([
      { role: 'eyebrow', text: 'Read the paper' },
      { role: 'title', text: link || 'Link in the post', gap: 18, k: 0.62 },
      { role: 'caption', text: [shortAuthors(P.authors), P.publicationDate].filter(Boolean).join(' · '), gap: 30 },
    ]);
    const slides = S.doc.slides;
    const blank = slides.length === 1 && !slides[0].layers.length;
    if (blank) slides.splice(0, 1, cover, summary, end);
    else {
      slides.unshift(cover, summary);
      slides.push(end);
    }
    S.cur = 0;
    S.sel = null;
    if (S.doc.name === 'Untitled carousel') S.doc.name = title.slice(0, 80);
    U.buildStrip();
    U.changed('make slides', { all: true });
    toast('Cover, summary and closing slides added · add figures or photos with A');
  }

  /* ---------------------------------------------------------------- posts */

  const LIMITS = {
    twitter: { label: 'X', chars: 280 },
    bluesky: { label: 'Bluesky', chars: 300 },
    linkedin: { label: 'LinkedIn', words: [100, 200] },
    summary: { label: 'Plain-language summary', words: [120, 180] },
  };
  const words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;

  // How long a post is against its limit: a hairline scale, the length as
  // a heavier line along it, the limit (or target range) as ticks.
  function gauge(text, lim) {
    const n = lim.chars ? [...String(text || '')].length : words(text);
    const max = lim.chars || lim.words[1];
    const over = lim.chars ? n > max : n < lim.words[0] || n > lim.words[1];
    const wrapEl = el('span', 'count' + (over ? ' over' : ''));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 120 12');
    const top = max * 1.25;
    const x = (v) => 1 + (clamp(v, 0, top) / top) * 118;
    const line = (x1, x2, y1, y2, stroke, w) => {
      const l = document.createElementNS(ns, 'line');
      Object.entries({ x1, x2, y1, y2, stroke, 'stroke-width': w }).forEach(([k, v]) => l.setAttribute(k, v));
      svg.append(l);
    };
    line(x(0), x(top), 6, 6, '#3a3936', 1);
    if (lim.words) {
      line(x(lim.words[0]), x(lim.words[0]), 2, 10, '#8a877f', 1);
    }
    line(x(max), x(max), 2, 10, '#e9e6df', 1);
    line(x(0), x(n), 6, 6, over ? '#e5735c' : '#e9e6df', 3);
    wrapEl.append(svg, el('span', 'num', lim.chars ? `${n} / ${max}` : `${n} words (${lim.words[0]}–${lim.words[1]})`));
    return wrapEl;
  }

  function composeUrl(k, text) {
    if (k === 'twitter') return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    if (k === 'bluesky') return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
    if (k === 'linkedin') return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
    return null;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Could not copy: select the text and copy it');
    }
  }

  async function posts() {
    const P = S.doc.paper;
    show('posts', 'Posts', '', async (b, c) => {
      if (!P || !(P.paperTitle || P.plainTitle)) {
        b.append(el('p', '', 'Start with the paper: paste its row from the submission sheet.'), el('div', 'bar-actions'));
        b.lastChild.append(btn('Paper…', 'primary', () => paper(), 'P'));
        c.onEnter = () => paper();
        return;
      }
      const set = S.settings;
      const claudeOk = !U.LITE;
      let mode = claudeOk && set.useClaude ? 'claude' : 'offline';
      const opts = el('div', 'bar-actions');
      const modeSeg = el('div');
      const modelSel = el('select', 'txt');
      for (const [v, l] of [
        ['claude-opus-5-5', 'Claude Opus 5.5'],
        ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
        ['claude-haiku-5-5', 'Claude Haiku 5.5'],
      ]) {
        const o = el('option', '', l);
        o.value = v;
        modelSel.append(o);
      }
      modelSel.value = set.model || 'claude-opus-5-5';
      modelSel.style.width = 'auto';
      modelSel.onchange = () => U.saveSettings({ model: modelSel.value });
      const thread = el('label');
      const tcb = el('input');
      tcb.type = 'checkbox';
      tcb.checked = !!set.thread;
      tcb.onchange = () => U.saveSettings({ thread: tcb.checked });
      thread.append(tcb, document.createTextNode(' X thread too'));
      const go = btn('Write', 'primary', write, '↵');
      const status = el('p', 'note');
      const keyBox = el('div');
      const drawMode = () => {
        modeSeg.replaceChildren(
          segButtons(
            [
              ['offline', 'From the paper', 'Built from the summary in the sheet, no network'],
              ...(claudeOk ? [['claude', 'With Claude', 'Claude writes each post from the paper']] : []),
            ],
            mode,
            (v) => {
              mode = v;
              U.saveSettings({ useClaude: v === 'claude' });
              drawMode();
            }
          )
        );
        modelSel.hidden = mode !== 'claude';
        keyBox.hidden = mode !== 'claude';
      };
      opts.append(modeSeg, modelSel, thread, go);
      b.append(opts, keyBox, status);
      if (U.LITE) b.append(el('p', 'note', 'Writing the posts with Claude is in the desktop app; here they are drafted from the paper’s summary.'));
      const out = el('div');
      b.append(out);
      drawMode();
      if (claudeOk) drawKey();
      c.onEnter = write;

      async function drawKey() {
        keyBox.replaceChildren();
        let k = { set: false, keychain: false };
        try {
          k = await api('GET', '/api/key');
        } catch {}
        const row = el('div', 'bar-actions');
        if (k.set) {
          row.append(el('span', 'note', 'Claude API key: saved' + (k.keychain ? ' in the keychain' : '')));
          row.append(btn('Test', 'quiet', async () => {
            status.textContent = 'Testing…';
            const r = await api('POST', '/api/key/test', {}).catch((e) => ({ ok: false, error: e.message }));
            status.className = r.ok ? 'note' : 'note err';
            status.textContent = r.ok ? 'The key works.' : 'The key did not work: ' + (r.error || '');
          }));
          row.append(btn('Remove', 'quiet', async () => {
            await api('POST', '/api/key', { key: '' }).catch(() => {});
            drawKey();
          }));
        } else {
          const i = el('input', 'txt');
          i.type = 'password';
          i.placeholder = 'Claude API key (sk-ant-…)';
          i.style.maxWidth = '320px';
          row.append(i, btn('Save', '', async () => {
            try {
              await api('POST', '/api/key', { key: i.value.trim() });
              drawKey();
            } catch (e) {
              status.className = 'note err';
              status.textContent = e.message;
            }
          }));
        }
        keyBox.append(row);
      }

      function drawPosts() {
        out.replaceChildren();
        const p = S.doc.posts;
        if (!p) return;
        const card = (k, label, lim) => {
          const d = el('div', 'post');
          const head = el('div', 'post-head');
          const ta = el('textarea', 'txt');
          ta.value = p[k] || '';
          const g = el('span');
          const updateGauge = () => g.replaceChildren(lim ? gauge(ta.value, lim) : el('span'));
          ta.oninput = () => {
            p[k] = ta.value;
            U.changed('post-' + k, { quiet: true });
            updateGauge();
          };
          updateGauge();
          const acts = el('span', 'bar-actions');
          acts.style.marginTop = '0';
          acts.append(btn('Copy', 'quiet', () => copy(ta.value)));
          const url = composeUrl(k, ta.value);
          if (url) acts.append(btn(`Open ${label}`, 'quiet', () => {
            if (k === 'linkedin') navigator.clipboard?.writeText(ta.value).catch(() => {});
            openUrl(composeUrl(k, ta.value));
          }));
          head.append(el('b', '', label), g, acts);
          d.append(head, ta);
          out.append(d);
        };
        card('twitter', 'X', LIMITS.twitter);
        if (p.thread && p.thread.length) {
          p.thread.forEach((tw, i) => {
            const d = el('div', 'post');
            const head = el('div', 'post-head');
            const ta = el('textarea', 'txt');
            ta.value = tw;
            const g = el('span');
            const upd = () => g.replaceChildren(gauge(ta.value, LIMITS.twitter));
            ta.oninput = () => {
              p.thread[i] = ta.value;
              U.changed('thread', { quiet: true });
              upd();
            };
            upd();
            head.append(el('b', '', `X thread ${i + 1}/${p.thread.length}`), g, btn('Copy', 'quiet', () => copy(ta.value)));
            d.append(head, ta);
            out.append(d);
          });
        }
        card('bluesky', 'Bluesky', LIMITS.bluesky);
        card('linkedin', 'LinkedIn', LIMITS.linkedin);
        card('summary', 'Plain-language summary', LIMITS.summary);
        const md = el('div', 'post');
        const head = el('div', 'post-head');
        head.append(el('b', '', 'Website (Hugo index.md)'), el('span'), btn('Copy', 'quiet', () => copy(p.markdown || '')), btn('Save index.md', 'quiet', () => saveText(p.markdown || '', 'index.md', 'text/markdown')));
        const ta = el('textarea', 'txt');
        ta.value = p.markdown || '';
        ta.rows = 6;
        ta.style.fontFamily = 'var(--mono)';
        ta.oninput = () => {
          p.markdown = ta.value;
          U.changed('md', { quiet: true });
        };
        md.append(head, ta);
        out.append(md);
      }

      async function write() {
        go.disabled = true;
        status.className = 'note';
        status.textContent = mode === 'claude' ? 'Claude is writing…' : 'Drafting…';
        try {
          const r = await api('POST', '/api/posts', { row: S.doc.paper, mode, model: modelSel.value, thread: tcb.checked });
          S.doc.posts = r;
          U.changed('posts');
          status.textContent = mode === 'claude' ? 'Written by Claude. Check every claim against the paper before posting.' : 'Drafted from the paper. Edit freely.';
          drawPosts();
        } catch (e) {
          status.className = 'note err';
          status.textContent = e.message;
        } finally {
          go.disabled = false;
        }
      }
      if (S.doc.posts) drawPosts();
      else if (mode === 'offline') write();
    });
  }

  function segButtons(options, value, onPick) {
    const s = el('div', 'seg');
    for (const [v, label, title] of options) {
      const b = el('button', v === value ? 'on' : '', label);
      if (title) b.title = title;
      b.onclick = () => onPick(v);
      s.append(b);
    }
    return s;
  }

  async function saveText(text, name, type) {
    const blob = new Blob([text], { type });
    const folder = slug(S.doc.name);
    if (U.LITE) return U.LITE.deliver([new File([blob], name, { type })], null);
    try {
      const r = await api('POST', `/api/export?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(name)}`, blob, true);
      toast('Saved ' + (r.path || name), 3500);
    } catch (e) {
      toast(e.message, 4000);
    }
  }

  /* ---------------------------------------------------------------- export */

  // A PDF with one JPEG per page (a LinkedIn "document" carousel).
  function jpegsToPdf(pages) {
    const enc = new TextEncoder();
    const parts = [];
    let len = 0;
    const offsets = [];
    const push = (x) => {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(b);
      len += b.length;
    };
    const obj = (n, head, stream) => {
      offsets[n] = len;
      push(`${n} 0 obj\n${head}\n`);
      if (stream) {
        push('stream\n');
        push(stream);
        push('\nendstream\n');
      }
      push('endobj\n');
    };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = pages.length;
    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    pages.forEach((p, i) => {
      const pw = +(p.w * 0.75).toFixed(2);
      const ph = +(p.h * 0.75).toFixed(2);
      const pg = 3 + i * 3;
      const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
      obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>`);
      obj(pg + 1, `<< /Length ${content.length} >>`, content);
      obj(pg + 2, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>`, p.bytes);
    });
    const xref = len;
    const count = 3 + n * 3;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function renderSlide(s, type) {
    const { w: W, h: H } = U.size();
    await R.slideReady(S.doc, s, U.loadAsset);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    R.drawSlide(c.getContext('2d'), S.doc, s, 1, { full: true });
    const blob = await canvasBlob(c, type, 0.92);
    c.width = c.height = 0;
    return blob;
  }
  window.U.renderSlide = renderSlide;

  function exportSheet() {
    const set = S.settings;
    let fmt = set.format || 'jpeg';
    show('export', 'Export', 'narrow', (b, c) => {
      const n = S.doc.slides.length;
      const { w: W, h: H } = U.size();
      const fmtRow = el('div', 'bar-actions');
      const drawFmt = () =>
        fmtRow.replaceChildren(
          segButtons(
            [
              ['jpeg', 'JPEG', 'Photos, Instagram, X, Bluesky'],
              ['png', 'PNG', 'Lossless'],
              ['pdf', 'PDF', 'One file: a LinkedIn document carousel'],
            ],
            fmt,
            (v) => {
              fmt = v;
              U.saveSettings({ format: v });
              drawFmt();
              dest();
            }
          )
        );
      drawFmt();
      const where = el('p', 'dest');
      const dest = () => {
        const folder = slug(S.doc.name);
        if (U.LITE) where.textContent = U.LITE.destLabel(fmt);
        else where.textContent = `${S.info.exportDir || '~/Pictures/USMCC Publicity'}/${folder}/`;
      };
      dest();
      b.append(el('p', '', `${n} slide${n === 1 ? '' : 's'}, ${W} × ${H} px.`), fmtRow, el('h4', '', 'To'), where);
      if (!U.LITE && S.info.canChooseDir) {
        b.append(
          btn('Change folder…', 'quiet', async () => {
            const r = await api('POST', '/api/choose-export-dir', {}).catch(() => null);
            if (r && r.dir) {
              S.info.exportDir = r.dir;
              dest();
            }
          })
        );
      }
      const bar = el('div', 'progress');
      const fillBar = el('i');
      bar.append(fillBar);
      bar.hidden = true;
      const result = el('div', 'note');
      const go = btn(`Export ${n} slide${n === 1 ? '' : 's'}`, 'primary', run, '↵');
      const acts = el('div', 'bar-actions');
      acts.append(go);
      b.append(acts, bar, result);
      c.onEnter = () => (U.LITE && U.LITE.pendingShare ? U.LITE.pendingShare.click() : !go.disabled && run());

      async function run() {
        go.disabled = true;
        bar.hidden = false;
        result.className = 'note';
        result.replaceChildren(el('span', '', 'Drawing the slides…'));
        const base = slug(S.doc.name);
        const files = [];
        try {
          const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
          const pdfPages = [];
          for (let i = 0; i < n; i++) {
            fillBar.style.width = `${((i + 0.5) / n) * 100}%`;
            const blob = await renderSlide(S.doc.slides[i], type);
            const name = `${base}-${String(i + 1).padStart(2, '0')}.${fmt === 'png' ? 'png' : 'jpg'}`;
            if (fmt === 'pdf') pdfPages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H });
            else files.push(new File([blob], name, { type, lastModified: Date.now() }));
          }
          if (fmt === 'pdf') files.push(new File([jpegsToPdf(pdfPages)], `${base}.pdf`, { type: 'application/pdf' }));
          fillBar.style.width = '100%';
          if (U.LITE) {
            const r = await U.LITE.deliver(files, result);
            if (r) result.replaceChildren(el('span', '', r));
          } else {
            let saved = 0;
            let skipped = 0;
            let dir = '';
            for (const f of files) {
              const r = await api('POST', `/api/export?folder=${encodeURIComponent(base)}&file=${encodeURIComponent(f.name)}`, f, true);
              if (r.skipped) skipped++;
              else saved++;
              dir = r.path ? r.path.replace(/[\\/][^\\/]*$/, '') : dir;
            }
            result.replaceChildren(el('span', '', `Saved ${saved} file${saved === 1 ? '' : 's'}${skipped ? `, ${skipped} already there` : ''} to ${dir}. `));
            const reveal = el('button', 'link', 'Show in ' + (U.MAC ? 'Finder' : 'folder'));
            reveal.style.color = 'var(--accent)';
            reveal.onclick = () => api('POST', '/api/reveal', { path: dir }).catch(() => {});
            result.append(reveal);
          }
        } catch (e) {
          result.className = 'note err';
          result.textContent = 'Export failed: ' + e.message;
        } finally {
          go.disabled = false;
        }
      }
    });
  }

  /* ---------------------------------------------------------------- carousels */

  function when(ms) {
    const d = new Date(ms);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  async function docs() {
    await U.saveNow();
    let list = await api('GET', '/api/docs').catch(() => []);
    show('docs', 'Carousels', 'narrow', (b, c) => {
      const name = el('input', 'txt');
      name.value = S.doc.name;
      name.oninput = () => {
        S.doc.name = name.value || 'Untitled carousel';
        U.changed('name', { quiet: true });
        $('#doc-name').textContent = S.doc.name;
      };
      b.append(el('h4', '', 'This carousel'), name);
      const acts = el('div', 'bar-actions');
      let armed = false;
      const del = btn('Delete this carousel', 'quiet', async () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Delete it: tap again';
          del.style.color = 'var(--bad)';
          return;
        }
        await api('DELETE', `/api/doc/${S.doc.id}`).catch(() => {});
        list = list.filter((d) => d.id !== S.doc.id);
        close();
        if (list.length) U.openDoc(await api('GET', `/api/doc/${list[0].id}`));
        else U.openDoc(U.newDoc());
        toast('Deleted');
      });
      acts.append(btn('New carousel', 'primary', newDoc, 'N'), del);
      b.append(acts, el('h4', '', 'All carousels'));
      const box = el('div', 'doclist');
      for (const d of list) {
        const row = el('button', 'doc' + (d.id === S.doc.id ? ' on' : ''));
        row.append(el('span', 'nm', d.name || 'Untitled'), el('span', 'when num', `${d.count} slide${d.count === 1 ? '' : 's'}`), el('span', 'when', when(d.updated)));
        row.onclick = async () => {
          close();
          if (d.id !== S.doc.id) U.openDoc(await api('GET', `/api/doc/${d.id}`));
        };
        box.append(row);
      }
      if (!list.length) box.append(el('p', 'note', 'This is your first carousel.'));
      b.append(box);
      c.onKey = (e) => {
        if (e.key.toLowerCase() === 'n' && e.target.tagName !== 'INPUT') {
          e.preventDefault();
          newDoc();
          return true;
        }
      };
    });
  }

  async function newDoc() {
    await U.saveNow();
    close();
    const d = U.newDoc();
    d.theme = S.doc ? S.doc.theme : d.theme;
    d.size = S.doc ? S.doc.size : d.size;
    U.openDoc(d);
    await U.saveNow();
    toast('New carousel');
  }

  /* ---------------------------------------------------------------- theme, size */

  function resizeDoc(to) {
    const from = U.size();
    const T = R.SIZES[to];
    if (!T || to === S.doc.size) return;
    const k = T.h / from.h;
    for (const s of S.doc.slides)
      for (const l of s.layers) {
        if (l.kind === 'image' && l.y <= 0 && l.y + l.h >= from.h) {
          l.y = Math.round(l.y * k);
          l.h = Math.round(l.h * k);
        } else if (l.kind !== 'shade') {
          const b = R.bounds(l, U.theme(), from.w, from.h);
          l.y = Math.round((b.y + b.h / 2) * k - b.h / 2);
        }
      }
    S.doc.size = to;
    U.changed('size', { all: true });
  }
  function cycleSize() {
    const keys = Object.keys(R.SIZES);
    const next = keys[(keys.indexOf(S.doc.size) + 1) % keys.length];
    resizeDoc(next);
    toast(R.SIZES[next].label + ' · ' + R.SIZES[next].note);
  }

  function themeSheet() {
    show('theme', 'Theme', 'wide', (b, c) => {
      const sizes = el('div', 'bar-actions');
      const drawSizes = () =>
        sizes.replaceChildren(
          segButtons(
            Object.entries(R.SIZES).map(([k, v]) => [k, v.label, v.note]),
            S.doc.size,
            (v) => {
              resizeDoc(v);
              drawSizes();
              drawThemes();
            }
          ),
          el('span', 'note', R.SIZES[S.doc.size].note)
        );
      const grid = el('div', 'themes');
      const keys = Object.keys(R.THEMES);
      const drawThemes = () => {
        grid.replaceChildren();
        const s = S.doc.slides[S.cur];
        const { w: W, h: H } = U.size();
        for (const k of keys) {
          const cell = el('button', 'pick' + (k === S.doc.theme ? ' on' : ''));
          const cv = document.createElement('canvas');
          const sc = 300 / W;
          cv.width = Math.round(W * sc);
          cv.height = Math.round(H * sc);
          const copy = JSON.parse(JSON.stringify(s));
          U.reflow(copy, R.THEMES[k]);
          R.drawSlide(cv.getContext('2d'), S.doc, copy, sc, { theme: R.THEMES[k] });
          cell.append(cv, el('span', 'name', R.THEMES[k].name));
          cell.onclick = () => {
            S.doc.theme = k;
            U.changed('theme', { all: true });
            drawThemes();
          };
          grid.append(cell);
        }
      };
      drawSizes();
      drawThemes();
      b.append(el('h4', '', 'Size'), sizes, el('h4', '', 'Theme · shown on this slide'), grid);
      b.append(el('p', 'note', 'A theme sets the background, the light over photos (the “theme light” layer) and how each kind of text looks. Text you have styled by hand keeps its style.'));
      c.onKey = (e) => {
        const i = keys.indexOf(S.doc.theme);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          S.doc.theme = keys[(i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
          U.changed('theme', { all: true });
          drawThemes();
          return true;
        }
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          cycleSize();
          drawSizes();
          drawThemes();
          return true;
        }
      };
      c.onEnter = close;
    });
  }

  /* ---------------------------------------------------------------- menu, keys */

  function menu() {
    show('menu', 'Menu', 'wide', (b, c) => {
      const list = el('div', 'menu-list');
      const items = [];
      for (const g of U.MENU) {
        list.append(el('h5', '', g.group));
        for (const [id, label, k] of g.items) {
          if (id === 'menu') continue;
          const it = el('button', 'menu-item');
          it.append(el('span', '', label));
          if (k && !U.TOUCH) it.append(el('kbd', '', k));
          it.onclick = () => {
            close();
            U.COMMANDS[id]();
          };
          items.push(it);
          list.append(it);
        }
      }
      b.append(list);
      let f = 0;
      const focus = () => items.forEach((it, i) => it.classList.toggle('focus', i === f));
      focus();
      c.onKey = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          f = (f + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          focus();
          items[f].scrollIntoView({ block: 'nearest' });
          return true;
        }
        if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          close();
          return true;
        }
      };
      c.onEnter = () => items[f].click();
    });
  }

  function keys() {
    show('keys', 'Keys', 'wide', (b) => {
      const dl = el('dl', 'keys');
      const row = (k, d) => {
        const dt = el('dt');
        for (const part of k.split(' ')) dt.append(el('kbd', '', part));
        dl.append(dt, el('dd', '', d));
      };
      row('← → ↑ ↓', 'previous / next slide; with a layer selected, move it (⇧ by 10)');
      row('[ ]', 'previous / next slide');
      row('Esc', 'stop cropping, then deselect');
      row('Tab', 'select the next layer');
      for (const g of U.MENU) for (const [id, label, k] of g.items) if (k && !['prev', 'next', 'nextlayer'].includes(id)) row(k, label.replace(/…$/, ''));
      b.append(dl, el('p', 'note', 'Drag a layer to move it; the handles resize it (Shift frees a picture’s proportions) and the round one turns it. Alt while dragging turns off snapping. Double-click text to edit it, a picture to crop it. Scroll to zoom while cropping. Paste a sheet row or an arXiv link anywhere to start.'));
    });
  }

  return {
    open: () => !!cur,
    key,
    close,
    pdf,
    archive,
    figures,
    paper,
    posts,
    export: exportSheet,
    docs,
    newDoc,
    theme: themeSheet,
    cycleSize,
    menu,
    keys,
    slug,
  };
})();
window.Sheets = Sheets;
