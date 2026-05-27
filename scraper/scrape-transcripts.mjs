#!/usr/bin/env node
// Scrape Panopto transcripts linked from an Indico event page.
//
// The recordings on the USMCC meeting page are Panopto videos. Panopto exposes
// each video's captions as an SRT file via GenerateSRT.ashx, which is what the
// "Download transcript" button in the viewer uses. This script finds every
// Panopto link on the page and downloads its transcript as both .srt and a
// cleaned .txt.
//
// Usage:
//   node scraper/scrape-transcripts.mjs [eventUrl] [outDir] [--txt-only]
//   node scraper/scrape-transcripts.mjs --url=<eventUrl> --out=<dir> --txt-only
//   npm run scrape:transcripts            # uses defaults below
//
// Flags:
//   --txt-only   write only cleaned .txt files (skip .srt and index.json)
//
// Requires Node 18+ (built-in fetch). No external dependencies.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_EVENT_URL =
  "https://indico.uchicago.edu/event/479/page/59-recordingslivestream";
const DEFAULT_OUT_DIR = "transcripts";

// Split argv into flags (--foo / --foo=bar) and positionals so both styles work.
const flags = new Map();
const positional = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--")) {
    const [key, value] = arg.slice(2).split("=");
    flags.set(key, value ?? true);
  } else {
    positional.push(arg);
  }
}

const eventUrl = flags.get("url") || positional[0] || DEFAULT_EVENT_URL;
const outDir = flags.get("out") || positional[1] || DEFAULT_OUT_DIR;
const txtOnly = flags.has("txt-only");

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");

const slugify = (s) =>
  decodeEntities(s)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "transcript";

// Parse <a ...panopto...Viewer.aspx?id=GUID...>Title</a> from the page HTML.
function extractTalks(html) {
  const re =
    /<a[^>]*href="([^"]*panopto[^"]*Viewer\.aspx\?id=([0-9a-fA-F-]+)[^"]*)"[^>]*>(.*?)<\/a>/gis;
  const talks = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, url, id, rawTitle] = m;
    if (seen.has(id)) continue; // de-dupe repeated links to same video
    seen.add(id);
    const title = decodeEntities(rawTitle.replace(/<[^>]+>/g, "")).trim();
    talks.push({ id, url, title });
  }
  return talks;
}

// Turn SRT into readable prose: drop indices, timestamps, and the boilerplate
// "[Auto-generated transcript...]" note, then join consecutive lines.
function srtToText(srt) {
  return srt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      // Drop the numeric index line and the timestamp line if present.
      if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
      if (/-->/.test(lines[0] ?? "")) lines.shift();
      return lines.join(" ").trim();
    })
    .filter(Boolean)
    .join("\n")
    .replace(/\[Auto-generated transcript\.[^\]]*\]\s*/g, "")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "usmcc-transcript-scraper/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function srtUrlFor(viewerUrl, id) {
  const origin = new URL(viewerUrl).origin;
  // language=0 = first available caption track (the auto-generated English one).
  return `${origin}/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${id}&language=0`;
}

async function main() {
  console.log(`Fetching event page: ${eventUrl}`);
  const html = await fetchText(eventUrl);
  const talks = extractTalks(html);

  if (talks.length === 0) {
    console.error("No Panopto recording links found on the page.");
    process.exit(1);
  }
  console.log(`Found ${talks.length} recording(s).`);

  await mkdir(outDir, { recursive: true });

  const index = [];
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < talks.length; i++) {
    const talk = talks[i];
    const num = String(i + 1).padStart(2, "0");
    const base = `${num}-${slugify(talk.title)}`;
    const srtPath = join(outDir, `${base}.srt`);
    const txtPath = join(outDir, `${base}.txt`);

    process.stdout.write(`[${num}/${talks.length}] ${talk.title} ... `);
    try {
      const srt = await fetchText(srtUrlFor(talk.url, talk.id));
      if (!srt.trim()) {
        console.log("no transcript available (empty)");
        index.push({ ...talk, status: "empty" });
        failed++;
        continue;
      }
      if (!txtOnly) await writeFile(srtPath, srt, "utf8");
      await writeFile(txtPath, `# ${talk.title}\n\n${srtToText(srt)}\n`, "utf8");
      console.log(`saved (${srt.length} bytes)`);
      index.push({ ...talk, status: "ok", srt: srtPath, txt: txtPath });
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      index.push({ ...talk, status: "error", error: err.message });
      failed++;
    }
  }

  if (!txtOnly) {
    await writeFile(
      join(outDir, "index.json"),
      JSON.stringify({ eventUrl, scrapedAt: new Date().toISOString(), talks: index }, null, 2),
      "utf8"
    );
  }

  console.log(`\nDone. ${ok} saved, ${failed} failed/empty. Output in ./${outDir}/`);
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
