// Serves the repo so the UI can read /examples and the saved reports.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = root.endsWith(sep) ? root : root + sep;
const port = Number(process.env.PORT) || 4173;
const checkOrigin = (process.env.CHECK_API_URL || 'https://before-you-pay.onrender.com').replace(/\/$/, '');
const checkKey = process.env.CHECK_API_KEY || '';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function wakeChecker() {
  const deadline = Date.now() + 45_000;
  let last = 'The checker did not wake up.';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${checkOrigin}/health`);
      if (res.ok) return;
      last = `Health returned ${res.status}.`;
    } catch (err) {
      last = err instanceof Error ? err.message : 'The checker did not wake up.';
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/api/check' && req.method === 'POST') {
    if (!checkKey) {
      sendJson(res, 503, { error: 'Add CHECK_API_KEY to .env and restart the page server.' });
      return;
    }
    try {
      const raw = await readBody(req);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'Request body must be valid JSON.' });
        return;
      }
      const listing = typeof data.listing === 'string' ? data.listing : '';
      const photos = Array.isArray(data.photos) ? data.photos.filter((url) => typeof url === 'string').slice(0, 5) : undefined;
      const payload = {
        listing,
        ...(typeof data.contract === 'string' && data.contract ? { contract: data.contract } : {}),
        ...(data.answers && typeof data.answers === 'object' ? { answers: data.answers } : {}),
        ...(photos?.length ? { photos } : {}),
      };
      await wakeChecker();
      const upstream = await fetch(`${checkOrigin}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': checkKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The check could not be sent.';
      sendJson(res, 502, { error: message });
    }
    return;
  }
  if (path === '/') {
    res.writeHead(302, { Location: '/ui/index.html' }).end();
    return;
  }
  const file = normalize(join(base, path.replace(/^\/+/, '')));
  if (!file.startsWith(base)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}/`);
});
