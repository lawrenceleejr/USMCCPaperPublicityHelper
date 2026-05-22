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

export async function pdfDataUrlToPngDataUrl(dataUrl: string, renderScale = 2): Promise<string> {
  configureWorker();
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Not a data URL");
  const base64 = dataUrl.slice(comma + 1);
  const bytes = base64ToBytes(base64);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await pdf.getPage(1);
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
