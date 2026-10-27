import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, type Input } from './agent.ts';
import type { TraceEntry } from './log.ts';
import { readDocument } from './sources/document.ts';

const MAX_BODY_BYTES = 12 * 1024 * 1024;

type Analyze = (input: Input, hooks?: { onTrace?: (entry: TraceEntry) => void }) => Promise<unknown>;
type ApiServerOptions = {
  apiKey?: string;
  corsOrigin?: string;
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body is too large.');
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function wantsStream(req: IncomingMessage) {
  return (req.headers.accept ?? '').includes('application/x-ndjson');
}

function writeEvent(res: ServerResponse, data: unknown) {
  res.write(`${JSON.stringify(data)}\n`);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

export function createApiServer(
  analyze: Analyze = run,
  options: ApiServerOptions = {},
) {
  const apiKey = options.apiKey ?? process.env.API_KEY;
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';

  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', corsOrigin);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, X-API-Key');
    res.setHeader('vary', 'Origin');

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname !== '/check') {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Use POST /check.' });
      return;
    }

    if (!apiKey) {
      sendJson(res, 503, { error: 'API key is not configured.' });
      return;
    }

    if (req.headers['x-api-key'] !== apiKey) {
      sendJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    try {
      const body = await readJson(req);

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object.');
      }

      const data = body as Record<string, unknown>;

      if (typeof data.listing !== 'string' || !data.listing.trim()) {
        throw new HttpError(400, 'A non-empty listing string is required.');
      }

      if (data.contract !== undefined && typeof data.contract !== 'string') {
        throw new HttpError(400, 'contract must be a string.');
      }

      if (
        data.contractPdfBase64 !== undefined &&
        typeof data.contractPdfBase64 !== 'string'
      ) {
        throw new HttpError(400, 'contractPdfBase64 must be a string.');
      }

      if (data.contract !== undefined && data.contractPdfBase64 !== undefined) {
        throw new HttpError(400, 'Send contract text or a PDF, not both.');
      }

      if (data.answers !== undefined && !isStringRecord(data.answers)) {
        throw new HttpError(400, 'answers must be an object of string values.');
      }

      if (
        data.photos !== undefined &&
        !(
          Array.isArray(data.photos) &&
          data.photos.length <= 5 &&
          data.photos.every((url) => typeof url === 'string' && /^https?:\/\//.test(url))
        )
      ) {
        throw new HttpError(400, 'photos must be an array of up to 5 http(s) URLs.');
      }

      let contract = data.contract as string | undefined;

      if (typeof data.contractPdfBase64 === 'string') {
        const encoded = data.contractPdfBase64;
        const validBase64 =
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

        if (!encoded || !validBase64.test(encoded)) {
          throw new HttpError(400, 'contractPdfBase64 is not valid base64.');
        }

        const pdfBytes = Buffer.from(encoded, 'base64');

        if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') {
          throw new HttpError(400, 'The uploaded contract is not a PDF.');
        }

        const tempDir = await mkdtemp(join(tmpdir(), 'before-you-pay-'));
        const pdfPath = join(tempDir, 'contract.pdf');

        try {
          await writeFile(pdfPath, pdfBytes);
          contract = await readDocument(pdfPath);
        } catch {
          throw new HttpError(400, 'Could not extract text from the contract PDF.');
        } finally {
          await rm(tempDir, { recursive: true, force: true });
        }
      }

      const input: Input = {
        listing: data.listing,
        ...(contract === undefined ? {} : { contract }),
        ...(data.answers === undefined
          ? {}
          : { answers: data.answers as Record<string, string> }),
        ...(data.photos === undefined ? {} : { photos: data.photos as string[] }),
      };

      let streaming = false;
      try {
        if (wantsStream(req)) {
          res.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
          });
          streaming = true;
          const report = await analyze(input, {
            onTrace(entry) {
              writeEvent(res, { type: 'trace', entry });
            },
          });
          writeEvent(res, { type: 'report', report });
          res.end();
          return;
        }
        sendJson(res, 200, await analyze(input));
      } catch (error) {
        const message = error instanceof HttpError ? error.message : 'The check could not be completed.';
        if (streaming) {
          writeEvent(res, { type: 'error', error: message });
          res.end();
          return;
        }
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
          return;
        }
        console.error('POST /check failed:', error);
        sendJson(res, 500, { error: 'The check could not be completed.' });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }

      console.error('POST /check failed:', error);
      sendJson(res, 500, { error: 'The check could not be completed.' });
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT ?? 3000);
  createApiServer().listen(port, '0.0.0.0', () => {
    console.log(`API listening on port ${port}`);
  });
}
