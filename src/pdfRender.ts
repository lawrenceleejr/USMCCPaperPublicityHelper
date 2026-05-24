import * as pdfjsLib from "pdfjs-dist";
// Vite serves this as a static URL; pdf.js fetches the worker from there.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Target a longer-edge pixel count for the rasterised PDF page. The Instagram
// pane is 1080 px and the image will often be scaled / zoomed within it, so
// rendering at ~2160 px keeps everything crisp at 2× without going crazy on
// memory. Vector PDFs render at whatever resolution we ask, so this scale is
// what controls visible sharpness.
const TARGET_LONG_EDGE_PX = 2160;
const MAX_RENDER_SCALE = 6;

export async function pdfDataUrlToPngDataUrl(dataUrl: string): Promise<string> {
  configureWorker();
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Not a data URL");
  const base64 = dataUrl.slice(comma + 1);
  const bytes = base64ToBytes(base64);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await pdf.getPage(1);
    // The unscaled viewport reports the PDF's natural page size in CSS px (72-dpi).
    // Pick a render scale that takes the longer edge up to TARGET_LONG_EDGE_PX.
    const baseViewport = page.getViewport({ scale: 1 });
    const longEdge = Math.max(baseViewport.width, baseViewport.height);
    const renderScale = Math.min(
      MAX_RENDER_SCALE,
      Math.max(2, TARGET_LONG_EDGE_PX / Math.max(1, longEdge))
    );
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    await pdf.destroy();
  }
}

/**
 * Renders page 1 of the PDF, then crops to the top `fraction` of the page
 * (default 0.5 — top half). Useful for grabbing a paper's title block + first
 * figure as a single composed image.
 */
export async function pdfFirstPageTopFractionPng(
  dataUrl: string,
  fraction = 0.5
): Promise<string> {
  const fullPng = await pdfDataUrlToPngDataUrl(dataUrl);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not decode rasterised PDF page"));
    i.src = fullPng;
  });
  const w = img.width;
  const h = Math.max(1, Math.floor(img.height * Math.min(1, Math.max(0.05, fraction))));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}
