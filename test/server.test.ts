import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApiServer } from '../src/server.ts';
import type { Input } from '../src/agent.ts';
import type { TraceEntry } from '../src/log.ts';

async function withServer(
  action: (url: string) => Promise<void>,
  analyze: (input: Input, hooks?: { onTrace?: (entry: TraceEntry) => void }) => Promise<unknown> = async (input) => ({ input }),
  apiKey = 'test-api-key',
) {
  const server = createApiServer(analyze, {
    apiKey,
    corsOrigin: 'https://juna.example',
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await action(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('POST /check returns the result from run()', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({ listing: 'Fictional listing text' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      input: { listing: 'Fictional listing text' },
    });
  });
});

test('POST /check rejects a request without a listing', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /listing/i);
  });
});

test('POST /check extracts text from a PDF contract', async () => {
  const pdf = readFileSync(
    new URL('../examples/contract-excessive-guarantee.pdf', import.meta.url),
  );

  await withServer(
    async (url) => {
      const response = await fetch(`${url}/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({
          listing: 'Fictional listing text',
          contractPdfBase64: pdf.toString('base64'),
        }),
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.match(result.input.contract, /Garantía adicional: 4 meses/);
    },
  );
});

test('OPTIONS /check returns CORS preflight headers', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`, { method: 'OPTIONS' });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://juna.example');
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /X-API-Key/i);
  });
});

test('GET /health returns an unauthenticated health response', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('POST /check requires the configured API key', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listing: 'Fictional listing text' }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  });
});

test('POST /check returns 503 when no API key is configured', async () => {
  await withServer(
    async (url) => {
      const response = await fetch(`${url}/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({ listing: 'Fictional listing text' }),
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'API key is not configured.' });
    },
    undefined,
    '',
  );
});

test('GET /check returns method not allowed', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`);

    assert.equal(response.status, 405);
  });
});

test('POST /check streams each step when the client asks for a live trace', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({ listing: 'Fictional listing text' }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.type), ['trace', 'trace', 'report']);
    assert.equal(lines[0].entry.action, 'start');
    assert.equal(lines[1].entry.action, 'explanation of area: kept');
    assert.equal(lines[2].report.runId, 'stream-test');
  }, async (input, hooks) => {
    const start: TraceEntry = { t: '2026-01-01T00:00:00.000Z', step: 1, agent: 'planner', action: 'start' };
    const kept: TraceEntry = { t: '2026-01-01T00:00:01.000Z', step: 2, agent: 'critic', action: 'explanation of area: kept' };
    hooks?.onTrace?.(start);
    hooks?.onTrace?.(kept);
    return { input, runId: 'stream-test', trace: [] };
  });
});
