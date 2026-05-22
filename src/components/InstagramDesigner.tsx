import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { fetchArxivFigures, getArxivEprintUrl, openExternal } from "../api";
import { pdfDataUrlToPngDataUrl } from "../pdfRender";
import usmccLogo from "../assets/LogoUSMCC_white.png";

interface Props {
  eyebrowText: string;
  titleText: string;
  descriptionText: string;
  authorsText: string;
  paperLink: string;
}

type TemplateKey =
  | "editorial"
  | "minimal_mono"
  | "bold_sans"
  | "soft_serif"
  | "punch"
  | "dm_pair";

type BlendMode =
  | "normal"
  | "multiply"
  | "overlay"
  | "soft-light"
  | "screen"
  | "darken"
  | "lighten";

type GradientStyle = "vertical" | "radial" | "corner_tl" | "corner_br";
type Align = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";

interface TextBlock {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  weight: number;
  italic?: boolean;
  uppercase?: boolean;
}

interface Typography {
  eyebrow: TextBlock;
  title: TextBlock;
  description: TextBlock;
  authors: TextBlock;
}

interface TemplateDef {
  name: string;
  displayFont: string;
  bodyFont: string;
  baseColor: string;
  tintColor: string;
  tintOpacity: number;
  tintBlend: BlendMode;
  gradient: GradientStyle;
  gradientColorStart: string;
  gradientColorEnd: string;
  gradientBlend: BlendMode;
  textColor: string;
  eyebrowColor: string;
  authorsColor: string;
  align: Align;
  vAlign: VAlign;
  typography: Typography;
}

interface BgImage {
  id: string;
  src: string;
  name: string;
  source: "upload" | "arxiv";
}

interface PaneText {
  eyebrow: string;
  title: string;
  description: string;
  authors: string;
  dirty: { eyebrow: boolean; title: boolean; description: boolean; authors: boolean };
}

const CANVAS_SIZE = 1080;
const SAFE_PADDING = 88;
const CROSSFADE_PX = 120;
const LOGO_HEIGHT_PX = 80;
const LOGO_MARGIN_PX = 44;
const FONT_LOAD_TIMEOUT_MS = 4000;
const MAX_PANES = 5;
const MIN_PANES = 2;
const DESCRIPTION_MAX_CHARS = 240;
const FALLBACK_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  editorial: {
    name: "Editorial",
    displayFont: "Playfair Display",
    bodyFont: "Inter",
    baseColor: "#0a0a0a",
    tintColor: "#0d1b2a",
    tintOpacity: 0.35,
    tintBlend: "multiply",
    gradient: "vertical",
    gradientColorStart: "rgba(0,0,0,0)",
    gradientColorEnd: "rgba(0,0,0,0.88)",
    gradientBlend: "normal",
    textColor: "#ffffff",
    eyebrowColor: "#f5c842",
    authorsColor: "#cbd5e1",
    align: "left",
    vAlign: "bottom",
    typography: {
      eyebrow: { fontSize: 30, lineHeight: 1.2, letterSpacing: 6, weight: 600, uppercase: true },
      title: { fontSize: 92, lineHeight: 1.04, letterSpacing: -1, weight: 700 },
      description: { fontSize: 38, lineHeight: 1.35, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 28, lineHeight: 1.4, letterSpacing: 0.5, weight: 500, italic: true },
    },
  },
  minimal_mono: {
    name: "Minimal Mono",
    displayFont: "Space Grotesk",
    bodyFont: "Space Mono",
    baseColor: "#f7f7f4",
    tintColor: "#0a0a0a",
    tintOpacity: 0.18,
    tintBlend: "multiply",
    gradient: "vertical",
    gradientColorStart: "rgba(247,247,244,0.55)",
    gradientColorEnd: "rgba(247,247,244,0)",
    gradientBlend: "normal",
    textColor: "#0a0a0a",
    eyebrowColor: "#7c3aed",
    authorsColor: "#52525b",
    align: "left",
    vAlign: "top",
    typography: {
      eyebrow: { fontSize: 26, lineHeight: 1.2, letterSpacing: 8, weight: 600, uppercase: true },
      title: { fontSize: 80, lineHeight: 1.06, letterSpacing: -1.5, weight: 700 },
      description: { fontSize: 32, lineHeight: 1.45, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 24, lineHeight: 1.4, letterSpacing: 0.5, weight: 400 },
    },
  },
  bold_sans: {
    name: "Bold Sans",
    displayFont: "Archivo Black",
    bodyFont: "Lora",
    baseColor: "#1a1a2e",
    tintColor: "#7c3aed",
    tintOpacity: 0.42,
    tintBlend: "overlay",
    gradient: "radial",
    gradientColorStart: "rgba(0,0,0,0)",
    gradientColorEnd: "rgba(0,0,0,0.78)",
    gradientBlend: "multiply",
    textColor: "#ffffff",
    eyebrowColor: "#fbbf24",
    authorsColor: "#e9d5ff",
    align: "center",
    vAlign: "middle",
    typography: {
      eyebrow: { fontSize: 30, lineHeight: 1.2, letterSpacing: 10, weight: 700, uppercase: true },
      title: { fontSize: 100, lineHeight: 1.0, letterSpacing: -1, weight: 700 },
      description: { fontSize: 36, lineHeight: 1.4, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 28, lineHeight: 1.4, letterSpacing: 1, weight: 500, italic: true },
    },
  },
  soft_serif: {
    name: "Soft Serif",
    displayFont: "Cormorant Garamond",
    bodyFont: "Source Sans 3",
    baseColor: "#f5f0e8",
    tintColor: "#7c2d12",
    tintOpacity: 0.22,
    tintBlend: "multiply",
    gradient: "vertical",
    gradientColorStart: "rgba(245,240,232,0)",
    gradientColorEnd: "rgba(120,53,15,0.7)",
    gradientBlend: "soft-light",
    textColor: "#1c1917",
    eyebrowColor: "#92400e",
    authorsColor: "#57534e",
    align: "left",
    vAlign: "bottom",
    typography: {
      eyebrow: { fontSize: 26, lineHeight: 1.2, letterSpacing: 5, weight: 600, uppercase: true },
      title: { fontSize: 108, lineHeight: 1.0, letterSpacing: -0.5, weight: 500 },
      description: { fontSize: 34, lineHeight: 1.4, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 28, lineHeight: 1.4, letterSpacing: 0.5, weight: 500, italic: true },
    },
  },
  punch: {
    name: "Punch",
    displayFont: "Bebas Neue",
    bodyFont: "Karla",
    baseColor: "#020617",
    tintColor: "#ef4444",
    tintOpacity: 0.5,
    tintBlend: "multiply",
    gradient: "corner_tl",
    gradientColorStart: "rgba(239,68,68,0.9)",
    gradientColorEnd: "rgba(2,6,23,0)",
    gradientBlend: "multiply",
    textColor: "#ffffff",
    eyebrowColor: "#fde047",
    authorsColor: "#fca5a5",
    align: "left",
    vAlign: "top",
    typography: {
      eyebrow: { fontSize: 32, lineHeight: 1.2, letterSpacing: 8, weight: 700, uppercase: true },
      title: { fontSize: 140, lineHeight: 0.92, letterSpacing: 1, weight: 400 },
      description: { fontSize: 32, lineHeight: 1.4, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 26, lineHeight: 1.4, letterSpacing: 0.5, weight: 500 },
    },
  },
  dm_pair: {
    name: "DM Pair",
    displayFont: "DM Serif Display",
    bodyFont: "DM Sans",
    baseColor: "#0c4a6e",
    tintColor: "#082f49",
    tintOpacity: 0.3,
    tintBlend: "multiply",
    gradient: "vertical",
    gradientColorStart: "rgba(125,211,252,0)",
    gradientColorEnd: "rgba(8,47,73,0.88)",
    gradientBlend: "multiply",
    textColor: "#f0f9ff",
    eyebrowColor: "#bae6fd",
    authorsColor: "#cbd5e1",
    align: "left",
    vAlign: "bottom",
    typography: {
      eyebrow: { fontSize: 26, lineHeight: 1.2, letterSpacing: 4, weight: 500, uppercase: true },
      title: { fontSize: 96, lineHeight: 1.05, letterSpacing: -0.5, weight: 400 },
      description: { fontSize: 36, lineHeight: 1.4, letterSpacing: 0, weight: 400 },
      authors: { fontSize: 28, lineHeight: 1.4, letterSpacing: 0.5, weight: 500 },
    },
  },
};

