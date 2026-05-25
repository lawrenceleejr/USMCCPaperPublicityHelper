import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { fetchArxivFigures, fetchArxivPdf, getArxivEprintUrl, openExternal } from "../api";
import { pdfDataUrlToPngDataUrl, pdfFirstPageTopFractionPng } from "../pdfRender";
import usmccLogo from "../assets/LogoUSMCC_white.png";

export interface InstagramDesignerHandle {
  renderFirstPanePng(): Promise<string>;
}

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

type Align = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";

interface GradientStop {
  offset: number;
  color: string;
}

// A single gradient pass. Templates compose several with different blend modes
// to get layered, hand-crafted-looking light rather than a single linear ramp.
type GradientLayer =
  | {
      kind: "linear";
      // CSS angle convention: 0 = bottom → top, 90 = left → right, 180 = top → bottom.
      angle: number;
      stops: GradientStop[];
      blend: BlendMode;
      opacity: number;
    }
  | {
      kind: "radial";
      cx: number;
      cy: number;
      r: number;
      stops: GradientStop[];
      blend: BlendMode;
      opacity: number;
    };

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
  gradientLayers: GradientLayer[];
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
  // Mirror the template's horizontal alignment for this pane and move the
  // logo to the opposite corner. Useful when the background image's focal
  // subject sits on the side the template wants the text on.
  flipped: boolean;
  dirty: { eyebrow: boolean; title: boolean; description: boolean; authors: boolean };
}

const CANVAS_SIZE = 1080;
const SAFE_PADDING = 88;
// Soft cross-fade width between adjacent images. ~22% of a slot makes the
// transition feel deliberate rather than mechanical; combined with the
// smoothstep alpha curve below it reads as a feathered edge rather than a
// hard ramp.
const CROSSFADE_PX = 240;

/**
 * Smoothstep alpha stops used by both the CSS mask-image and the canvas
 * destination-out crossfade. Approximates 3t² − 2t³ in seven stops, which is
 * indistinguishable from the true curve to the eye while keeping the CSS
 * string short. Stops are paired so the same array can be reversed for the
 * trailing edge of the previous image.
 */
