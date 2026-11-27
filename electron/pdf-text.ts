// "What is this?" (T81): a PDF's text, read locally with macOS's own PDFKit — no model, no new dependency. The
// bytes go to a private temp file, `osascript -l JavaScript` asks PDFKit for the document's text, the file goes.
// A scanned PDF has no text layer: then each page is rendered to an image and read with macOS Vision
// (VNRecognizeTextRequest, Korean + English, on this Mac — no network), capped in pages and time.
// A locked PDF can't be opened: that is said so.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BriefPdfText } from '../src/shared/api/types';

/** Bigger files are refused before anything is written. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** Text read at most (the brief sends 20k characters anyway). */
const MAX_OUTPUT = 8 * 1024 * 1024;
/** OCR reads at most this many pages… */
export const OCR_MAX_PAGES = 30;
/** …and stops starting new pages after this long (what it has read so far is kept)… */
export const OCR_BUDGET_MS = 45_000;
/** …and is killed after this long (the first page also loads Vision's models). */
export const OCR_TIMEOUT_MS = 60_000;

/** Runs a JXA script with arguments; resolves its stdout, rejects with its stderr as the message. */
export type PdfRunner = (script: string, args: string[], timeoutMs: number) => Promise<string>;

/** JXA: the PDF at argv[0] → its text on stdout; throws (non-zero exit) with `unreadable` / `locked`. */
export const TEXT_SCRIPT = `ObjC.import('PDFKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) throw new Error('unreadable');
  if (doc.isLocked) throw new Error('locked');
  const s = doc.string;
  return !s || s.isNil() ? '' : s.js;
}`;

/**
 * JXA: OCR of the PDF at argv[0], at most argv[1] pages, no new page after argv[2] ms. Each page is rendered at ~2x
 * (longest side ≤ 3000 px) and read by Vision (accurate, language correction, ko-KR + en-US); lines in Vision's order.
 * Prints one JSON object: `{"total": <page count>, "pages": ["<page 1 text>", …]}` (only the pages it read).
 */
export const OCR_SCRIPT = `ObjC.import('PDFKit'); ObjC.import('AppKit'); ObjC.import('Vision');
function run(argv) {
  const t0 = Date.now();
  const maxPages = Number(argv[1]), budget = Number(argv[2]);
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) throw new Error('unreadable');
  if (doc.isLocked) throw new Error('locked');
  const total = Number(doc.pageCount);
  const pages = [];
  for (let i = 0; i < total && i < maxPages; i++) {
    if (i > 0 && Date.now() - t0 > budget) break;
    const page = doc.pageAtIndex(i);
    const b = page.boundsForBox(0);
    const k = Math.min(2, 3000 / Math.max(b.size.width, b.size.height, 1));
    const img = page.thumbnailOfSizeForBox($.NSMakeSize(b.size.width * k, b.size.height * k), 0);
    const cg = img.CGImageForProposedRectContextHints($(), $(), $());
    const req = $.VNRecognizeTextRequest.alloc.init;
    req.recognitionLevel = 0;
    req.usesLanguageCorrection = true;
    req.recognitionLanguages = $(['ko-KR', 'en-US']);
    const handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cg, $.NSDictionary.dictionary);
    const lines = [];
    if (handler.performRequestsError($([req]), $())) {
      const rs = req.results;
      const n = !rs || rs.isNil() ? 0 : Number(rs.count);
      for (let j = 0; j < n; j++) {
        const c = rs.objectAtIndex(j).topCandidates(1);
        if (Number(c.count)) lines.push(c.objectAtIndex(0).string.js);
      }
    }
    pages.push(lines.join('\\n'));
  }
  return JSON.stringify({ total: total, pages: pages });
}`;

/** `%PDF-` within the first KB, as readers accept. */
export const looksLikePdf = (data: Uint8Array) =>
  Buffer.from(data.subarray(0, 1024)).toString('latin1').includes('%PDF-');

/** Text from PDFKit's output: line ends tidied, the trailing newline osascript adds dropped. */
export const tidyPdfText = (out: string) =>
  out
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export interface OcrOutput {
  /** Pages in the document. */
  total: number;
  /** Text of each page read, in order (at most `maxPages`). */
  pages: string[];
}

/** The OCR script's JSON line → pages (capped at `maxPages`); null when it isn't that shape. */
export function parseOcrOutput(out: string, maxPages = OCR_MAX_PAGES): OcrOutput | null {
  let v: unknown;
  try {
    v = JSON.parse(out.trim());
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { total, pages } = v as { total?: unknown; pages?: unknown };
  if (!Array.isArray(pages)) return null;
  const read = pages.slice(0, maxPages).map((p) => (typeof p === 'string' ? p : ''));
  const n = Number(total);
  return { total: Number.isFinite(n) && n >= read.length ? n : read.length, pages: read };
}

/** OCR'd pages → one text (pages apart by a blank line) and what was read; null when nothing was found. */
export function ocrResult(o: OcrOutput): BriefPdfText | null {
  const text = tidyPdfText(o.pages.map(tidyPdfText).join('\n\n'));
  if (!text) return null;
  return {
    text,
    ocr: true,
    pages: o.pages.length,
    ...(o.pages.length < o.total ? { totalPages: o.total } : {}),
  };
}

const osascript: PdfRunner = (script, args, timeoutMs) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, ...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
      (err, stdout, stderr) => (err ? reject(new Error(`${stderr}`)) : resolve(stdout)),
    ),
  );

const errorOf = (e: unknown): BriefPdfText => ({
  error: /locked/.test(e instanceof Error ? e.message : '') ? 'locked' : 'unreadable',
});

/**
 * The PDF's text: its text layer first; only when that is empty, OCR. `run` is injectable for tests (the default is
 * `osascript`, macOS only).
 */
export async function pdfText(data: Uint8Array, run?: PdfRunner): Promise<BriefPdfText> {
  if (!run && process.platform !== 'darwin') return { error: 'unsupported' };
  if (!(data instanceof Uint8Array) || data.byteLength > PDF_MAX_BYTES) return { error: 'unreadable' };
  if (!looksLikePdf(data)) return { error: 'unreadable' };
  const exec = run ?? osascript;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-pdf-'));
  const file = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(file, data, { mode: 0o600 });
    let out: string;
    try {
      out = await exec(TEXT_SCRIPT, [file], TIMEOUT_MS);
    } catch (e) {
      return errorOf(e);
    }
    const text = tidyPdfText(out);
    if (text) return { text };
    // No text layer (a scan): read the pages' images.
    let ocrOut: string;
    try {
      ocrOut = await exec(OCR_SCRIPT, [file, String(OCR_MAX_PAGES), String(OCR_BUDGET_MS)], OCR_TIMEOUT_MS);
    } catch (e) {
      return errorOf(e);
    }
    const parsed = parseOcrOutput(ocrOut);
    if (!parsed) return { error: 'unreadable' };
    return ocrResult(parsed) ?? { error: 'empty' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
