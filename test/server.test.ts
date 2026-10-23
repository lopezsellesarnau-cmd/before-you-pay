import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApiServer } from '../src/server.ts';
import type { Input } from '../src/agent.ts';

async function withServer(
  action: (url: string) => Promise<void>,
  analyze: (input: Input) => Promise<unknown> = async (input) => ({ input }),
) {
  const server = createApiServer(analyze);

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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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