const CROSSFADE_STOPS_OPAQUE_TO_TRANSPARENT: { t: number; a: number }[] = [
  { t: 0, a: 1 },
  { t: 0.1, a: 0.972 },
  { t: 0.25, a: 0.844 },
  { t: 0.5, a: 0.5 },
  { t: 0.75, a: 0.156 },
  { t: 0.9, a: 0.028 },
  { t: 1, a: 0 },
];
// Logo sizing follows a 15% mark height with x-height padding (≈50% of mark height)
// from the edge — proportions that read as deliberate, not slapped-on. The text
// safe-area below reserves logo height + padding so titles never collide.
const LOGO_HEIGHT_PX = 160;
const LOGO_MARGIN_PX = 80;
const FONT_LOAD_TIMEOUT_MS = 4000;
const MAX_PANES = 5;
const MIN_PANES = 2;
const DESCRIPTION_MAX_CHARS = 240;
const FALLBACK_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// Faces shipped with macOS / iOS that we should not try to load from Google Fonts.
const SYSTEM_FONTS = new Set<string>([
  "Heiti SC",
  "Heiti TC",
  "PingFang SC",
  "PingFang TC",
  "Hiragino Sans",
  "Hiragino Mincho ProN",
  "Apple SD Gothic Neo",
]);

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  editorial: {
    name: "Editorial",
    displayFont: "Heiti SC",
    bodyFont: "Inter",
    baseColor: "#0a0a0a",
    tintColor: "#0d1b2a",
    tintOpacity: 0.35,
    tintBlend: "multiply",
    gradientLayers: [
      // Baseline spotlight: normal-blend radial that darkens everything
      // outside the text-reading zone. Works identically whether the backdrop
      // is the solid base colour or a varied photographic image, so the
      // "natural spotlight" character of the design survives once background
      // images are added.
      {
        kind: "radial",
        cx: 0.3,
        cy: 0.7,
        r: 1.1,
        stops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 0.5, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.5)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Warm gold highlight from upper-left — a "rim light" feeling that the
      // photographic studio crowd will recognise.
      {
        kind: "radial",
        cx: 0.2,
        cy: 0.15,
        r: 0.75,
        stops: [
          { offset: 0, color: "rgba(245,200,66,0.22)" },
          { offset: 0.55, color: "rgba(245,200,66,0)" },
        ],
        blend: "screen",
        opacity: 1,
      },
      // Multi-stop dark wash at the bottom for type readability.
      {
        kind: "linear",
        angle: 180,
        stops: [
          { offset: 0.3, color: "rgba(0,0,0,0)" },
          { offset: 0.7, color: "rgba(0,0,0,0.55)" },
          { offset: 1, color: "rgba(0,0,0,0.92)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
      // Soft vignette so the corners recede.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.5,
        r: 0.95,
        stops: [
          { offset: 0.55, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.55)" },
        ],
        blend: "multiply",
        opacity: 0.9,
      },
    ],
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
    displayFont: "Heiti SC",
    bodyFont: "Space Mono",
    baseColor: "#f7f7f4",
    tintColor: "#0a0a0a",
    tintOpacity: 0.18,
    tintBlend: "multiply",
    gradientLayers: [
      // Baseline soft halo around the text-reading zone (top-left) so the
      // design feels intentional over any backdrop. Light template, so the
      // halo is brighter rather than darker.
      {
        kind: "radial",
        cx: 0.25,
        cy: 0.25,
        r: 0.95,
        stops: [
          { offset: 0, color: "rgba(255,255,255,0.40)" },
          { offset: 0.45, color: "rgba(255,255,255,0.10)" },
          { offset: 1, color: "rgba(0,0,0,0.18)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Bright paper-wash with a soft fade-down toward a hint of shadow at the bottom.
      {
        kind: "linear",
        angle: 180,
        stops: [
          { offset: 0, color: "rgba(255,255,255,0.55)" },
          { offset: 0.5, color: "rgba(247,247,244,0)" },
          { offset: 1, color: "rgba(0,0,0,0.10)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Cool top-right accent — barely there, just enough to feel intentional.
      {
        kind: "radial",
        cx: 0.85,
        cy: 0.12,
        r: 0.55,
        stops: [
          { offset: 0, color: "rgba(124,58,237,0.14)" },
          { offset: 1, color: "rgba(124,58,237,0)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
    ],
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
    displayFont: "Heiti SC",
    bodyFont: "Lora",
    baseColor: "#1a1a2e",
    tintColor: "#7c3aed",
    tintOpacity: 0.42,
    tintBlend: "overlay",
    gradientLayers: [
      // Baseline centre spotlight — title is centre-middle; darken outer area
      // with normal blend so the spotlight reads against any backdrop.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.5,
        r: 1.0,
        stops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 0.55, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.55)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Big violet spotlight, centred high — title sits in the brightest cone.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.3,
        r: 0.7,
        stops: [
          { offset: 0, color: "rgba(168,85,247,0.52)" },
          { offset: 0.55, color: "rgba(124,58,237,0.1)" },
          { offset: 1, color: "rgba(124,58,237,0)" },
        ],
        blend: "screen",
        opacity: 1,
      },
      // Heavy outer vignette pulls the eye to the centre.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.5,
        r: 0.95,
        stops: [
          { offset: 0.45, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.8)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
    ],
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
    displayFont: "Heiti SC",
    bodyFont: "Source Sans 3",
    baseColor: "#f5f0e8",
    tintColor: "#7c2d12",
    tintOpacity: 0.22,
    tintBlend: "multiply",
    gradientLayers: [
      // Baseline spotlight around the bottom-left reading zone. Warm light
      // template — slight cream lift around text + soft umber edge fall-off.
      {
        kind: "radial",
        cx: 0.3,
        cy: 0.7,
        r: 1.05,
        stops: [
          { offset: 0, color: "rgba(255,236,200,0.28)" },
          { offset: 0.5, color: "rgba(255,236,200,0.05)" },
          { offset: 1, color: "rgba(64,28,8,0.45)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Sunrise-temperature linear: cream → wheat → umber → deep brown.
      {
        kind: "linear",
        angle: 175,
        stops: [
          { offset: 0, color: "rgba(255,236,180,0.40)" },
          { offset: 0.35, color: "rgba(245,200,140,0.10)" },
          { offset: 0.7, color: "rgba(120,53,15,0.25)" },
          { offset: 1, color: "rgba(64,28,8,0.7)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
      // Soft top-centre warm glow, like an early-morning sun behind cloud.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.05,
        r: 0.55,
        stops: [
          { offset: 0, color: "rgba(255,228,180,0.45)" },
          { offset: 1, color: "rgba(255,228,180,0)" },
        ],
        blend: "screen",
        opacity: 1,
      },
    ],
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
    displayFont: "Heiti SC",
    bodyFont: "Karla",
    baseColor: "#020617",
    tintColor: "#ef4444",
    tintOpacity: 0.5,
    tintBlend: "multiply",
    gradientLayers: [
      // Baseline spotlight around the top-left reading zone — pull the eye
      // there even when the background is a varied image.
      {
        kind: "radial",
        cx: 0.25,
        cy: 0.25,
        r: 1.05,
        stops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 0.5, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.55)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Diagonal red sweep from upper-left toward deep navy in the lower-right.
      {
        kind: "linear",
        angle: 135,
        stops: [
          { offset: 0, color: "rgba(239,68,68,0.85)" },
          { offset: 0.4, color: "rgba(239,68,68,0.25)" },
          { offset: 0.7, color: "rgba(2,6,23,0.30)" },
          { offset: 1, color: "rgba(2,6,23,0.85)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
      // Yellow flash in the top-left — electric punctuation.
      {
        kind: "radial",
        cx: 0.12,
        cy: 0.10,
        r: 0.4,
        stops: [
          { offset: 0, color: "rgba(253,224,71,0.55)" },
          { offset: 1, color: "rgba(253,224,71,0)" },
        ],
        blend: "screen",
        opacity: 1,
      },
      // Deep shadow at the lower-right corner grounds the composition.
      {
        kind: "radial",
        cx: 0.95,
        cy: 0.95,
        r: 0.7,
        stops: [
          { offset: 0, color: "rgba(0,0,0,0.6)" },
          { offset: 1, color: "rgba(0,0,0,0)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
    ],
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
    displayFont: "Heiti SC",
    bodyFont: "DM Sans",
    baseColor: "#0c4a6e",
    tintColor: "#082f49",
    tintOpacity: 0.3,
    tintBlend: "multiply",
    gradientLayers: [
      // Baseline cool spotlight at the bottom-left reading zone.
      {
        kind: "radial",
        cx: 0.3,
        cy: 0.7,
        r: 1.1,
        stops: [
          { offset: 0, color: "rgba(125,211,252,0.10)" },
          { offset: 0.55, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(2,20,35,0.5)" },
        ],
        blend: "normal",
        opacity: 1,
      },
      // Cool sky-blue spotlight upper-centre — feels like sun on open water.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.2,
        r: 0.65,
        stops: [
          { offset: 0, color: "rgba(125,211,252,0.40)" },
          { offset: 0.6, color: "rgba(125,211,252,0.05)" },
          { offset: 1, color: "rgba(125,211,252,0)" },
        ],
        blend: "screen",
        opacity: 1,
      },
      // Deep-ocean fall-off at the bottom so the type sits on still water.
      {
        kind: "linear",
        angle: 180,
        stops: [
          { offset: 0.25, color: "rgba(8,47,73,0)" },
          { offset: 0.65, color: "rgba(8,47,73,0.35)" },
          { offset: 1, color: "rgba(8,47,73,0.92)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
      // Soft corner vignette.
      {
        kind: "radial",
        cx: 0.5,
        cy: 0.5,
        r: 1.0,
        stops: [
          { offset: 0.55, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.45)" },
        ],
        blend: "multiply",
        opacity: 1,
      },
    ],
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
  // System fonts (especially Heiti SC, used as the default title face) are not on
  // Google Fonts. Skip the network fetch — document.fonts.load will resolve from
  // the OS font set if it's installed, and the CSS fallback stack handles the rest.
  if (SYSTEM_FONTS.has(family)) {
    return;
  }
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

// --- WCAG contrast helpers ---------------------------------------------------

function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function parseColorToRgb(color: string): [number, number, number] | null {
  const hex = color.trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m6) {
    const v = parseInt(m6[1], 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }
  const m3 = /^#?([0-9a-f]{3})$/i.exec(hex);
  if (m3) {
    const r = parseInt(m3[1][0] + m3[1][0], 16);
    const g = parseInt(m3[1][1] + m3[1][1], 16);
    const b = parseInt(m3[1][2] + m3[1][2], 16);
    return [r, g, b];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (rgba) {
    return [parseInt(rgba[1], 10), parseInt(rgba[2], 10), parseInt(rgba[3], 10)];
  }
  return null;
}

function wcagContrast(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

interface PaneContrast {
  bgLuminance: number;
  // Sampled average RGB of the text-zone backdrop, for display.
  bgRgb: [number, number, number];
  ratios: { title: number; eyebrow: number; description: number; authors: number };
}

/**
 * Returns the mask gradient CSS used by the backdrop-blur layer. The shape
 * matches where each template puts the text-reading dark area: peak opacity
 * at the bottom / top / middle, fading to transparent everywhere else, so the
 * blur eases in cleanly rather than cutting on/off.
 */
function blurMaskCss(vAlign: VAlign): string {
  if (vAlign === "top") {
    return "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 75%, rgba(0,0,0,0) 100%)";
  }
  if (vAlign === "middle") {
    return "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0) 80%)";
  }
  return "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,1) 65%, rgba(0,0,0,1) 100%)";
}

/** Mirror of blurMaskCss for canvas — same geometry, but written as
 *  CanvasGradient stops. Caller decides whether to use a linear or radial. */
function applyBlurMaskGradient(
  ctx: CanvasRenderingContext2D,
  vAlign: VAlign,
  size: number
) {
  ctx.globalCompositeOperation = "destination-in";
  if (vAlign === "top") {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.35, "rgba(0,0,0,1)");
    g.addColorStop(0.75, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
  } else if (vAlign === "middle") {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.8);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.45, "rgba(0,0,0,0.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.25, "rgba(0,0,0,0)");
    g.addColorStop(0.65, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, size, size);
}

function gradientLayerCss(layer: GradientLayer): string {
  const stops = layer.stops
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  if (layer.kind === "linear") {
    return `linear-gradient(${layer.angle}deg, ${stops})`;
  }
  // ellipse with matching x/y radius = circle on a square canvas, which is what
  // the preview master is. Using percentages lets the same string work at any
  // scaled size.
  return `radial-gradient(${Math.round(layer.r * 100)}% ${Math.round(layer.r * 100)}% at ${Math.round(
    layer.cx * 100
  )}% ${Math.round(layer.cy * 100)}%, ${stops})`;
}

function paintGradientLayer(
  ctx: CanvasRenderingContext2D,
  layer: GradientLayer,
  size: number,
  globalAlpha: number
) {
  ctx.save();
  ctx.globalCompositeOperation = layer.blend as GlobalCompositeOperation;
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * globalAlpha));
  let grad: CanvasGradient;
  if (layer.kind === "linear") {
    // CSS angle: 0 = south→north, 90 = west→east. Canvas direction vector
    // matching that convention is (sin θ, -cos θ).
    const rad = (layer.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    // Length matching CSS gradient line for a square box:
    //   length = (|sin θ| + |cos θ|) × size
    const length = (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad))) * size;
    const half = length / 2;
    const cx = size / 2;
    const cy = size / 2;
    grad = ctx.createLinearGradient(
      cx - dx * half,
      cy - dy * half,
      cx + dx * half,
      cy + dy * half
    );
  } else {
    const cxPx = layer.cx * size;
    const cyPx = layer.cy * size;
    const rPx = layer.r * size;
    grad = ctx.createRadialGradient(cxPx, cyPx, 0, cxPx, cyPx, rPx);
  }
  layer.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
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
    flipped: false,
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
    flipped: pane.flipped,
    dirty: pane.dirty,
  };
}

function paneSlotForImage(imageIndex: number, imageCount: number, paneCount: number) {
  if (imageCount === 0) return { left: 0, width: paneCount * CANVAS_SIZE };
  const slotWidth = (paneCount * CANVAS_SIZE) / imageCount;
  return { left: imageIndex * slotWidth, width: slotWidth };
}

const InstagramDesigner = forwardRef<InstagramDesignerHandle, Props>(function InstagramDesigner(
  {
    eyebrowText,
    titleText,
    descriptionText,
    authorsText,
    paperLink,
  }: Props,
  ref
) {
  const [templateKey, setTemplateKey] = useState<TemplateKey>("editorial");
  const [displayFontOverride, setDisplayFontOverride] = useState<string | null>(null);
  const [bodyFontOverride, setBodyFontOverride] = useState<string | null>(null);
  const [images, setImages] = useState<BgImage[]>([]);
  const [paneCountOverride, setPaneCountOverride] = useState<number | null>(null);
  const [gradientStrength, setGradientStrength] = useState(1);
  const [tintStrength, setTintStrength] = useState(1);
  // Maximum backdrop-blur radius (in 1080-canvas px) applied behind the text
  // zone. The blur is masked with the same vertical gradient the dark overlay
  // uses, so where the gradient darkens the most, the underlying image
  // becomes the most blurred. 0 = sharp throughout.
  const [backdropBlurPx, setBackdropBlurPx] = useState(0);
  const [titleScale, setTitleScale] = useState(1);
  const [descriptionScale, setDescriptionScale] = useState(1);
  const [imageScale, setImageScale] = useState(1);
  const [gapEyebrowTitle, setGapEyebrowTitle] = useState(18);
  const [gapTitleDescription, setGapTitleDescription] = useState(36);
  const [gapDescriptionAuthors, setGapDescriptionAuthors] = useState(28);
  const [activePane, setActivePane] = useState(0);
  const [arxivLoading, setArxivLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [paneContrast, setPaneContrast] = useState<PaneContrast | null>(null);
  const [contrastMeasuring, setContrastMeasuring] = useState(false);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const [arxivInfo, setArxivInfo] = useState<string | null>(null);
  const [arxivEprintUrl, setArxivEprintUrl] = useState<string | null>(null);
  // Track which arXiv URL we've auto-fetched figures for, so we only auto-fetch
  // once per unique paper (the user can always re-fetch manually).
  const [autoFetchedUrl, setAutoFetchedUrl] = useState<string | null>(null);
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

  // arXiv detection from paperLink. When the paper changes, clear previously
  // auto-fetched figures so the carousel doesn't keep stale plots from another
  // paper. User uploads are preserved.
  useEffect(() => {
    let cancelled = false;
    setArxivEprintUrl(null);
    setImages((prev) => prev.filter((i) => i.source !== "arxiv"));
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

  async function handleAddPaperPdfTopHalf(prepend = false): Promise<BgImage | null> {
    if (!paperLink) return null;
    setPdfLoading(true);
    setArxivError(null);
    setArxivInfo(null);
    try {
      const pdf = await fetchArxivPdf(paperLink);
      const dataUrl = bytesFromBase64(pdf.dataBase64, pdf.mimeType);
      const cropped = await pdfFirstPageTopFractionPng(dataUrl, 0.5);
      const image: BgImage = {
        id: `arxiv-pdf-${Date.now()}`,
        src: cropped,
        name: `${pdf.filename.replace(/\.pdf$/i, "")}-top-half.png`,
        source: "arxiv",
      };
      setImages((prev) => (prepend ? [image, ...prev] : [...prev, image]));
      setArxivInfo("Added the top half of page 1 from the paper PDF.");
      return image;
    } catch (e) {
      setArxivError(`Could not fetch paper PDF: ${e}`);
      return null;
    } finally {
      setPdfLoading(false);
    }
  }

  // Auto-fetch figures + paper PDF top-half the first time an arXiv URL
  // resolves for this paper. The PDF is added first so it lands at index 0
  // of the carousel (its top half — title block, abstract, first figure —
  // makes a strong cover slide); figure plots follow.
  useEffect(() => {
    if (!arxivEprintUrl) return;
    if (autoFetchedUrl === arxivEprintUrl) return;
    setAutoFetchedUrl(arxivEprintUrl);
    void (async () => {
      // PDF first so it ends up at index 0 even after the figure fetch appends.
      await handleAddPaperPdfTopHalf(true);
      await handleFetchArxivFigures();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arxivEprintUrl]);

  // Debounced contrast measurement for the active pane. Re-runs when the
  // template, image set, gradient/tint sliders, or pane selection change.
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setContrastMeasuring(true);
      measurePaneContrast(activePane)
        .then((result) => {
          if (!cancelled) setPaneContrast(result);
        })
        .catch(() => {
          if (!cancelled) setPaneContrast(null);
        })
        .finally(() => {
          if (!cancelled) setContrastMeasuring(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePane, templateKey, images, gradientStrength, tintStrength, imageScale, paneCount]);

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

  /**
   * Renders just the background (base + images + tint + gradient) of a pane at
   * a small size and samples the text-reading zone to estimate effective
   * contrast vs each text color. Used to drive the live contrast readout in
   * the pane editor — never participates in the actual export.
   */
  async function measurePaneContrast(paneIndex: number): Promise<PaneContrast> {
    const SAMPLE_SIZE = 270;
    const scale = SAMPLE_SIZE / CANVAS_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    // Base
    ctx.fillStyle = template.baseColor;
    ctx.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    // Background images — render the full master at sample-scale, then crop
    // this pane's section, mirroring the export pipeline.
    if (images.length > 0) {
      const master = document.createElement("canvas");
      master.width = SAMPLE_SIZE * paneCount;
      master.height = SAMPLE_SIZE;
      const mctx = master.getContext("2d");
      if (mctx) {
        const loaded = await Promise.all(images.map((i) => loadImage(i.src).catch(() => null)));
        loaded.forEach((img, i) => {
          if (!img) return;
          const slot = paneSlotForImage(i, images.length, paneCount);
          drawCoverImage(mctx, img, slot.left * scale, 0, slot.width * scale, SAMPLE_SIZE);
          applyHorizontalCrossfade(mctx, slot.left * scale, slot.width * scale, i, images.length);
        });
        ctx.drawImage(
          master,
          paneIndex * SAMPLE_SIZE,
          0,
          SAMPLE_SIZE,
          SAMPLE_SIZE,
          0,
          0,
          SAMPLE_SIZE,
          SAMPLE_SIZE
        );
      }
    }

    // Tint
    ctx.save();
    ctx.globalAlpha = template.tintOpacity * tintStrength;
    ctx.globalCompositeOperation = template.tintBlend as GlobalCompositeOperation;
    ctx.fillStyle = template.tintColor;
    ctx.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.restore();

    // Gradient layers
    template.gradientLayers.forEach((layer) => {
      paintGradientLayer(ctx, layer, SAMPLE_SIZE, gradientStrength);
    });

    // Sample the actual rendered position of each text block. Falls back to a
    // pane-band sample if the text block hasn't been laid out yet.
    const layout = computeTextLayout(paneIndex);
    const sampleBox = (
      bx: number,
      by: number,
      bw: number,
      bh: number
    ): { rgb: [number, number, number]; lum: number } | null => {
      // Translate canvas coords → sample-scale coords. Clamp to the canvas so
      // partial overflow at the safe-area boundary doesn't error out.
      const sx = Math.max(0, Math.floor(bx * scale));
      const sy = Math.max(0, Math.floor(by * scale));
      const sw = Math.max(1, Math.min(SAMPLE_SIZE - sx, Math.ceil(bw * scale)));
      const sh = Math.max(1, Math.min(SAMPLE_SIZE - sy, Math.ceil(bh * scale)));
      if (sw < 1 || sh < 1) return null;
      let data: ImageData;
      try {
        data = ctx.getImageData(sx, sy, sw, sh);
      } catch {
        return null;
      }
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let n = 0;
      for (let i = 0; i < data.data.length; i += 4) {
        rSum += data.data[i];
        gSum += data.data[i + 1];
        bSum += data.data[i + 2];
        n += 1;
      }
      const r = rSum / n;
      const g = gSum / n;
      const b = bSum / n;
      return { rgb: [r, g, b], lum: relativeLuminance(r, g, b) };
    };

    const contrastFor = (
      textColor: string,
      bxCanvas: number,
      byCanvas: number,
      bwCanvas: number,
      bhCanvas: number
    ): { ratio: number; bgLum: number; bgRgb: [number, number, number] } => {
      const sample = sampleBox(bxCanvas, byCanvas, bwCanvas, bhCanvas);
      const bgLum = sample?.lum ?? 0;
      const bgRgb = sample?.rgb ?? ([0, 0, 0] as [number, number, number]);
      const rgb = parseColorToRgb(textColor);
      if (!rgb) return { ratio: 0, bgLum, bgRgb };
      const textLum = relativeLuminance(rgb[0], rgb[1], rgb[2]);
      return { ratio: wcagContrast(textLum, bgLum), bgLum, bgRgb };
    };

    // Default fallback rect when a role isn't present (use the vAlign band).
    const padPx = SAFE_PADDING;
    const fallback: { x: number; y: number; w: number; h: number } = (() => {
      if (template.vAlign === "top") {
        return { x: padPx, y: padPx, w: CANVAS_SIZE - 2 * padPx, h: CANVAS_SIZE * 0.4 };
      }
      if (template.vAlign === "middle") {
        return {
          x: padPx,
          y: CANVAS_SIZE * 0.3,
          w: CANVAS_SIZE - 2 * padPx,
          h: CANVAS_SIZE * 0.4,
        };
      }
      return {
        x: padPx,
        y: CANVAS_SIZE * 0.5,
        w: CANVAS_SIZE - 2 * padPx,
        h: CANVAS_SIZE * 0.4 - padPx,
      };
    })();

    const rectFor = (role: PaneTextRole): { x: number; y: number; w: number; h: number } => {
      const block = layout?.blocks.find((b) => b.role === role);
      if (block) {
        return { x: block.x, y: block.y, w: block.width, h: block.height };
      }
      return { ...fallback };
    };

    const colorByRole: Record<PaneTextRole, string> = {
      eyebrow: template.eyebrowColor,
      title: template.textColor,
      description: template.textColor,
      authors: template.authorsColor,
    };

    const measurements: Record<
      PaneTextRole,
      { ratio: number; bgLum: number; bgRgb: [number, number, number] }
    > = {
      eyebrow: (() => {
        const r = rectFor("eyebrow");
        return contrastFor(colorByRole.eyebrow, r.x, r.y, r.w, r.h);
      })(),
      title: (() => {
        const r = rectFor("title");
        return contrastFor(colorByRole.title, r.x, r.y, r.w, r.h);
      })(),
      description: (() => {
        const r = rectFor("description");
        return contrastFor(colorByRole.description, r.x, r.y, r.w, r.h);
      })(),
      authors: (() => {
        const r = rectFor("authors");
        return contrastFor(colorByRole.authors, r.x, r.y, r.w, r.h);
      })(),
    };

    // For the swatch + overall lum field, use the title's sample as the
    // representative backdrop — it's the most prominent text and the user
    // most likely thinks of "the area behind the headline".
    const titleSample = measurements.title;
    return {
      bgLuminance: titleSample.bgLum,
      bgRgb: titleSample.bgRgb,
      ratios: {
        title: measurements.title.ratio,
        eyebrow: measurements.eyebrow.ratio,
        description: measurements.description.ratio,
        authors: measurements.authors.ratio,
      },
    };
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

    // 4. Backdrop blur (image + tint) under the text zone. Done BEFORE the
    //    gradient layers so the gradient itself stays sharp. Snapshot the
    //    current canvas state, blur it via ctx.filter into a side canvas,
    //    mask with the blur-mask gradient, then composite back.
    if (backdropBlurPx > 0) {
      const snapshot = document.createElement("canvas");
      snapshot.width = CANVAS_SIZE;
      snapshot.height = CANVAS_SIZE;
      const sctx = snapshot.getContext("2d");
      if (sctx) {
        sctx.drawImage(canvas, 0, 0);
        const blurred = document.createElement("canvas");
        blurred.width = CANVAS_SIZE;
        blurred.height = CANVAS_SIZE;
        const bctx = blurred.getContext("2d");
        if (bctx) {
          bctx.filter = `blur(${backdropBlurPx}px)`;
          bctx.drawImage(snapshot, 0, 0);
          bctx.filter = "none";
          applyBlurMaskGradient(bctx, template.vAlign, CANVAS_SIZE);
          bctx.globalCompositeOperation = "source-over";
          // Paint the masked-blur back on top of the unblurred image+tint.
          ctx.drawImage(blurred, 0, 0);
        }
      }
    }

    // 5. Gradient overlay — multiple layered passes per template.
    template.gradientLayers.forEach((layer) => {
      paintGradientLayer(ctx, layer, CANVAS_SIZE, gradientStrength);
    });

    // 6. Text
    drawPaneText(ctx, paneIndex);

    // 7. Logo
    await drawLogo(ctx, panes[paneIndex]?.flipped ?? false);

    return canvas;
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
    // Cap the fade at slightly less than the slot so the centre of each image
    // always reads at full opacity, even on narrow slots.
    const fadeWidth = Math.min(CROSSFADE_PX, slotWidth * 0.45);
    if (imageIndex > 0) {
      // Trailing → leading edge of THIS image (its left inner edge): start
      // fully erased, ramp to opaque on the inner side. Smoothstep curve so
      // adjacent images mix as a feathered overlap rather than a hard ramp.
      const g = ctx.createLinearGradient(slotLeft, 0, slotLeft + fadeWidth, 0);
      CROSSFADE_STOPS_OPAQUE_TO_TRANSPARENT.forEach(({ t, a }) => {
        g.addColorStop(t, `rgba(0,0,0,${a})`);
      });
      ctx.fillStyle = g;
      ctx.fillRect(slotLeft, 0, fadeWidth, CANVAS_SIZE);
    }
    if (imageIndex < imageCount - 1) {
      const g = ctx.createLinearGradient(
        slotLeft + slotWidth - fadeWidth,
        0,
        slotLeft + slotWidth,
        0
      );
      // Reverse the smoothstep stops for the right inner edge.
      CROSSFADE_STOPS_OPAQUE_TO_TRANSPARENT.forEach(({ t, a }) => {
        g.addColorStop(1 - t, `rgba(0,0,0,${a})`);
      });
      ctx.fillStyle = g;
      ctx.fillRect(slotLeft + slotWidth - fadeWidth, 0, fadeWidth, CANVAS_SIZE);
    }
    ctx.restore();
  }

  type PaneTextRole = "eyebrow" | "title" | "description" | "authors";

  interface TextBlockLayout {
    role: PaneTextRole;
    color: string;
    // Bounding box in canvas coords (pre-flip-aware).
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /**
   * Compute the same layout `drawPaneText` will use, but without drawing.
   * Returned bboxes are inflated by a small margin so that a sample taken
   * inside the bbox represents what's actually behind the rendered glyphs.
   * Both `drawPaneText` and the contrast meter use this so the meter
   * reports the contrast for the *actual* visible text region rather than
   * a guessed band of the pane.
   */
  function computeTextLayout(paneIndex: number): {
    blocks: TextBlockLayout[];
    align: Align;
    xAnchor: number;
  } | null {
    const pane = panes[paneIndex];
    if (!pane) return null;
    const baseAlign = template.align;
    const align: Align = pane.flipped
      ? baseAlign === "left"
        ? "right"
        : baseAlign === "right"
        ? "left"
        : "center"
      : baseAlign;
    const xAnchor =
      align === "center"
        ? CANVAS_SIZE / 2
        : align === "right"
        ? CANVAS_SIZE - SAFE_PADDING
        : SAFE_PADDING;
    const maxTextWidth = CANVAS_SIZE - SAFE_PADDING * 2;

    // We need a 2D context to call measureText/wrapText, but it doesn't have
    // to be on a real canvas — an offscreen one is fine.
    const tmp = document.createElement("canvas");
    tmp.width = CANVAS_SIZE;
    tmp.height = CANVAS_SIZE;
    const ctx = tmp.getContext("2d");
    if (!ctx) return null;
    ctx.textAlign = align;
    ctx.textBaseline = "top";

    type Block = {
      role: PaneTextRole;
      text: string;
      style: TextBlock;
      color: string;
      font: string;
      scale: number;
    };
    const blocks: Block[] = [];
    if (pane.eyebrow.trim()) {
      blocks.push({
        role: "eyebrow",
        text: pane.eyebrow,
        style: template.typography.eyebrow,
        color: template.eyebrowColor,
        font: displayFont,
        scale: 1,
      });
    }
    if (pane.title.trim()) {
      blocks.push({
        role: "title",
        text: pane.title,
        style: template.typography.title,
        color: template.textColor,
        font: displayFont,
        scale: titleScale,
      });
    }
    if (pane.description.trim()) {
      blocks.push({
        role: "description",
        text: pane.description,
        style: template.typography.description,
        color: template.textColor,
        font: bodyFont,
        scale: descriptionScale,
      });
    }
    if (pane.authors.trim()) {
      blocks.push({
        role: "authors",
        text: pane.authors,
        style: template.typography.authors,
        color: template.authorsColor,
        font: bodyFont,
        scale: 1,
      });
    }

    const measured = blocks.map((b) => {
      const size = applyTextStyle(ctx, b.style, b.font, b.color, b.scale);
      const text = b.style.uppercase ? b.text.toUpperCase() : b.text;
      const lines = wrapText(ctx, text, maxTextWidth);
      const lineHeight = size * b.style.lineHeight;
      return { ...b, size, lines, lineHeight };
    });

    const gapBetween = (a: PaneTextRole, b: PaneTextRole): number => {
      if (a === "eyebrow" && b === "title") return gapEyebrowTitle;
      if (a === "title" && b === "description") return gapTitleDescription;
      if (a === "description" && b === "authors") return gapDescriptionAuthors;
      if (a === "title" && b === "authors") return gapDescriptionAuthors;
      return 18;
    };

    const totalHeight = measured.reduce((sum, m, i) => {
      const gap = i < measured.length - 1 ? gapBetween(m.role, measured[i + 1].role) : 0;
      return sum + m.lines.length * m.lineHeight + gap;
    }, 0);

    const reserveBottom = LOGO_HEIGHT_PX + LOGO_MARGIN_PX * 2;
    let y =
      template.vAlign === "top"
        ? SAFE_PADDING
        : template.vAlign === "middle"
        ? Math.max(SAFE_PADDING, (CANVAS_SIZE - totalHeight) / 2)
        : Math.max(SAFE_PADDING, CANVAS_SIZE - reserveBottom - totalHeight);

    const layouts: TextBlockLayout[] = [];
    measured.forEach((m, idx) => {
      const blockHeight = m.lines.length * m.lineHeight;
      // Width: take the actual measured longest line (better than full bandwidth
      // for non-full-width text, so the contrast sample lands on real glyphs).
      let widest = 0;
      m.lines.forEach((line) => {
        const w = ctx.measureText(line).width;
        if (w > widest) widest = w;
      });
      const blockWidth = Math.max(40, Math.min(maxTextWidth, widest));
      const bx =
        align === "center"
          ? xAnchor - blockWidth / 2
          : align === "right"
          ? xAnchor - blockWidth
          : xAnchor;
      layouts.push({
        role: m.role,
        color: m.color,
        x: bx,
        y,
        width: blockWidth,
        height: blockHeight,
      });
      const nextGap = idx < measured.length - 1 ? gapBetween(m.role, measured[idx + 1].role) : 0;
      y += blockHeight + nextGap;
    });
    return { blocks: layouts, align, xAnchor };
  }

  function drawPaneText(ctx: CanvasRenderingContext2D, paneIndex: number) {
    const pane = panes[paneIndex];
    if (!pane) return;
    const layout = computeTextLayout(paneIndex);
    if (!layout) return;
    ctx.textAlign = layout.align;
    ctx.textBaseline = "top";
    const maxTextWidth = CANVAS_SIZE - SAFE_PADDING * 2;

    const roleData: Record<PaneTextRole, { style: TextBlock; font: string; scale: number; text: string }> = {
      eyebrow: {
        style: template.typography.eyebrow,
        font: displayFont,
        scale: 1,
        text: pane.eyebrow,
      },
      title: {
        style: template.typography.title,
        font: displayFont,
        scale: titleScale,
        text: pane.title,
      },
      description: {
        style: template.typography.description,
        font: bodyFont,
        scale: descriptionScale,
        text: pane.description,
      },
      authors: {
        style: template.typography.authors,
        font: bodyFont,
        scale: 1,
        text: pane.authors,
      },
    };

    layout.blocks.forEach((block) => {
      const r = roleData[block.role];
      const style = r.style;
      applyTextStyle(ctx, style, r.font, block.color, r.scale);
      const text = style.uppercase ? r.text.toUpperCase() : r.text;
      const lines = wrapText(ctx, text, maxTextWidth);
      const size = Math.round(style.fontSize * r.scale);
      const lineHeight = size * style.lineHeight;
      // Subtle shadow for the eyebrow so it stays readable on busy
      // photographic backgrounds where its accent color can otherwise blend
      // into bright highlights. Only the eyebrow gets it — title is large
      // enough to read on its own, and the body fonts shouldn't carry a glow.
      const shadow = block.role === "eyebrow";
      if (shadow) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
      }
      lines.forEach((line, li) => {
        ctx.fillText(line, layout.xAnchor, block.y + li * lineHeight);
      });
      if (shadow) ctx.restore();
    });
  }

  async function drawLogo(ctx: CanvasRenderingContext2D, flipped: boolean) {
    try {
      const img = await loadImage(usmccLogo);
      const targetH = LOGO_HEIGHT_PX;
      const targetW = (img.width / img.height) * targetH;
      // Default: bottom-right. Flipped: bottom-left.
      const x = flipped
        ? LOGO_MARGIN_PX
        : CANVAS_SIZE - targetW - LOGO_MARGIN_PX;
      const y = CANVAS_SIZE - targetH - LOGO_MARGIN_PX;
      ctx.drawImage(img, x, y, targetW, targetH);
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

  // Always-fresh reference to renderPaneCanvas so the imperative handle picks
  // up the latest closure (state, images, etc.) without re-running on every
  // dependency change.
  const renderPaneRef = useRef<((paneIndex: number) => Promise<HTMLCanvasElement>) | null>(null);
  renderPaneRef.current = renderPaneCanvas;

  useImperativeHandle(
    ref,
    () => ({
      async renderFirstPanePng(): Promise<string> {
        const fn = renderPaneRef.current;
        if (!fn) throw new Error("Designer not ready");
        const canvas = await fn(0);
        return canvas.toDataURL("image/png");
      },
    }),
    []
  );

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
                <button
                  className="btn-secondary"
                  onClick={() => {
                    void handleAddPaperPdfTopHalf(false);
                  }}
                  disabled={pdfLoading}
                  title="Download the paper PDF from arXiv and add the top half of page 1 as a background."
                >
                  {pdfLoading ? "Downloading PDF…" : "Top half of paper PDF"}
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
            <div className="ig-slider-row">
              <span>Backdrop blur</span>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={backdropBlurPx}
                onChange={(e) => setBackdropBlurPx(Number(e.target.value))}
              />
              <strong>{backdropBlurPx}px</strong>
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
                  {panes[i]?.flipped ? " ↔" : ""}
                </button>
              ))}
            </div>
            <button
              className="ig-pane-flip-toggle"
              onClick={() =>
                setPanes((prev) => {
                  const next = [...prev];
                  const current = next[activePane];
                  if (current) next[activePane] = { ...current, flipped: !current.flipped };
                  return next;
                })
              }
              title="Mirror this pane's text alignment and move the logo to the opposite corner. Useful when the background's focal subject is on the side the template wants to put text on."
            >
              {panes[activePane]?.flipped ? "↔ Flip back to default side" : "↔ Flip this pane"}
            </button>

            {paneContrast && (
              <div className="ig-contrast" aria-live="polite">
                <div className="ig-contrast-header">
                  <span
                    className="ig-contrast-swatch"
                    style={{
                      backgroundColor: `rgb(${Math.round(paneContrast.bgRgb[0])}, ${Math.round(
                        paneContrast.bgRgb[1]
                      )}, ${Math.round(paneContrast.bgRgb[2])})`,
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    Avg backdrop luminance{" "}
                    <strong>{paneContrast.bgLuminance.toFixed(2)}</strong>
                    {contrastMeasuring ? " · measuring…" : ""}
                  </span>
                </div>
                {(
                  [
                    { key: "title", label: "Title", ratio: paneContrast.ratios.title, large: true },
                    {
                      key: "eyebrow",
                      label: "Eyebrow",
                      ratio: paneContrast.ratios.eyebrow,
                      large: false,
                    },
                    {
                      key: "description",
                      label: "Body",
                      ratio: paneContrast.ratios.description,
                      large: true,
                    },
                    {
                      key: "authors",
                      label: "Authors",
                      ratio: paneContrast.ratios.authors,
                      large: false,
                    },
                  ] as { key: string; label: string; ratio: number; large: boolean }[]
                ).map((row) => {
                  // WCAG AA threshold: 3:1 for large text (>= 24px / >= 18px bold),
                  // 4.5:1 for normal body text.
                  const required = row.large ? 3 : 4.5;
                  const passesAA = row.ratio >= required;
                  const passesAAA = row.ratio >= (row.large ? 4.5 : 7);
                  const status = passesAAA ? "aaa" : passesAA ? "aa" : "fail";
                  const label =
                    status === "aaa"
                      ? "AAA"
                      : status === "aa"
                      ? "AA"
                      : `Needs ≥${required}:1`;
                  return (
                    <div className={`ig-contrast-row ${status}`} key={row.key}>
                      <span className="ig-contrast-label">{row.label}</span>
                      <span className="ig-contrast-ratio">{row.ratio.toFixed(1)}:1</span>
                      <span className="ig-contrast-badge">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}

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
                    const fade = Math.min(CROSSFADE_PX, slot.width * 0.45);
                    const hasLeft = i > 0;
                    const hasRight = i < images.length - 1;
                    // Smoothstep-approximating mask. The mask ramps in / out
                    // over CROSSFADE_PX with the same curve we use in canvas
                    // export, so the preview and the PNG export look identical.
                    const leftRamp = hasLeft
                      ? CROSSFADE_STOPS_OPAQUE_TO_TRANSPARENT.map(
                          ({ t, a }) => `rgba(0,0,0,${a}) ${(1 - t) * fade}px`
                        ).join(", ") + ", "
                      : "rgba(0,0,0,1) 0px, ";
                    const rightRamp = hasRight
                      ? CROSSFADE_STOPS_OPAQUE_TO_TRANSPARENT.map(
                          ({ t, a }) => `rgba(0,0,0,${a}) calc(100% - ${(1 - t) * fade}px)`
                        ).join(", ")
                      : "rgba(0,0,0,1) 100%";
                    const mask = `linear-gradient(to right, ${leftRamp}${rightRamp})`;
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
                {/* Backdrop blur layer — sits above image+tint, below gradient.
                    Uses backdrop-filter so only the area under the mask is
                    blurred; mask geometry matches the template's text-zone. */}
                {backdropBlurPx > 0 && (
                  <div
                    className="ig-blur-layer"
                    style={{
                      backdropFilter: `blur(${backdropBlurPx}px)`,
                      WebkitBackdropFilter: `blur(${backdropBlurPx}px)`,
                      maskImage: blurMaskCss(template.vAlign),
                      WebkitMaskImage: blurMaskCss(template.vAlign),
                    }}
                  />
                )}
                {/* Gradient overlay — one div per layer, each with its own blend mode and opacity. */}
                {template.gradientLayers.map((layer, idx) => (
                  <div
                    key={`grad-${idx}`}
                    className="ig-gradient-layer"
                    style={{
                      backgroundImage: gradientLayerCss(layer),
                      opacity: layer.opacity * gradientStrength,
                      mixBlendMode: layer.blend as React.CSSProperties["mixBlendMode"],
                    }}
                  />
                ))}
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
});

export default InstagramDesigner;

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
  const baseAlign = template.align;
  const align: Align = pane.flipped
    ? baseAlign === "left"
      ? "right"
      : baseAlign === "right"
      ? "left"
      : "center"
    : baseAlign;
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
            style={{
              ...blockStyle(
                template.typography.eyebrow,
                template.eyebrowColor,
                displayFont,
                1,
                marginFor("eyebrow")
              ),
              // Subtle dark glow ensures the eyebrow remains legible against
              // bright or busy photographic backgrounds where the accent
              // color alone can wash out. Matches the canvas-export shadow.
              textShadow:
                "0 1px 2px rgba(0,0,0,0.55), 0 0 14px rgba(0,0,0,0.45)",
            }}
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
          ...(pane.flipped
            ? { left: LOGO_MARGIN_PX }
            : { right: LOGO_MARGIN_PX }),
          bottom: LOGO_MARGIN_PX,
          height: LOGO_HEIGHT_PX,
          width: "auto",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
