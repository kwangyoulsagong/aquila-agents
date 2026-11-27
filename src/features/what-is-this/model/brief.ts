import {
  api,
  type BriefFields,
  type BriefInput,
  type BriefPrepared,
  type BriefResult,
  type RelatedNote,
} from '@/shared/api';
import type { Translate } from '@/shared/i18n';

/** Files read as text in the renderer; main sanitizes them. PDFs: their text, read by main (macOS PDFKit). */
const TEXT_FILE = /\.(md|markdown|mdx|txt|text|eml|html?|csv|json|ya?ml)$/i;
const PDF_FILE = /\.pdf$/i;
/** A bigger file is refused before it is read (main caps what is sent at 20k characters anyway). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** PDFs carry fonts and images: more room (main refuses above this too). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type FileCheck = { ok: true; pdf: boolean } | { ok: false; reason: 'unsupported' | 'tooBig' };

export function checkFile(name: string, type: string, size: number): FileCheck {
  const pdf = PDF_FILE.test(name) || type === 'application/pdf';
  const text = !pdf && (TEXT_FILE.test(name) || type.startsWith('text/'));
  if (!pdf && !text) return { ok: false, reason: 'unsupported' };
  if (size > (pdf ? MAX_PDF_BYTES : MAX_FILE_BYTES)) return { ok: false, reason: 'tooBig' };
  return { ok: true, pdf };
}

/** A scanned PDF read with OCR: pages read, and the page count when some were left out. */
export interface BriefOcr {
  pages: number;
  totalPages?: number;
}

/** What was dropped / picked: an input to prepare (`ocr` when a scan was OCR'd), or why it can't be one. */
export type BriefSeed = (BriefInput & { ocr?: BriefOcr }) | { error: string };

export async function readFile(file: File, t: Translate): Promise<BriefSeed> {
  const check = checkFile(file.name, file.type, file.size);
  if (!check.ok)
    return {
      error: t(check.reason === 'tooBig' ? 'brief.tooBig' : 'brief.unsupported', { name: file.name }),
    };
  if (!check.pdf) return { name: file.name, text: await file.text() };
  const r = await api.briefPdfText(new Uint8Array(await file.arrayBuffer()));
  if (!('text' in r)) return { error: t(`brief.pdf.${r.error}`, { name: file.name }) };
  if (!r.ocr) return { name: file.name, text: r.text };
  const ocr: BriefOcr = { pages: r.pages ?? 0, ...(r.totalPages ? { totalPages: r.totalPages } : {}) };
  return { name: file.name, text: r.text, ocr };
}

/** A drop: the first file, else dropped text (a link dragged from a browser, a selection). */
export async function readDrop(dt: DataTransfer, t: Translate): Promise<BriefSeed | null> {
  const file = dt.files[0];
  if (file) return readFile(file, t);
  const text = dt.getData('text/plain') || dt.getData('text/uri-list');
  return text.trim() ? { text } : null;
}

/** "same ID REQ-030 · shared words: login, token" — every reason the note has. */
export function whyLabel(r: RelatedNote, t: Translate): string {
  const parts: string[] = [];
  if (r.ids.length) parts.push(t('brief.sameId', { ids: r.ids.slice(0, 3).join(', ') }));
  if (r.words.length) parts.push(t('brief.sharedWords', { words: r.words.join(', ') }));
  return parts.join(' · ');
}

/** IDs among the model's terms, for a second local lookup (the text's own IDs are found in main anyway). */
export function termIds(fields: BriefFields | null): string[] {
  return (fields?.terms ?? []).filter((x) => /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\d+$/.test(x.trim()));
}

/** The note's title: "<product> — <feature>", else the source's label, else the date. */
export function defaultTitle(fields: BriefFields | null, label: string, date: Date): string {
  const parts = [fields?.product, fields?.feature].map((x) => x?.trim()).filter(Boolean);
  const title = parts.length ? parts.join(' — ') : label.replace(/^https?:\/\//, '').trim();
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (title || `Brief ${d}`)
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** A result is shown only for the input it was made from (a reply for an older input is dropped). */
export function resultFor(result: BriefResult | null, prepared: BriefPrepared | null): BriefResult | null {
  return result && prepared && result.hash === prepared.hash ? result : null;
}

/** The input changed: stop the running brief (if any) and forget it, so its late reply is ignored. */
export function dropRun(runId: { current: string | null }, cancel: (id: string) => void): void {
  if (runId.current) cancel(runId.current);
  runId.current = null;
}

/** Every field empty: say "nothing found" instead of an empty card. */
export const isEmpty = (f: BriefFields) =>
  !f.product && !f.feature && !f.intent && !f.points.length && !f.questions.length && !f.terms.length;

export const formatCount = (n: number) => n.toLocaleString('en-US');
