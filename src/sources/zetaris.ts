import { randomUUID } from 'node:crypto';

// Zetaris Lightning REST API (local platform or the shared event instance).
// Same path verify.sh uses: login → idToken + orgId → /api/proxy/query/sql/start.

const URL_ = process.env.ZETARIS_URL ?? 'http://localhost:3001';
let session: { token: string; orgId: number; at: number } | undefined;

export function zetarisConfigured() {
  return Boolean(process.env.ZETARIS_USER && process.env.ZETARIS_PASSWORD);
}

async function login() {
  // Tokens last 15 minutes; renew a bit before.
  if (session && Date.now() - session.at < 12 * 60_000) return session;
  const res = await fetch(`${URL_}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ZETARIS_USER, password: process.env.ZETARIS_PASSWORD }),
    signal: AbortSignal.timeout(10_000),
  });
  const json: any = await res.json();
  if (!json.idToken) throw new Error('zetaris login failed');
  session = { token: json.idToken, orgId: json.orgId, at: Date.now() };
  return session;
}

/** Any statement (DDL included), through the SQL editor route the official scripts use. */
export async function sql(statement: string, limit = 100): Promise<any> {
  const s = await login();
  const res = await fetch(`${URL_}/api/proxy/sql-editor/sqls/run-query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.token}`,
      'X-Org-ID': String(s.orgId),
      'X-Request-ID': randomUUID(),
    },
    body: JSON.stringify({ sql: statement, limit }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`zetaris: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
