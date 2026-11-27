import { describe, expect, it } from 'vitest';
import { looksLikePdf, pdfText, tidyPdfText } from './pdf-text';

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
