import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function certificarPDFA(input: Buffer): Promise<Buffer> {
  const inFile = path.join(tmpdir(), `in_${Date.now()}.pdf`);
  const outFile = path.join(tmpdir(), `out_${Date.now()}.pdf`);
  await writeFile(inFile, input);
  await new Promise<void>((res, rej) =>
    execFile('gs', [
      '-dPDFA=2', '-dBATCH', '-dNOPAUSE', '-sColorConversionStrategy=RGB',
      '-sDEVICE=pdfwrite', '-dPDFACompatibilityPolicy=1',
      `-sOutputFile=${outFile}`, inFile,
    ], (e) => (e ? rej(e) : res())));
  const out = await readFile(outFile);
  await unlink(inFile).catch(() => {}); await unlink(outFile).catch(() => {});
  return out;
}
