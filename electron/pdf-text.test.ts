import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  looksLikePdf,
  OCR_MAX_PAGES,
  OCR_SCRIPT,
  parseOcrOutput,
  pdfText,
  tidyPdfText,
  type PdfRunner,
} from './pdf-text';

/** A one-page PDF with `text` in Helvetica (offsets computed, so any reader accepts it). */
function tinyPdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const n of offsets) out += `${String(n).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

describe('pdfText', () => {
  it('recognizes a PDF and tidies the text', () => {
    expect(looksLikePdf(tinyPdf('x'))).toBe(true);
    expect(looksLikePdf(new Uint8Array(Buffer.from('hello')))).toBe(false);
    expect(tidyPdfText('a  \r\nb\n\n\n\nc\n')).toBe('a\nb\n\nc');
  });

  it('refuses what is not a PDF before running anything', async () => {
    expect(await pdfText(new Uint8Array(Buffer.from('not a pdf')))).toEqual({
      error: process.platform === 'darwin' ? 'unreadable' : 'unsupported',
    });
  });

  it.runIf(process.platform === 'darwin')(
    'reads the text with PDFKit; a page without text is empty',
    async () => {
      expect(await pdfText(tinyPdf('Login spec FE-REQ-030'))).toEqual({ text: 'Login spec FE-REQ-030' });
      expect(await pdfText(tinyPdf(''))).toEqual({ error: 'empty' });
    },
  );
});

/** A canned runner: `text` answers the text-layer script, `ocr` the OCR script; records which ran, with what. */
function canned(text: string | Error, ocr?: string | Error) {
  const calls: { ocr: boolean; args: string[]; timeoutMs: number }[] = [];
  const run: PdfRunner = (script, args, timeoutMs) => {
    const isOcr = script === OCR_SCRIPT;
    calls.push({ ocr: isOcr, args, timeoutMs });
    const r = isOcr ? ocr : text;
    if (r === undefined) return Promise.reject(new Error('not expected'));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { run, calls };
}

const ocrJson = (pages: string[], total = pages.length) => `${JSON.stringify({ total, pages })}\n`;

describe('pdfText OCR fallback', () => {
  const pdf = tinyPdf('x');

  it('parses the OCR output: pages in order, capped, bad shapes refused', () => {
    expect(parseOcrOutput(ocrJson(['a', 'b'], 5))).toEqual({ total: 5, pages: ['a', 'b'] });
    expect(parseOcrOutput(ocrJson(['a', 'b', 'c']), 2)).toEqual({ total: 3, pages: ['a', 'b'] });
    expect(parseOcrOutput('{"total":"2","pages":["a",3]}')).toEqual({ total: 2, pages: ['a', ''] });
    expect(parseOcrOutput('{"pages":["a"]}')).toEqual({ total: 1, pages: ['a'] });
    expect(parseOcrOutput('not json')).toBeNull();
    expect(parseOcrOutput('{"total":1}')).toBeNull();
    expect(parseOcrOutput('null')).toBeNull();
  });

  it('uses the text layer first and never OCRs when it has text', async () => {
    const c = canned('Spec FE-REQ-030\n', ocrJson(['nope']));
    expect(await pdfText(pdf, c.run)).toEqual({ text: 'Spec FE-REQ-030' });
    expect(c.calls.map((x) => x.ocr)).toEqual([false]);
  });

  it('OCRs a PDF without a text layer: pages joined by a blank line, with page caps and time', async () => {
    const c = canned('  \n', ocrJson(['HELLO  \n안녕', '', 'page 3']));
    expect(await pdfText(pdf, c.run)).toEqual({ text: 'HELLO\n안녕\n\npage 3', ocr: true, pages: 3 });
    expect(c.calls.map((x) => x.ocr)).toEqual([false, true]);
    const [, ocr] = c.calls;
    expect(ocr?.args.slice(1)).toEqual([String(OCR_MAX_PAGES), '45000']);
    expect(ocr?.timeoutMs).toBe(60_000);
  });

  it('says when pages were left out (page cap or time)', async () => {
    const many = Array.from({ length: OCR_MAX_PAGES + 5 }, (_, i) => `p${i + 1}`);
    const r = await pdfText(pdf, canned('', ocrJson(many, 120)).run);
    expect(r).toMatchObject({ ocr: true, pages: OCR_MAX_PAGES, totalPages: 120 });
    expect('text' in r && r.text.endsWith(`p${OCR_MAX_PAGES}`)).toBe(true);
  });

  it('maps errors: empty only when OCR finds nothing too', async () => {
    expect(await pdfText(pdf, canned('', ocrJson(['', ' \n '])).run)).toEqual({ error: 'empty' });
    expect(await pdfText(pdf, canned('', 'garbage').run)).toEqual({ error: 'unreadable' });
    expect(await pdfText(pdf, canned('', new Error('Vision failed')).run)).toEqual({ error: 'unreadable' });
    expect(await pdfText(pdf, canned(new Error('Error: locked')).run)).toEqual({ error: 'locked' });
    expect(await pdfText(pdf, canned(new Error('Error: unreadable')).run)).toEqual({ error: 'unreadable' });
    expect(await pdfText(pdf, canned('', new Error('Error: locked')).run)).toEqual({ error: 'locked' });
  });

  it.skipIf(process.platform !== 'darwin')(
    'reads an image-only PDF with macOS Vision',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-ocr-test-'));
      try {
        const file = path.join(dir, 'scan.pdf');
        // An image of "HELLO 안녕" (no text layer) on one PDF page, made with AppKit + PDFKit.
        const make = `ObjC.import('AppKit'); ObjC.import('PDFKit');
function run(argv) {
  const img = $.NSImage.alloc.initWithSize($.NSMakeSize(600, 200));
  img.lockFocus;
  $.NSColor.whiteColor.setFill;
  $.NSRectFill($.NSMakeRect(0, 0, 600, 200));
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.systemFontOfSize(64), $.NSFontAttributeName);
  $(argv[1]).drawAtPointWithAttributes($.NSMakePoint(30, 60), attrs);
  img.unlockFocus;
  const doc = $.PDFDocument.alloc.init;
  doc.insertPageAtIndex($.PDFPage.alloc.initWithImage(img), 0);
  return doc.writeToFile(argv[0]);
}`;
        execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', make, file, 'HELLO 안녕']);
        const r = await pdfText(new Uint8Array(fs.readFileSync(file)));
        expect(r).toMatchObject({ ocr: true, pages: 1 });
        expect('text' in r ? r.text : '').toMatch(/HELLO/);
        expect('text' in r ? r.text : '').toMatch(/안녕/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