const TEMPLATE_ORDER: TemplateKey[] = [
  "editorial",
  "bold_sans",
  "punch",
  "dm_pair",
  "soft_serif",
  "minimal_mono",
];

function buildFontFamily(fontFamily: string): string {
  return `"${fontFamily}", ${FALLBACK_FONT_STACK}`;
}

async function ensureGoogleFont(family: string, weight: number, italic = false): Promise<void> {
  const familyParam = family.trim().split(/\s+/).join("+");
  const styleSpec = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const id = `google-font-${familyParam.toLowerCase()}-${styleSpec}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${familyParam}:${styleSpec}&display=swap`;
    document.head.appendChild(link);
  }
  const descriptor = `${italic ? "italic " : ""}${weight} 32px "${family}"`;
  await new Promise<void>((resolve) => {
    const handle = window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
    document.fonts
      .load(descriptor)
      .then(() => resolve())
      .catch(() => resolve())
      .finally(() => window.clearTimeout(handle));
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function bytesFromBase64(b64: string, mime: string): string {
  return `data:${mime};base64,${b64}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${src.slice(0, 60)}`));
    img.src = src;
  });
}

function firstSentences(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const candidate = trimmed.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );
  if (lastSentenceEnd > maxChars / 2) {
    return candidate.slice(0, lastSentenceEnd + 1);
  }
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "usmcc-paper";
}

function gradientCss(template: TemplateDef): string {
  const { gradient, gradientColorStart, gradientColorEnd } = template;
  if (gradient === "vertical") {
    return `linear-gradient(180deg, ${gradientColorStart} 0%, ${gradientColorEnd} 100%)`;
  }
  if (gradient === "radial") {
    return `radial-gradient(circle at 50% 50%, ${gradientColorStart} 0%, ${gradientColorEnd} 75%)`;
  }
  if (gradient === "corner_tl") {
    return `radial-gradient(circle at 0% 0%, ${gradientColorStart} 0%, ${gradientColorEnd} 70%)`;
  }
  return `radial-gradient(circle at 100% 100%, ${gradientColorStart} 0%, ${gradientColorEnd} 70%)`;
}

function makePaneTextFromProps(
  paneIndex: number,
  paneCount: number,
  props: Props
): PaneText {
  const isFirst = paneIndex === 0;
  const isSecond = paneIndex === 1;
  const isLast = paneIndex === paneCount - 1;
  return {
    eyebrow: isFirst ? props.eyebrowText : "",
    title: isFirst ? props.titleText : "",
    // Pane 1 always carries authors. If there is only one pane (shouldn't happen — min is 2 —
    // but be defensive) it also gets the description.
    description:
      isSecond || (isFirst && paneCount === 1)
        ? firstSentences(props.descriptionText, DESCRIPTION_MAX_CHARS)
        : "",
    authors: isFirst || isLast ? props.authorsText : "",
    dirty: { eyebrow: false, title: false, description: false, authors: false },
  };
}

