// "What is this?" (T81): a PDF's text, read locally with macOS's own PDFKit — no model, no new dependency. The
// bytes go to a private temp file, `osascript -l JavaScript` asks PDFKit for the document's text, the file goes.
// A scanned PDF has no text layer (nothing to read without OCR) and a locked one can't be opened: both are said so.
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

/** JXA: the PDF at argv[0] → its text on stdout; throws (non-zero exit) with `unreadable` / `locked`. */
const SCRIPT = `ObjC.import('PDFKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) throw new Error('unreadable');
  if (doc.isLocked) throw new Error('locked');
  const s = doc.string;
  return !s || s.isNil() ? '' : s.js;
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

export async function pdfText(data: Uint8Array): Promise<BriefPdfText> {
  if (process.platform !== 'darwin') return { error: 'unsupported' };
  if (!(data instanceof Uint8Array) || data.byteLength > PDF_MAX_BYTES) return { error: 'unreadable' };
  if (!looksLikePdf(data)) return { error: 'unreadable' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-pdf-'));
  const file = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(file, data, { mode: 0o600 });
    const out = await new Promise<string>((resolve, reject) =>
      execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', SCRIPT, file],
        { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
        (err, stdout, stderr) => (err ? reject(new Error(`${stderr}`)) : resolve(stdout)),
      ),
    );
    const text = tidyPdfText(out);
    return text ? { text } : { error: 'empty' };
  } catch (e) {
    return { error: /locked/.test(e instanceof Error ? e.message : '') ? 'locked' : 'unreadable' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
