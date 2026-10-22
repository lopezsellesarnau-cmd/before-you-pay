import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

export async function readDocument(path: string): Promise<string> {
  const file = await readFile(path);
  const isPdf =
    extname(path).toLowerCase() === '.pdf' ||
    file.subarray(0, 5).toString() === '%PDF-';
     //Detectamos  la extensión de estos archivos
  if (!isPdf) {
    return file.toString('utf8');
  }

  const pdf = await getDocumentProxy(new Uint8Array(file));
  const { text } = await extractText(pdf, { mergePages: true });
  const cleanText = text.replace(/\r\n?/g, '\n').trim();

  if (!cleanText) {
    throw new Error(
      `Could not extract text from ${path}. It may be a scanned PDF that needs OCR.`,
    );
  }

  return cleanText;

}