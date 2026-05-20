import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

interface Props {
  titleText: string;
  subtitleText: string;
  footerText: string;
}

type BlockKey = "title" | "subtitle" | "footer";
type TemplateKey = "minimal" | "academic" | "bold";

type BlockTypography = {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
};

type DesignSettings = {
  template: TemplateKey;
  fontFamily: string;
  backgroundColor: string;
  textColor: string;
  subtitleColor: string;
  footerColor: string;
  showGuidelines: boolean;
  accessibilityMode: boolean;
  blocks: Record<BlockKey, BlockTypography>;
};

type StyleProfile = {
  name: string;
  settings: DesignSettings;
};

type Variant = {
  id: string;
  name: string;
  settings: DesignSettings;
};

const CANVAS_SIZE = 1080;
const SAFE_PADDING = 72;
const BLOCK_PADDING = 24;
const PREVIEW_SCALE = 0.5;
const FONT_LOAD_TIMEOUT_MS = 3500;
const MAX_UNDO_HISTORY = 40;
const MAX_RECENT_FONTS = 8;
const JPEG_EXPORT_QUALITY = 0.92;

const BLOCK_LAYOUT: Record<BlockKey, { y: number; h: number }> = {
  title: { y: 120, h: 270 },
  subtitle: { y: 430, h: 320 },
  footer: { y: 800, h: 170 },
};

const FONT_LIST = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Source Sans 3",
  "Nunito",
  "Playfair Display",
  "Merriweather",
  "PT Serif",
  "Libre Baskerville",
  "Work Sans",
  "IBM Plex Sans",
  "DM Sans",
  "Bebas Neue",
  "Oswald",
  "Raleway",
  "Rubik",
  "Noto Sans",
  "Noto Serif",
  "Fira Sans",
  "Karla",
  "Manrope",
  "Archivo",
  "Space Grotesk",
  "JetBrains Mono",
  "Lora",
  "Prompt",
  "Cabin",
  "Barlow",
  "Heebo",
  "Arimo",
  "Hind",
  "Inconsolata",
];

const STORAGE_KEYS = {
  settings: "igDesigner.settings.v1",
  profiles: "igDesigner.profiles.v1",
  variants: "igDesigner.variants.v1",
  activeVariant: "igDesigner.activeVariant.v1",
  recentFonts: "igDesigner.recentFonts.v1",
};

const TEMPLATE_PRESETS: Record<
  TemplateKey,
  Pick<DesignSettings, "backgroundColor" | "textColor" | "subtitleColor" | "footerColor"> & {
    blocks: Record<BlockKey, Partial<BlockTypography>>;
  }
> = {
  minimal: {
    backgroundColor: "#ffffff",
    textColor: "#111111",
    subtitleColor: "#333333",
    footerColor: "#666666",
    blocks: {
      title: { fontSize: 68, lineHeight: 1.15, letterSpacing: 0.2 },
      subtitle: { fontSize: 40, lineHeight: 1.28, letterSpacing: 0 },
      footer: { fontSize: 28, lineHeight: 1.2, letterSpacing: 0.2 },
    },
  },
  academic: {
    backgroundColor: "#f8f6ef",
    textColor: "#1b263b",
    subtitleColor: "#2b3c56",
    footerColor: "#415a77",
    blocks: {
      title: { fontSize: 66, lineHeight: 1.16, letterSpacing: 0 },
      subtitle: { fontSize: 38, lineHeight: 1.3, letterSpacing: 0 },
      footer: { fontSize: 26, lineHeight: 1.24, letterSpacing: 0 },
    },
  },
  bold: {
    backgroundColor: "#111827",
    textColor: "#f9fafb",
    subtitleColor: "#d1d5db",
    footerColor: "#9ca3af",
    blocks: {
      title: { fontSize: 74, lineHeight: 1.1, letterSpacing: 0.4 },
      subtitle: { fontSize: 42, lineHeight: 1.24, letterSpacing: 0.2 },
      footer: { fontSize: 30, lineHeight: 1.2, letterSpacing: 0.3 },
    },
  },
};