function refreshPaneFromProps(pane: PaneText, paneIndex: number, paneCount: number, props: Props): PaneText {
  const defaults = makePaneTextFromProps(paneIndex, paneCount, props);
  return {
    eyebrow: pane.dirty.eyebrow ? pane.eyebrow : defaults.eyebrow,
    title: pane.dirty.title ? pane.title : defaults.title,
    description: pane.dirty.description ? pane.description : defaults.description,
    authors: pane.dirty.authors ? pane.authors : defaults.authors,
    dirty: pane.dirty,
  };
}

function paneSlotForImage(imageIndex: number, imageCount: number, paneCount: number) {
  if (imageCount === 0) return { left: 0, width: paneCount * CANVAS_SIZE };
  const slotWidth = (paneCount * CANVAS_SIZE) / imageCount;
  return { left: imageIndex * slotWidth, width: slotWidth };
}

export default function InstagramDesigner({
  eyebrowText,
  titleText,
  descriptionText,
  authorsText,
  paperLink,
}: Props) {
  const [templateKey, setTemplateKey] = useState<TemplateKey>("editorial");
  const [displayFontOverride, setDisplayFontOverride] = useState<string | null>(null);
  const [bodyFontOverride, setBodyFontOverride] = useState<string | null>(null);
  const [images, setImages] = useState<BgImage[]>([]);
  const [paneCountOverride, setPaneCountOverride] = useState<number | null>(null);
  const [gradientStrength, setGradientStrength] = useState(1);
  const [tintStrength, setTintStrength] = useState(1);
  const [titleScale, setTitleScale] = useState(1);
  const [descriptionScale, setDescriptionScale] = useState(1);
  const [imageScale, setImageScale] = useState(1);
  const [gapEyebrowTitle, setGapEyebrowTitle] = useState(18);
  const [gapTitleDescription, setGapTitleDescription] = useState(36);
  const [gapDescriptionAuthors, setGapDescriptionAuthors] = useState(28);
  const [activePane, setActivePane] = useState(0);
  const [arxivLoading, setArxivLoading] = useState(false);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const [arxivInfo, setArxivInfo] = useState<string | null>(null);
  const [arxivEprintUrl, setArxivEprintUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const PREVIEW_SCALE = 0.4;

  const propsRef = useRef<Props>({ eyebrowText, titleText, descriptionText, authorsText, paperLink });
  useEffect(() => {
    propsRef.current = { eyebrowText, titleText, descriptionText, authorsText, paperLink };
  }, [eyebrowText, titleText, descriptionText, authorsText, paperLink]);

  const paneCount = useMemo(() => {
    const derived = Math.max(MIN_PANES, Math.min(MAX_PANES, images.length || MIN_PANES));
    return paneCountOverride ?? derived;
  }, [images.length, paneCountOverride]);

  const [panes, setPanes] = useState<PaneText[]>(() =>
    Array.from({ length: MIN_PANES }, (_, i) =>
      makePaneTextFromProps(i, MIN_PANES, {
        eyebrowText,
        titleText,
        descriptionText,
        authorsText,
        paperLink,
      })
    )
  );

  // Keep panes array in sync with paneCount, refreshing un-dirty fields from props.
  useEffect(() => {
    setPanes((prev) => {
      const next: PaneText[] = [];
      for (let i = 0; i < paneCount; i += 1) {
        const existing = prev[i];
        if (existing) {
          next.push(refreshPaneFromProps(existing, i, paneCount, propsRef.current));
        } else {
          next.push(makePaneTextFromProps(i, paneCount, propsRef.current));
        }
      }
      return next;
    });
    setActivePane((p) => Math.min(p, paneCount - 1));
  }, [paneCount]);

  // When props change, refresh non-dirty fields across all panes.
  useEffect(() => {
    setPanes((prev) =>
      prev.map((p, i) =>
        refreshPaneFromProps(p, i, prev.length, {
          eyebrowText,
          titleText,
          descriptionText,
          authorsText,
          paperLink,
        })
      )
    );
  }, [eyebrowText, titleText, descriptionText, authorsText, paperLink]);

  const template = TEMPLATES[templateKey];
  const displayFont = displayFontOverride ?? template.displayFont;
  const bodyFont = bodyFontOverride ?? template.bodyFont;

  useEffect(() => {
    void ensureGoogleFont(displayFont, template.typography.title.weight, template.typography.title.italic);
    void ensureGoogleFont(displayFont, template.typography.eyebrow.weight, template.typography.eyebrow.italic);
    void ensureGoogleFont(bodyFont, template.typography.description.weight, template.typography.description.italic);
    void ensureGoogleFont(bodyFont, template.typography.authors.weight, template.typography.authors.italic);
  }, [displayFont, bodyFont, template]);

  // arXiv detection from paperLink.
  useEffect(() => {
    let cancelled = false;
    setArxivEprintUrl(null);
    if (!paperLink || !paperLink.trim()) return;
    getArxivEprintUrl(paperLink)
      .then((url) => {
        if (!cancelled) setArxivEprintUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [paperLink]);


  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const isImageLike = (f: File): boolean =>
      f.type.startsWith("image/") ||
      f.type === "application/pdf" ||
      /\.(png|jpe?g|gif|pdf|eps|ps)$/i.test(f.name);
    const arr = Array.from(files).filter(isImageLike);
    if (arr.length === 0) return;
    const loaded: BgImage[] = [];
    let epsSkipped = 0;
    for (const file of arr) {
      try {
        if (/\.(eps|ps)$/i.test(file.name) || file.type === "application/postscript") {
          epsSkipped += 1;
          continue;
        }
        let src = await fileToDataUrl(file);
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          src = await pdfDataUrlToPngDataUrl(src);
        }
        loaded.push({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src,
          name: file.name,
          source: "upload",
        });
      } catch {
        // ignore failures, continue
      }
    }
    if (loaded.length > 0) setImages((prev) => [...prev, ...loaded]);
    if (epsSkipped > 0) {
      setArxivInfo(
        `${epsSkipped} EPS file${epsSkipped === 1 ? "" : "s"} skipped — preview unavailable in-app.`
      );
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer?.files) {
        void handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void handleFiles(e.target.files);
    e.target.value = "";
  };

  async function handleOpenSource() {
    if (!arxivEprintUrl) return;
    try {
      await openExternal(arxivEprintUrl);
    } catch (e) {
      setArxivError(`Could not open browser: ${e}`);
    }
  }

  async function handleFetchArxivFigures() {
    if (!paperLink) return;
    setArxivLoading(true);
    setArxivError(null);
    setArxivInfo(null);
    try {
      const figures = await fetchArxivFigures(paperLink);
      let skippedEps = 0;
      let pdfConverted = 0;
      let pdfFailed = 0;
      const newImages: BgImage[] = [];
      for (let i = 0; i < figures.length; i += 1) {
        const f = figures[i];
        if (f.mimeType === "application/postscript") {
          skippedEps += 1;
          continue;
        }
        let src = bytesFromBase64(f.dataBase64, f.mimeType);
        if (f.mimeType === "application/pdf") {
          try {
            src = await pdfDataUrlToPngDataUrl(src);
            pdfConverted += 1;
          } catch {
            pdfFailed += 1;
            continue;
          }
        }
        newImages.push({
          id: `arxiv-${Date.now()}-${i}`,
          src,
          name: f.filename,
          source: "arxiv",
        });
      }
      if (newImages.length === 0) {
        setArxivError(
          `arXiv returned ${figures.length} file(s) but none could be used as backgrounds.` +
            (skippedEps > 0
              ? ` (${skippedEps} EPS — preview unavailable in-app; download the LaTeX source to use them.)`
              : "")
        );
        return;
      }
      setImages((prev) => [...prev, ...newImages]);
      const notes: string[] = [];
      notes.push(`Added ${newImages.length} figure${newImages.length === 1 ? "" : "s"}.`);
      if (pdfConverted > 0) notes.push(`${pdfConverted} PDF rasterised.`);
      if (pdfFailed > 0) notes.push(`${pdfFailed} PDF failed to rasterise.`);
      if (skippedEps > 0) notes.push(`${skippedEps} EPS skipped (download source to use).`);
      setArxivInfo(notes.join(" "));
    } catch (e) {
      setArxivError(String(e));
    } finally {
      setArxivLoading(false);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  function moveImage(id: string, dir: -1 | 1) {
    setImages((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updatePaneField(paneIndex: number, field: keyof Omit<PaneText, "dirty">, value: string) {
    setPanes((prev) => {
      const next = [...prev];
      const current = next[paneIndex];
      if (!current) return prev;
      next[paneIndex] = {
        ...current,
        [field]: value,
        dirty: { ...current.dirty, [field]: true },
      };
      return next;
    });
  }

  const masterWidthPx = paneCount * CANVAS_SIZE;

  function applyTextStyle(
    ctx: CanvasRenderingContext2D,
    block: TextBlock,
    fontFamily: string,
    color: string,
    scale: number
  ) {
    const size = Math.round(block.fontSize * scale);
    ctx.font = `${block.italic ? "italic " : ""}${block.weight} ${size}px ${buildFontFamily(fontFamily)}`;
    ctx.fillStyle = color;
    // Letter-spacing on Canvas2D is supported in modern WebKit / Chromium.
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = `${block.letterSpacing}px`;
    return size;
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const words = cleaned.split(" ");
    const lines: string[] = [];
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  }

  async function renderPaneCanvas(paneIndex: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    // 1. Base color
    ctx.fillStyle = template.baseColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 2. Background images — render entire master to a wide canvas, then crop this pane.
    if (images.length > 0) {
      const master = document.createElement("canvas");
      master.width = masterWidthPx;
      master.height = CANVAS_SIZE;
      const mctx = master.getContext("2d");
      if (mctx) {
        const loaded = await Promise.all(images.map((img) => loadImage(img.src).catch(() => null)));
        loaded.forEach((img, i) => {
          if (!img) return;
          const slot = paneSlotForImage(i, images.length, paneCount);
          drawCoverImage(mctx, img, slot.left, 0, slot.width, CANVAS_SIZE);
          applyHorizontalCrossfade(mctx, slot.left, slot.width, i, images.length);
        });
        ctx.drawImage(
          master,
          paneIndex * CANVAS_SIZE,
          0,
          CANVAS_SIZE,
          CANVAS_SIZE,
          0,
          0,
          CANVAS_SIZE,
          CANVAS_SIZE
        );
      }
    }

    // 3. Tint layer
    ctx.save();
    ctx.globalAlpha = template.tintOpacity * tintStrength;
    ctx.globalCompositeOperation = template.tintBlend as GlobalCompositeOperation;
    ctx.fillStyle = template.tintColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.restore();

    // 4. Gradient overlay
    ctx.save();
    ctx.globalCompositeOperation = template.gradientBlend as GlobalCompositeOperation;
    ctx.globalAlpha = gradientStrength;
    const gradient = makeCanvasGradient(ctx, template);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.restore();

    // 5. Text
    drawPaneText(ctx, paneIndex);

    // 6. Logo
    await drawLogo(ctx);

    return canvas;
  }

  function makeCanvasGradient(ctx: CanvasRenderingContext2D, t: TemplateDef): CanvasGradient {
    if (t.gradient === "vertical") {
      const g = ctx.createLinearGradient(0, 0, 0, CANVAS_SIZE);
      g.addColorStop(0, t.gradientColorStart);
      g.addColorStop(1, t.gradientColorEnd);
      return g;
    }
    if (t.gradient === "radial") {
      const g = ctx.createRadialGradient(
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2,
        CANVAS_SIZE * 0.1,
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2,
        CANVAS_SIZE * 0.75
      );
      g.addColorStop(0, t.gradientColorStart);
      g.addColorStop(1, t.gradientColorEnd);
      return g;
    }
    if (t.gradient === "corner_tl") {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, CANVAS_SIZE);
      g.addColorStop(0, t.gradientColorStart);
      g.addColorStop(1, t.gradientColorEnd);
      return g;
    }
    const g = ctx.createRadialGradient(CANVAS_SIZE, CANVAS_SIZE, 0, CANVAS_SIZE, CANVAS_SIZE, CANVAS_SIZE);
    g.addColorStop(0, t.gradientColorStart);
    g.addColorStop(1, t.gradientColorEnd);
    return g;
  }

  function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) {
    const imageRatio = img.width / img.height;
    const slotRatio = dw / dh;
    // Base "cover" source rectangle that fills the slot exactly.
    let baseSw: number;
    let baseSh: number;
    if (imageRatio > slotRatio) {
      baseSw = img.height * slotRatio;
      baseSh = img.height;
    } else {
      baseSw = img.width;
      baseSh = img.width / slotRatio;
    }
    // imageScale > 1 → zoom into the image (sample less source).
    // imageScale < 1 → zoom out (clamp so source can't exceed the image).
    const scale = Math.max(0.25, Math.min(4, imageScale));
    const sw = Math.min(img.width, baseSw / scale);
    const sh = Math.min(img.height, baseSh / scale);
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function applyHorizontalCrossfade(
    ctx: CanvasRenderingContext2D,
    slotLeft: number,
    slotWidth: number,
    imageIndex: number,
    imageCount: number
  ) {
    if (imageCount < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    if (imageIndex > 0) {
      const fadeWidth = Math.min(CROSSFADE_PX, slotWidth / 2);
      const g = ctx.createLinearGradient(slotLeft, 0, slotLeft + fadeWidth, 0);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(slotLeft, 0, fadeWidth, CANVAS_SIZE);
    }
    if (imageIndex < imageCount - 1) {
      const fadeWidth = Math.min(CROSSFADE_PX, slotWidth / 2);
      const g = ctx.createLinearGradient(slotLeft + slotWidth - fadeWidth, 0, slotLeft + slotWidth, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = g;
      ctx.fillRect(slotLeft + slotWidth - fadeWidth, 0, fadeWidth, CANVAS_SIZE);
    }
    ctx.restore();
  }

  function drawPaneText(ctx: CanvasRenderingContext2D, paneIndex: number) {
    const pane = panes[paneIndex];
    if (!pane) return;
    const align = template.align;
    const xAnchor =
      align === "center"
        ? CANVAS_SIZE / 2
        : align === "right"
        ? CANVAS_SIZE - SAFE_PADDING
        : SAFE_PADDING;
    ctx.textAlign = align;
    ctx.textBaseline = "top";

    const maxTextWidth = CANVAS_SIZE - SAFE_PADDING * 2;

    type Block = {
      text: string;
      style: TextBlock;
      color: string;
      font: string;
      isTitle?: boolean;
      isDescription?: boolean;
      uppercase?: boolean;
    };

    const blocks: Block[] = [];
    if (pane.eyebrow.trim()) {
      blocks.push({
        text: pane.eyebrow,
        style: template.typography.eyebrow,
        color: template.eyebrowColor,
        font: displayFont,
        uppercase: template.typography.eyebrow.uppercase,
      });
    }
    if (pane.title.trim()) {
      blocks.push({
        text: pane.title,
        style: template.typography.title,
        color: template.textColor,
        font: displayFont,
        isTitle: true,
        uppercase: template.typography.title.uppercase,
      });
    }
    if (pane.description.trim()) {
      blocks.push({
        text: pane.description,
        style: template.typography.description,
        color: template.textColor,
        font: bodyFont,
        isDescription: true,
        uppercase: template.typography.description.uppercase,
      });
    }
    if (pane.authors.trim()) {
      blocks.push({
        text: pane.authors,
        style: template.typography.authors,
        color: template.authorsColor,
        font: bodyFont,
        uppercase: template.typography.authors.uppercase,
      });
    }

    // Layout pass: compute total height
    const measured = blocks.map((b) => {
      const scale = b.isTitle ? titleScale : b.isDescription ? descriptionScale : 1;
      const size = applyTextStyle(ctx, b.style, b.font, b.color, scale);
      const text = b.uppercase ? b.text.toUpperCase() : b.text;
      const lines = wrapText(ctx, text, maxTextWidth);
      const lineHeight = size * b.style.lineHeight;
      return { ...b, size, lines, lineHeight, text };
    });

    const gapBetween = (prevKind: string, nextKind: string): number => {
      if (prevKind === "eyebrow" && nextKind === "title") return gapEyebrowTitle;
      if (prevKind === "title" && nextKind === "description") return gapTitleDescription;
      if (prevKind === "description" && nextKind === "authors") return gapDescriptionAuthors;
      if (prevKind === "title" && nextKind === "authors") return gapDescriptionAuthors;
      return 18;
    };

    const kinds = measured.map((m) =>
      m.isTitle ? "title" : m.isDescription ? "description" : m.style === template.typography.eyebrow ? "eyebrow" : "authors"
    );

    const totalHeight = measured.reduce((sum, m, i) => {
      const gap = i < measured.length - 1 ? gapBetween(kinds[i], kinds[i + 1]) : 0;
      return sum + m.lines.length * m.lineHeight + gap;
    }, 0);

    const reserveBottom = LOGO_HEIGHT_PX + LOGO_MARGIN_PX * 2;
    let y =
      template.vAlign === "top"
        ? SAFE_PADDING
        : template.vAlign === "middle"
        ? Math.max(SAFE_PADDING, (CANVAS_SIZE - totalHeight) / 2)
        : Math.max(SAFE_PADDING, CANVAS_SIZE - reserveBottom - totalHeight);

    measured.forEach((m, idx) => {
      applyTextStyle(ctx, m.style, m.font, m.color, m.isTitle ? titleScale : m.isDescription ? descriptionScale : 1);
      m.lines.forEach((line, li) => {
        ctx.fillText(line, xAnchor, y + li * m.lineHeight);
      });
      const nextGap = idx < measured.length - 1 ? gapBetween(kinds[idx], kinds[idx + 1]) : 0;
      y += m.lines.length * m.lineHeight + nextGap;
    });
  }

  async function drawLogo(ctx: CanvasRenderingContext2D) {
    try {
      const img = await loadImage(usmccLogo);
      const targetH = LOGO_HEIGHT_PX;
      const targetW = (img.width / img.height) * targetH;
      ctx.drawImage(
        img,
        CANVAS_SIZE - targetW - LOGO_MARGIN_PX,
        CANVAS_SIZE - targetH - LOGO_MARGIN_PX,
        targetW,
        targetH
      );
    } catch {
      // ignore logo failure
    }
  }

  async function downloadAll() {
    setExporting(true);
    setExportError(null);
    try {
      const slug = kebab(propsRef.current.titleText || "usmcc-paper");
      for (let i = 0; i < paneCount; i += 1) {
        const canvas = await renderPaneCanvas(i);
        const url = canvas.toDataURL("image/png");
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `usmcc-${slug}-pane-${i + 1}.png`;
        anchor.click();
        await new Promise((r) => window.setTimeout(r, 200));
      }
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function downloadPane(paneIndex: number) {
    setExporting(true);
    setExportError(null);
    try {
      const canvas = await renderPaneCanvas(paneIndex);
      const url = canvas.toDataURL("image/png");
      const anchor = document.createElement("a");
      const slug = kebab(propsRef.current.titleText || "usmcc-paper");
      anchor.href = url;
      anchor.download = `usmcc-${slug}-pane-${paneIndex + 1}.png`;
      anchor.click();
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="ig-designer">
      <div className="ig-designer-header">
        <div>
          <h2>Instagram Carousel</h2>
          <p>
            Multi-pane carousel with continuous background. Drop in images or fetch figures from arXiv.
          </p>
        </div>
        <span className="ig-pane-count-badge">{paneCount} panes · 1080×1080 each</span>
      </div>

      <div className="ig-template-row">
        {TEMPLATE_ORDER.map((key) => {
          const t = TEMPLATES[key];
          return (
            <button
              key={key}
              className={`ig-template-chip ${templateKey === key ? "active" : ""}`}
              onClick={() => {
                setTemplateKey(key);
                setDisplayFontOverride(null);
                setBodyFontOverride(null);
              }}
              style={{
                background: t.baseColor,
                color: t.textColor,
                borderColor: templateKey === key ? t.eyebrowColor : "transparent",
              }}
            >
              <span className="ig-template-name" style={{ fontFamily: buildFontFamily(t.displayFont) }}>
                {t.name}
              </span>
              <span className="ig-template-pair" style={{ color: t.eyebrowColor }}>
                {t.displayFont} + {t.bodyFont}
              </span>
            </button>
          );
        })}
      </div>

      <div className="ig-layout">
        <div className="ig-controls">
          <div className="ig-control-group">
            <label>Background images</label>
            <div
              className="ig-dropzone"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <strong>Drop images or click to upload</strong>
              <span>PNG / JPG · multiple files OK</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={onFileInput}
              />
            </div>
            {arxivEprintUrl && (
              <div className="ig-arxiv-row">
                <button
                  type="button"
                  className="ig-arxiv-link"
                  onClick={handleOpenSource}
                  title={arxivEprintUrl}
                >
                  Download LaTeX source (.tar.gz)
                </button>
                <button
                  className="btn-secondary"
                  onClick={handleFetchArxivFigures}
                  disabled={arxivLoading}
                >
                  {arxivLoading ? "Fetching figures…" : "Fetch arXiv figures"}
                </button>
              </div>
            )}
            {arxivError && <div className="ig-warn">{arxivError}</div>}
            {arxivInfo && <div className="ig-info">{arxivInfo}</div>}
            {images.length > 0 && (
              <div className="ig-thumb-grid">
                {images.map((img, idx) => (
                  <div className="ig-thumb" key={img.id}>
                    <img src={img.src} alt={img.name} />
                    <div className="ig-thumb-meta">
                      <span title={img.name}>{img.name}</span>
                      <span className="ig-thumb-source">{img.source}</span>
                    </div>
                    <div className="ig-thumb-actions">
                      <button onClick={() => moveImage(img.id, -1)} disabled={idx === 0}>
                        ←
                      </button>
                      <button onClick={() => moveImage(img.id, 1)} disabled={idx === images.length - 1}>
                        →
                      </button>
                      <button className="ig-thumb-remove" onClick={() => removeImage(img.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ig-control-group">
            <label>Panes</label>
            <div className="ig-slider-row">
              <span>Count</span>
              <input
                type="range"
                min={MIN_PANES}
                max={MAX_PANES}
                step={1}
                value={paneCount}
                onChange={(e) => setPaneCountOverride(Number(e.target.value))}
              />
              <strong>{paneCount}</strong>
            </div>
            <small>
              Defaults to max(2, images). Background images are laid edge-to-edge across all panes.
            </small>
          </div>

          <div className="ig-control-group">
            <label>Overlay & background</label>
            <div className="ig-slider-row">
              <span>Gradient</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={gradientStrength}
                onChange={(e) => setGradientStrength(Number(e.target.value))}
              />
              <strong>{gradientStrength.toFixed(2)}</strong>
            </div>
            <div className="ig-slider-row">
              <span>Tint</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={tintStrength}
                onChange={(e) => setTintStrength(Number(e.target.value))}
              />
              <strong>{tintStrength.toFixed(2)}</strong>
            </div>
            <div className="ig-slider-row">
              <span>Image zoom</span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={imageScale}
                onChange={(e) => setImageScale(Number(e.target.value))}
              />
              <strong>{Math.round(imageScale * 100)}%</strong>
            </div>
          </div>

          <div className="ig-control-group">
            <label>Typography</label>
            <div className="ig-slider-row">
              <span>Title size</span>
              <input
                type="range"
                min={0.55}
                max={1.45}
                step={0.01}
                value={titleScale}
                onChange={(e) => setTitleScale(Number(e.target.value))}
              />
              <strong>{Math.round(titleScale * 100)}%</strong>
            </div>
            <div className="ig-slider-row">
              <span>Body size</span>
              <input
                type="range"
                min={0.7}
                max={1.4}
                step={0.01}
                value={descriptionScale}
                onChange={(e) => setDescriptionScale(Number(e.target.value))}
              />
              <strong>{Math.round(descriptionScale * 100)}%</strong>
            </div>
            <div className="ig-slider-row">
              <span>Eye→Title</span>
              <input
                type="range"
                min={0}
                max={120}
                step={2}
                value={gapEyebrowTitle}
                onChange={(e) => setGapEyebrowTitle(Number(e.target.value))}
              />
              <strong>{gapEyebrowTitle}px</strong>
            </div>
            <div className="ig-slider-row">
              <span>Title→Desc</span>
              <input
                type="range"
                min={0}
                max={160}
                step={2}
                value={gapTitleDescription}
                onChange={(e) => setGapTitleDescription(Number(e.target.value))}
              />
              <strong>{gapTitleDescription}px</strong>
            </div>
            <div className="ig-slider-row">
              <span>Desc→Auth</span>
              <input
                type="range"
                min={0}
                max={140}
                step={2}
                value={gapDescriptionAuthors}
                onChange={(e) => setGapDescriptionAuthors(Number(e.target.value))}
              />
              <strong>{gapDescriptionAuthors}px</strong>
            </div>
          </div>

          <div className="ig-control-group">
            <label>Pane {activePane + 1} text</label>
            <div className="ig-pane-tabs">
              {panes.map((_, i) => (
                <button
                  key={i}
                  className={`ig-pane-tab ${activePane === i ? "active" : ""}`}
                  onClick={() => setActivePane(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="ig-field">
              <span>Eyebrow</span>
              <input
                type="text"
                value={panes[activePane]?.eyebrow ?? ""}
                onChange={(e) => updatePaneField(activePane, "eyebrow", e.target.value)}
              />
            </div>
            <div className="ig-field">
              <span>Title</span>
              <textarea
                rows={2}
                value={panes[activePane]?.title ?? ""}
                onChange={(e) => updatePaneField(activePane, "title", e.target.value)}
              />
            </div>
            <div className="ig-field">
              <span>Description</span>
              <textarea
                rows={4}
                value={panes[activePane]?.description ?? ""}
                onChange={(e) => updatePaneField(activePane, "description", e.target.value)}
              />
            </div>
            <div className="ig-field">
              <span>Authors</span>
              <input
                type="text"
                value={panes[activePane]?.authors ?? ""}
                onChange={(e) => updatePaneField(activePane, "authors", e.target.value)}
              />
            </div>
          </div>

          <div className="ig-control-group">
            <label>Export</label>
            <div className="ig-inline-row">
              <button className="btn-primary" onClick={downloadAll} disabled={exporting}>
                {exporting ? "Rendering…" : `Download all ${paneCount} panes`}
              </button>
              <button
                className="btn-secondary"
                onClick={() => downloadPane(activePane)}
                disabled={exporting}
              >
                Pane {activePane + 1} only
              </button>
            </div>
            {exportError && <div className="ig-warn">{exportError}</div>}
            <small>Each pane exports as a 1080×1080 PNG suitable for Instagram carousel.</small>
          </div>
        </div>

        <div className="ig-preview-wrap">
          <div className="ig-preview-frame">
            <div
              className="ig-preview-scroll"
              style={{
                width: masterWidthPx * PREVIEW_SCALE,
                height: CANVAS_SIZE * PREVIEW_SCALE,
              }}
            >
              <div
                className="ig-preview-master"
                style={{
                  width: masterWidthPx,
                  height: CANVAS_SIZE,
                  transform: `scale(${PREVIEW_SCALE})`,
                  background: template.baseColor,
                }}
              >
                {/* Image layer — each image lives in a slot-sized clipping div so transform scale
                    visually zooms within the slot without breaking the cross-fade mask. */}
                <div className="ig-image-layer">
                  {images.map((img, i) => {
                    const slot = paneSlotForImage(i, images.length, paneCount);
                    const fade = Math.min(CROSSFADE_PX, slot.width / 2);
                    const leftStop = i > 0 ? `transparent 0px, black ${fade}px` : "black 0px";
                    const rightStop =
                      i < images.length - 1
                        ? `black calc(100% - ${fade}px), transparent 100%`
                        : "black 100%";
                    const mask = `linear-gradient(to right, ${leftStop}, ${rightStop})`;
                    return (
                      <div
                        key={img.id}
                        style={{
                          position: "absolute",
                          left: slot.left,
                          top: 0,
                          width: slot.width,
                          height: CANVAS_SIZE,
                          overflow: "hidden",
                          WebkitMaskImage: mask,
                          maskImage: mask,
                        }}
                      >
                        <img
                          src={img.src}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            transform: `scale(${imageScale})`,
                            transformOrigin: "center center",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Tint layer */}
                <div
                  className="ig-tint-layer"
                  style={{
                    backgroundColor: template.tintColor,
                    opacity: template.tintOpacity * tintStrength,
                    mixBlendMode: template.tintBlend as React.CSSProperties["mixBlendMode"],
                  }}
                />
                {/* Gradient layer */}
                <div
                  className="ig-gradient-layer"
                  style={{
                    background: gradientCss(template),
                    opacity: gradientStrength,
                    mixBlendMode: template.gradientBlend as React.CSSProperties["mixBlendMode"],
                  }}
                />
                {/* Per-pane text + logo */}
                {panes.map((pane, i) => (
                  <PanePreview
                    key={i}
                    pane={pane}
                    paneIndex={i}
                    paneCount={paneCount}
                    template={template}
                    displayFont={displayFont}
                    bodyFont={bodyFont}
                    titleScale={titleScale}
                    descriptionScale={descriptionScale}
                    gapEyebrowTitle={gapEyebrowTitle}
                    gapTitleDescription={gapTitleDescription}
                    gapDescriptionAuthors={gapDescriptionAuthors}
                    isActive={activePane === i}
                    onSelect={() => setActivePane(i)}
                  />
                ))}
                {/* Pane boundary guides */}
                {Array.from({ length: paneCount - 1 }, (_, i) => (
                  <div
                    key={`guide-${i}`}
                    className="ig-pane-guide"
                    style={{ left: (i + 1) * CANVAS_SIZE - 1 }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="ig-preview-meta">
            <span>Master: {masterWidthPx}×{CANVAS_SIZE}</span>
            <span>Scroll →</span>
            <span>Display: {displayFont}</span>
            <span>Body: {bodyFont}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

interface PanePreviewProps {
  pane: PaneText;
  paneIndex: number;
  paneCount: number;
  template: TemplateDef;
  displayFont: string;
  bodyFont: string;
  titleScale: number;
  descriptionScale: number;
  gapEyebrowTitle: number;
  gapTitleDescription: number;
  gapDescriptionAuthors: number;
  isActive: boolean;
  onSelect: () => void;
}

function PanePreview({
  pane,
  paneIndex,
  template,
  displayFont,
  bodyFont,
  titleScale,
  descriptionScale,
  gapEyebrowTitle,
  gapTitleDescription,
  gapDescriptionAuthors,
  isActive,
  onSelect,
}: PanePreviewProps) {
  const align = template.align;
  const vAlign = template.vAlign;
  const justify =
    vAlign === "top" ? "flex-start" : vAlign === "middle" ? "center" : "flex-end";
  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  const itemsAlign =
    align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  function blockStyle(
    block: TextBlock,
    color: string,
    font: string,
    scale = 1,
    marginBottom = 0
  ): React.CSSProperties {
    return {
      fontFamily: buildFontFamily(font),
      fontSize: block.fontSize * scale,
      lineHeight: block.lineHeight,
      letterSpacing: `${block.letterSpacing}px`,
      fontWeight: block.weight,
      fontStyle: block.italic ? "italic" : "normal",
      textTransform: block.uppercase ? "uppercase" : "none",
      color,
      maxWidth: "100%",
      wordBreak: "break-word",
      marginBottom,
    };
  }

  type Kind = "eyebrow" | "title" | "description" | "authors";
  const present: Kind[] = [];
  if (pane.eyebrow.trim()) present.push("eyebrow");
  if (pane.title.trim()) present.push("title");
  if (pane.description.trim()) present.push("description");
  if (pane.authors.trim()) present.push("authors");

  const gapBetween = (a: Kind, b: Kind): number => {
    if (a === "eyebrow" && b === "title") return gapEyebrowTitle;
    if (a === "title" && b === "description") return gapTitleDescription;
    if (a === "description" && b === "authors") return gapDescriptionAuthors;
    if (a === "title" && b === "authors") return gapDescriptionAuthors;
    return 18;
  };

  const marginFor = (kind: Kind): number => {
    const idx = present.indexOf(kind);
    const next = present[idx + 1];
    return next ? gapBetween(kind, next) : 0;
  };

  return (
    <div
      className={`ig-pane ${isActive ? "active" : ""}`}
      style={{
        position: "absolute",
        left: paneIndex * CANVAS_SIZE,
        top: 0,
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
      }}
      onClick={onSelect}
    >
      <div
        className="ig-pane-text"
        style={{
          position: "absolute",
          left: SAFE_PADDING,
          top: SAFE_PADDING,
          width: CANVAS_SIZE - SAFE_PADDING * 2,
          height: CANVAS_SIZE - SAFE_PADDING * 2 - (LOGO_HEIGHT_PX + LOGO_MARGIN_PX),
          display: "flex",
          flexDirection: "column",
          justifyContent: justify,
          alignItems: itemsAlign,
          textAlign,
        }}
      >
        {pane.eyebrow.trim() && (
          <div
            style={blockStyle(
              template.typography.eyebrow,
              template.eyebrowColor,
              displayFont,
              1,
              marginFor("eyebrow")
            )}
          >
            {pane.eyebrow}
          </div>
        )}
        {pane.title.trim() && (
          <div
            style={blockStyle(
              template.typography.title,
              template.textColor,
              displayFont,
              titleScale,
              marginFor("title")
            )}
          >
            {pane.title}
          </div>
        )}
        {pane.description.trim() && (
          <div
            style={blockStyle(
              template.typography.description,
              template.textColor,
              bodyFont,
              descriptionScale,
              marginFor("description")
            )}
          >
            {pane.description}
          </div>
        )}
        {pane.authors.trim() && (
          <div
            style={blockStyle(
              template.typography.authors,
              template.authorsColor,
              bodyFont,
              1,
              marginFor("authors")
            )}
          >
            {pane.authors}
          </div>
        )}
      </div>
      <img
        src={usmccLogo}
        alt="USMCC"
        className="ig-pane-logo"
        style={{
          position: "absolute",
          right: LOGO_MARGIN_PX,
          bottom: LOGO_MARGIN_PX,
          height: LOGO_HEIGHT_PX,
          width: "auto",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
