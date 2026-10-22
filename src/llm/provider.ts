// The model is injected: one function, provider chosen by config (LLM_PROVIDER).
//   sample    — no credentials, deterministic stand-ins (default, used in tests and offline demo)
//   anthropic — Claude via the Messages API (ANTHROPIC_API_KEY)
//   nvidia    — Nemotron on NVIDIA NIM, OpenAI-compatible (NVIDIA_API_KEY)

export interface GenerateRequest {
  /** Which task this is, so the sample provider can answer without a model. */
  task: 'extract' | 'explain';
  system: string;
  prompt: string;
}

export type Generate = (req: GenerateRequest) => Promise<string>;

export interface Provider {
  name: string;
  model: string;
  generate: Generate;
}

export async function provider(): Promise<Provider> {
  const name = process.env.LLM_PROVIDER ?? 'sample';
  if (name === 'anthropic') {
    const model = process.env.LLM_MODEL ?? 'claude-sonnet-5-5';
    return { name, model, generate: (r) => anthropic(model, r) };
  }
  if (name === 'nvidia') {
    const model = process.env.LLM_MODEL ?? 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
    return { name, model, generate: (r) => nvidia(model, r) };
  }
  const { sampleGenerate } = await import('./sample.ts');
  return { name: 'sample', model: 'none', generate: sampleGenerate };
}

async function anthropic(model: string, r: GenerateRequest) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 2000, system: r.system, messages: [{ role: 'user', content: r.prompt }] }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`anthropic: ${json?.error?.message ?? res.status}`);
  return json.content.map((c: any) => c.text ?? '').join('');
}

async function nvidia(model: string, r: GenerateRequest) {
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.NVIDIA_API_KEY ?? ''}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: `/no_think\n${r.system}` },
        { role: 'user', content: r.prompt },
      ],
    }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`nvidia: ${json?.detail ?? json?.error?.message ?? res.status}`);
  return json.choices[0].message.content as string;
}

/** Pull the first JSON object or array out of a model answer. */
export function parseJson<T>(text: string): T {
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('no JSON in model output');
  return JSON.parse(m[0]);
}