const DEFAULT_SETTINGS: DesignSettings = {
  template: "minimal",
  fontFamily: "Inter",
  backgroundColor: TEMPLATE_PRESETS.minimal.backgroundColor,
  textColor: TEMPLATE_PRESETS.minimal.textColor,
  subtitleColor: TEMPLATE_PRESETS.minimal.subtitleColor,
  footerColor: TEMPLATE_PRESETS.minimal.footerColor,
  showGuidelines: false,
  accessibilityMode: false,
  blocks: {
    title: { fontSize: 68, lineHeight: 1.15, letterSpacing: 0.2 },
    subtitle: { fontSize: 40, lineHeight: 1.28, letterSpacing: 0 },
    footer: { fontSize: 28, lineHeight: 1.2, letterSpacing: 0.2 },
  },
};

const BLOCK_LIMITS: Record<BlockKey, { min: number; max: number; accessibilityMin: number }> = {
  title: { min: 30, max: 120, accessibilityMin: 40 },
  subtitle: { min: 22, max: 84, accessibilityMin: 30 },
  footer: { min: 18, max: 56, accessibilityMin: 24 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deepCloneSettings(settings: DesignSettings): DesignSettings {
  return JSON.parse(JSON.stringify(settings)) as DesignSettings;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

function normalizeAndValidate(settings: DesignSettings): DesignSettings {
  const normalized = deepCloneSettings(settings);
  const minLineHeight = normalized.accessibilityMode ? 1.2 : 1;

  (Object.keys(normalized.blocks) as BlockKey[]).forEach((key) => {
    const limits = BLOCK_LIMITS[key];
    const min = normalized.accessibilityMode ? limits.accessibilityMin : limits.min;
    normalized.blocks[key].fontSize = clamp(normalized.blocks[key].fontSize, min, limits.max);
    normalized.blocks[key].lineHeight = clamp(normalized.blocks[key].lineHeight, minLineHeight, 2);
    normalized.blocks[key].letterSpacing = clamp(normalized.blocks[key].letterSpacing, -1, 6);
  });

  return normalized;
}

function getTemplateDefaults(template: TemplateKey, base: DesignSettings): DesignSettings {
  const preset = TEMPLATE_PRESETS[template];
  return normalizeAndValidate({
    ...base,
    template,
    backgroundColor: preset.backgroundColor,
    textColor: preset.textColor,
    subtitleColor: preset.subtitleColor,
    footerColor: preset.footerColor,
    blocks: {
      title: { ...base.blocks.title, ...preset.blocks.title },
      subtitle: { ...base.blocks.subtitle, ...preset.blocks.subtitle },
      footer: { ...base.blocks.footer, ...preset.blocks.footer },
    },
  });
}

function colorToRgb(color: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function luminance(rgb: [number, number, number]): number {
  const normalized = rgb.map((c) => {
    const value = c / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * normalized[0] + 0.7152 * normalized[1] + 0.0722 * normalized[2];
}

function contrastRatio(fg: string, bg: string): number | null {
  const fgRgb = colorToRgb(fg);
  const bgRgb = colorToRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  const lighter = Math.max(luminance(fgRgb), luminance(bgRgb));
  const darker = Math.min(luminance(fgRgb), luminance(bgRgb));
  return (lighter + 0.05) / (darker + 0.05);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length >= maxLines) break;
    }
  }

  if (lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

async function loadGoogleFont(fontFamily: string): Promise<void> {
  const familyParam = fontFamily.trim().split(/\s+/).join("+");
  const id = `google-font-${familyParam.toLowerCase()}`;
  const existing = document.getElementById(id) as HTMLLinkElement | null;

  if (!existing) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;500;700&display=swap`;
    document.head.appendChild(link);
  }

  await Promise.race([
    document.fonts.load(`16px "${fontFamily}"`),
    new Promise<void>((_, reject) => {
      window.setTimeout(() => reject(new Error("Font load timeout")), FONT_LOAD_TIMEOUT_MS);
    }),
  ]);
}

function makeVariantName(count: number): string {
  return `Variant ${count}`;
}

export default function InstagramDesigner({ titleText, subtitleText, footerText }: Props) {
  const [settings, setSettings] = useState<DesignSettings>(() => {
    const persisted = safeJsonParse<DesignSettings | null>(
      window.localStorage.getItem(STORAGE_KEYS.settings),
      null
    );
    return normalizeAndValidate(persisted ?? DEFAULT_SETTINGS);
  });
  const [undoStack, setUndoStack] = useState<DesignSettings[]>([]);
  const [redoStack, setRedoStack] = useState<DesignSettings[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const [fontLoading, setFontLoading] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const [visibleFontCount, setVisibleFontCount] = useState(12);
  const [recentFonts, setRecentFonts] = useState<string[]>(() =>
    safeJsonParse<string[]>(window.localStorage.getItem(STORAGE_KEYS.recentFonts), ["Inter"])
  );
  const [profiles, setProfiles] = useState<StyleProfile[]>(() =>
    safeJsonParse<StyleProfile[]>(window.localStorage.getItem(STORAGE_KEYS.profiles), [])
  );
  const [profileName, setProfileName] = useState("My Style");
  const [selectedProfileName, setSelectedProfileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialVariants = useMemo<Variant[]>(() => {
    const persisted = safeJsonParse<Variant[]>(window.localStorage.getItem(STORAGE_KEYS.variants), []);
    if (persisted.length > 0) return persisted.map((v) => ({ ...v, settings: normalizeAndValidate(v.settings) }));
    return [{ id: "variant-1", name: "Variant 1", settings: normalizeAndValidate(DEFAULT_SETTINGS) }];
  }, []);

  const [variants, setVariants] = useState<Variant[]>(initialVariants);
  const [activeVariantId, setActiveVariantId] = useState<string>(
    () => window.localStorage.getItem(STORAGE_KEYS.activeVariant) ?? initialVariants[0].id
  );

  const titleRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const [effectiveFontSizes, setEffectiveFontSizes] = useState<Record<BlockKey, number>>({
    title: settings.blocks.title.fontSize,
    subtitle: settings.blocks.subtitle.fontSize,
    footer: settings.blocks.footer.fontSize,
  });
  const [overflowMap, setOverflowMap] = useState<Record<BlockKey, boolean>>({
    title: false,
    subtitle: false,
    footer: false,
  });

  const activeVariant = variants.find((v) => v.id === activeVariantId) ?? variants[0];

  useEffect(() => {
    if (!activeVariant) return;
    setSettings(normalizeAndValidate(activeVariant.settings));
  }, [activeVariantId]);

  useEffect(() => {
    setVariants((prev) =>
      prev.map((v) => (v.id === activeVariantId ? { ...v, settings: normalizeAndValidate(settings) } : v))
    );
  }, [settings, activeVariantId]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.recentFonts, JSON.stringify(recentFonts));
  }, [recentFonts]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.variants, JSON.stringify(variants));
  }, [variants]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.activeVariant, activeVariantId);
  }, [activeVariantId]);

  const debouncedSettings = useDebouncedValue(settings, 120);
  const debouncedTitleText = useDebouncedValue(titleText, 120);
  const debouncedSubtitleText = useDebouncedValue(subtitleText, 120);
  const debouncedFooterText = useDebouncedValue(footerText, 120);

  useEffect(() => {
    const entries: Array<[BlockKey, HTMLDivElement | null]> = [
      ["title", titleRef.current],
      ["subtitle", subtitleRef.current],
      ["footer", footerRef.current],
    ];

    const nextEffective: Record<BlockKey, number> = {
      title: debouncedSettings.blocks.title.fontSize,
      subtitle: debouncedSettings.blocks.subtitle.fontSize,
      footer: debouncedSettings.blocks.footer.fontSize,
    };

    const nextOverflow: Record<BlockKey, boolean> = {
      title: false,
      subtitle: false,
      footer: false,
    };

    entries.forEach(([key, el]) => {
      if (!el) return;
      const widthScale = el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
      const heightScale = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
      const scale = Math.min(1, widthScale, heightScale);

      if (scale < 1) {
        const limit = BLOCK_LIMITS[key];
        const min = debouncedSettings.accessibilityMode ? limit.accessibilityMin : limit.min;
        nextEffective[key] = clamp(debouncedSettings.blocks[key].fontSize * scale, min, limit.max);
      }

      nextOverflow[key] = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    });

    setEffectiveFontSizes(nextEffective);
    setOverflowMap(nextOverflow);
  }, [
    debouncedSettings,
    debouncedTitleText,
    debouncedSubtitleText,
    debouncedFooterText,
  ]);

  const filteredFonts = useMemo(() => {
    const query = fontSearch.trim().toLowerCase();
    const source = query
      ? FONT_LIST.filter((f) => f.toLowerCase().includes(query))
      : [...new Set([...recentFonts, ...FONT_LIST])];
    return source.slice(0, visibleFontCount);
  }, [fontSearch, visibleFontCount, recentFonts]);

  const mainContrast = contrastRatio(settings.textColor, settings.backgroundColor);

  function pushHistory(prev: DesignSettings): void {
    setUndoStack((stack) => [...stack.slice(-(MAX_UNDO_HISTORY - 1)), deepCloneSettings(prev)]);
    setRedoStack([]);
  }

  function applySettings(update: (prev: DesignSettings) => DesignSettings, trackHistory = true): void {
    setSettings((prev) => {
      const nextRaw = update(prev);
      const next = normalizeAndValidate(nextRaw);
      if (trackHistory && JSON.stringify(prev) !== JSON.stringify(next)) {
        pushHistory(prev);
      }
      return next;
    });
  }

  function updateBlock(block: BlockKey, field: keyof BlockTypography, value: number): void {
    applySettings((prev) => ({
      ...prev,
      blocks: {
        ...prev.blocks,
        [block]: {
          ...prev.blocks[block],
          [field]: value,
        },
      },
    }));
  }

  async function handleFontSelect(fontFamily: string): Promise<void> {
    setFontLoading(true);
    setFontError(null);
    try {
      await loadGoogleFont(fontFamily);
      applySettings((prev) => ({ ...prev, fontFamily }));
      setRecentFonts((prev) => [fontFamily, ...prev.filter((f) => f !== fontFamily)].slice(0, MAX_RECENT_FONTS));
    } catch (error) {
      setFontError(`Could not load ${fontFamily}; using fallback.`);
      applySettings((prev) => ({ ...prev, fontFamily: "Inter" }));
      console.warn(error);
    } finally {
      setFontLoading(false);
    }
  }

  function applyTemplate(template: TemplateKey): void {
    applySettings((prev) => getTemplateDefaults(template, prev));
  }

  function handleUndo(): void {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [...redo, deepCloneSettings(settings)]);
      setSettings(previous);
      return stack.slice(0, -1);
    });
  }

  function handleRedo(): void {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((undo) => [...undo, deepCloneSettings(settings)]);
      setSettings(next);
      return stack.slice(0, -1);
    });
  }

  function handleReset(): void {
    applySettings(() => getTemplateDefaults(settings.template, DEFAULT_SETTINGS));
  }

  function handleDuplicateVariant(): void {
    const id = `variant-${Date.now()}`;
    const clone: Variant = {
      id,
      name: makeVariantName(variants.length + 1),
      settings: deepCloneSettings(settings),
    };
    setVariants((prev) => [...prev, clone]);
    setActiveVariantId(id);
  }

  function handleSaveProfile(): void {
    const name = profileName.trim();
    if (!name) return;
    setProfiles((prev) => {
      const existing = prev.find((p) => p.name === name);
      if (existing) {
        return prev.map((p) => (p.name === name ? { ...p, settings: deepCloneSettings(settings) } : p));
      }
      return [...prev, { name, settings: deepCloneSettings(settings) }];
    });
    setSelectedProfileName(name);
  }

  function handleLoadProfile(name: string): void {
    setSelectedProfileName(name);
    const profile = profiles.find((p) => p.name === name);
    if (!profile) return;
    applySettings(() => deepCloneSettings(profile.settings));
  }

  function handleExportProfiles(): void {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "instagram-style-profiles.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportProfiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as StyleProfile[];
      const sanitized = parsed
        .filter((profile) => typeof profile?.name === "string" && !!profile.name.trim() && profile.settings)
        .map((profile) => ({
          name: profile.name.trim(),
          settings: normalizeAndValidate(profile.settings),
        }));

      if (sanitized.length === 0) return;

      setProfiles((prev) => {
        const merged = [...prev];
        sanitized.forEach((incoming) => {
          const index = merged.findIndex((p) => p.name === incoming.name);
          if (index >= 0) merged[index] = incoming;
          else merged.push(incoming);
        });
        return merged;
      });
    } catch {
      setFontError("Could not import style profiles JSON.");
    } finally {
      event.target.value = "";
    }
  }

  function drawExportCanvas(type: "png" | "jpeg"): void {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const blocks: Array<{ key: BlockKey; text: string; color: string }> = [
      { key: "title", text: titleText, color: settings.textColor },
      { key: "subtitle", text: subtitleText, color: settings.subtitleColor },
      { key: "footer", text: footerText, color: settings.footerColor },
    ];

    blocks.forEach(({ key, text, color }) => {
      const layout = BLOCK_LAYOUT[key];
      const typo = settings.blocks[key];
      const size = effectiveFontSizes[key];
      const left = SAFE_PADDING + BLOCK_PADDING;
      const top = layout.y + BLOCK_PADDING;
      const width = CANVAS_SIZE - SAFE_PADDING * 2 - BLOCK_PADDING * 2;
      const height = layout.h - BLOCK_PADDING * 2;
      const lineHeightPx = size * typo.lineHeight;
      const maxLines = Math.max(1, Math.floor(height / lineHeightPx));

      context.fillStyle = color;
      context.textBaseline = "top";
      context.font = `${Math.round(size)}px "${settings.fontFamily}", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif`;

      const lines = wrapText(context, text.replace(/\s+/g, " ").trim(), width, maxLines);
      lines.forEach((line, index) => {
        context.fillText(line, left, top + index * lineHeightPx, width);
      });
    });

    const mime = type === "png" ? "image/png" : "image/jpeg";
    const quality = type === "jpeg" ? JPEG_EXPORT_QUALITY : undefined;
    const data = canvas.toDataURL(mime, quality);
    const a = document.createElement("a");
    a.href = data;
    a.download = `instagram-design.${type}`;
    a.click();
  }

  const limitMessage = settings.accessibilityMode
    ? "Accessibility mode enforces larger minimum font sizes and line height."
    : "Standard limits applied.";

  const overflowCount = Object.values(overflowMap).filter(Boolean).length;

  return (
    <section className="ig-designer">
      <div className="ig-designer-header">
        <div>
          <h2>Instagram Design Preview</h2>
          <p>Fixed 1080×1080 layout. Placement is locked; only typography and style are editable.</p>
        </div>
        <span className="ig-lock-badge">Placement Fixed</span>
      </div>

      <div className="ig-layout">
        <div className="ig-controls">
          <div className="ig-control-group">
            <label>Variant</label>
            <div className="ig-inline-row">
              <select value={activeVariantId} onChange={(e) => setActiveVariantId(e.target.value)}>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary" onClick={handleDuplicateVariant}>
                Duplicate
              </button>
            </div>
          </div>

          <div className="ig-control-group">
            <label>Template Presets</label>
            <div className="ig-chip-row">
              {(["minimal", "academic", "bold"] as TemplateKey[]).map((template) => (
                <button
                  key={template}
                  className={`ig-chip ${settings.template === template ? "active" : ""}`}
                  onClick={() => applyTemplate(template)}
                >
                  {template[0].toUpperCase() + template.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="ig-control-group">
            <label>Google Font Picker</label>
            <input
              type="text"
              value={fontSearch}
              onChange={(e) => {
                setFontSearch(e.target.value);
                setVisibleFontCount(12);
              }}
              placeholder="Search Google Fonts…"
            />
            <div className="ig-font-list" role="listbox" aria-label="Google Fonts">
              {filteredFonts.map((font) => (
                <button
                  key={font}
                  className={`ig-font-option ${settings.fontFamily === font ? "active" : ""}`}
                  onClick={() => {
                    void handleFontSelect(font);
                  }}
                  style={{ fontFamily: `"${font}", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif` }}
                >
                  {font}
                </button>
              ))}
            </div>
            {filteredFonts.length >= visibleFontCount && (
              <button className="btn-secondary" onClick={() => setVisibleFontCount((count) => count + 10)}>
                Load More Fonts
              </button>
            )}
            <div className="ig-inline-status">
              {fontLoading && <span>Loading font…</span>}
              {!fontLoading && fontError && <span className="ig-warn">{fontError}</span>}
              <span>Current: {settings.fontFamily}</span>
            </div>
          </div>

          <div className="ig-control-group">
            <label>Colors</label>
            <div className="ig-color-grid">
              <label>
                Background
                <input
                  type="color"
                  value={settings.backgroundColor}
                  onChange={(e) => applySettings((prev) => ({ ...prev, backgroundColor: e.target.value }))}
                />
              </label>
              <label>
                Title
                <input
                  type="color"
                  value={settings.textColor}
                  onChange={(e) => applySettings((prev) => ({ ...prev, textColor: e.target.value }))}
                />
              </label>
              <label>
                Subtitle
                <input
                  type="color"
                  value={settings.subtitleColor}
                  onChange={(e) => applySettings((prev) => ({ ...prev, subtitleColor: e.target.value }))}
                />
              </label>
              <label>
                Footer
                <input
                  type="color"
                  value={settings.footerColor}
                  onChange={(e) => applySettings((prev) => ({ ...prev, footerColor: e.target.value }))}
                />
              </label>
            </div>
            <div className="ig-inline-status">
              {mainContrast !== null && (
                <span className={mainContrast >= 4.5 ? "ig-ok" : "ig-warn"}>
                  Contrast: {mainContrast.toFixed(2)} ({mainContrast >= 4.5 ? "WCAG AA pass" : "Below AA"})
                </span>
              )}
            </div>
          </div>

          {(["title", "subtitle", "footer"] as BlockKey[]).map((block) => {
            const limits = BLOCK_LIMITS[block];
            const minSize = settings.accessibilityMode ? limits.accessibilityMin : limits.min;
            return (
              <div className="ig-control-group" key={block}>
                <label>{block[0].toUpperCase() + block.slice(1)} Typography</label>
                <div className="ig-slider-row">
                  <span>Font Size</span>
                  <input
                    type="range"
                    min={minSize}
                    max={limits.max}
                    value={settings.blocks[block].fontSize}
                    onChange={(e) => updateBlock(block, "fontSize", Number(e.target.value))}
                  />
                  <strong>{Math.round(settings.blocks[block].fontSize)}px</strong>
                </div>
                <div className="ig-slider-row">
                  <span>Line Height</span>
                  <input
                    type="range"
                    min={settings.accessibilityMode ? 1.2 : 1}
                    max={2}
                    step={0.01}
                    value={settings.blocks[block].lineHeight}
                    onChange={(e) => updateBlock(block, "lineHeight", Number(e.target.value))}
                  />
                  <strong>{settings.blocks[block].lineHeight.toFixed(2)}</strong>
                </div>
                <div className="ig-slider-row">
                  <span>Letter Spacing</span>
                  <input
                    type="range"
                    min={-1}
                    max={6}
                    step={0.1}
                    value={settings.blocks[block].letterSpacing}
                    onChange={(e) => updateBlock(block, "letterSpacing", Number(e.target.value))}
                  />
                  <strong>{settings.blocks[block].letterSpacing.toFixed(1)}px</strong>
                </div>
              </div>
            );
          })}

          <div className="ig-control-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.showGuidelines}
                onChange={(e) => applySettings((prev) => ({ ...prev, showGuidelines: e.target.checked }))}
              />
              Show Guidelines
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.accessibilityMode}
                onChange={(e) => applySettings((prev) => ({ ...prev, accessibilityMode: e.target.checked }))}
              />
              Accessibility Mode
            </label>
            <small>{limitMessage}</small>
          </div>

          <div className="ig-control-group">
            <label>Workflow</label>
            <div className="ig-inline-row">
              <button className="btn-secondary" disabled={undoStack.length === 0} onClick={handleUndo}>
                Undo
              </button>
              <button className="btn-secondary" disabled={redoStack.length === 0} onClick={handleRedo}>
                Redo
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Reset
              </button>
            </div>
            <div className="ig-inline-row">
              <button className="btn-secondary" onClick={() => drawExportCanvas("png")}>Export PNG</button>
              <button className="btn-secondary" onClick={() => drawExportCanvas("jpeg")}>Export JPEG</button>
            </div>
            <small>Guides are preview-only and never included in exported files.</small>
          </div>

          <div className="ig-control-group">
            <label>Style Profiles</label>
            <div className="ig-inline-row">
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Profile name"
              />
              <button className="btn-secondary" onClick={handleSaveProfile}>Save</button>
            </div>
            <div className="ig-inline-row">
              <select
                value={selectedProfileName}
                onChange={(e) => handleLoadProfile(e.target.value)}
              >
                <option value="">Load profile…</option>
                {profiles.map((profile) => (
                  <option key={profile.name} value={profile.name}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary" onClick={handleExportProfiles} disabled={profiles.length === 0}>
                Export JSON
              </button>
              <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                Import JSON
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                void handleImportProfiles(e);
              }}
            />
          </div>
        </div>

        <div className="ig-preview-wrap">
          <div className="ig-preview-scale">
            <div className="ig-canvas-frame">
              <div
                className={`ig-canvas ${settings.showGuidelines ? "ig-guidelines-on" : ""}`}
                style={{
                  backgroundColor: settings.backgroundColor,
                  fontFamily: `"${settings.fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
                  transform: `scale(${PREVIEW_SCALE})`,
                }}
              >
                <div className="ig-safe-area" />

                <div
                  className={`ig-text-block ${overflowMap.title ? "overflow" : ""}`}
                  style={{
                    left: SAFE_PADDING,
                    top: BLOCK_LAYOUT.title.y,
                    width: CANVAS_SIZE - SAFE_PADDING * 2,
                    height: BLOCK_LAYOUT.title.h,
                    padding: BLOCK_PADDING,
                    color: settings.textColor,
                  }}
                >
                  <div
                    ref={titleRef}
                    className="ig-text-content"
                    style={{
                      fontSize: `${effectiveFontSizes.title}px`,
                      lineHeight: settings.blocks.title.lineHeight,
                      letterSpacing: `${settings.blocks.title.letterSpacing}px`,
                    }}
                  >
                    {titleText}
                  </div>
                </div>

                <div
                  className={`ig-text-block ${overflowMap.subtitle ? "overflow" : ""}`}
                  style={{
                    left: SAFE_PADDING,
                    top: BLOCK_LAYOUT.subtitle.y,
                    width: CANVAS_SIZE - SAFE_PADDING * 2,
                    height: BLOCK_LAYOUT.subtitle.h,
                    padding: BLOCK_PADDING,
                    color: settings.subtitleColor,
                  }}
                >
                  <div
                    ref={subtitleRef}
                    className="ig-text-content"
                    style={{
                      fontSize: `${effectiveFontSizes.subtitle}px`,
                      lineHeight: settings.blocks.subtitle.lineHeight,
                      letterSpacing: `${settings.blocks.subtitle.letterSpacing}px`,
                    }}
                  >
                    {subtitleText}
                  </div>
                </div>

                <div
                  className={`ig-text-block ${overflowMap.footer ? "overflow" : ""}`}
                  style={{
                    left: SAFE_PADDING,
                    top: BLOCK_LAYOUT.footer.y,
                    width: CANVAS_SIZE - SAFE_PADDING * 2,
                    height: BLOCK_LAYOUT.footer.h,
                    padding: BLOCK_PADDING,
                    color: settings.footerColor,
                  }}
                >
                  <div
                    ref={footerRef}
                    className="ig-text-content"
                    style={{
                      fontSize: `${effectiveFontSizes.footer}px`,
                      lineHeight: settings.blocks.footer.lineHeight,
                      letterSpacing: `${settings.blocks.footer.letterSpacing}px`,
                    }}
                  >
                    {footerText}
                  </div>
                </div>

                {settings.showGuidelines && (
                  <>
                    <div className="ig-guide-grid" />
                    <div className="ig-guide-block" style={{ top: BLOCK_LAYOUT.title.y, height: BLOCK_LAYOUT.title.h }} />
                    <div className="ig-guide-block" style={{ top: BLOCK_LAYOUT.subtitle.y, height: BLOCK_LAYOUT.subtitle.h }} />
                    <div className="ig-guide-block" style={{ top: BLOCK_LAYOUT.footer.y, height: BLOCK_LAYOUT.footer.h }} />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="ig-preview-meta">
            <span>Canvas: 1080×1080</span>
            <span>Safe padding: {SAFE_PADDING}px</span>
            <span>Block padding: {BLOCK_PADDING}px</span>
            {overflowCount > 0 && <span className="ig-warn">Overflow warning in {overflowCount} block(s)</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
