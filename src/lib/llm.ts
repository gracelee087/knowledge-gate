// One call shape for every model we compare. MODEL strings look like:
//   do/gemma-4-31B-it        DigitalOcean serverless inference (OpenAI-compatible)
//   gemini/gemma-4-26b-a4b-it Gemini API (free Gemma 4)
//   ollama/gemma4:12b         local Ollama
// Only timings and token counts go to Sentry, never prompts or outputs.
import * as http from 'node:http';
import * as Sentry from '@sentry/node';
import { need } from './env.ts';

export interface LlmResult { text: string; inputTokens: number; outputTokens: number; ms: number }

export async function chat(model: string, system: string, user: string, jsonSchema?: object): Promise<LlmResult> {
  const [provider, ...rest] = model.split('/');
  const id = rest.join('/');
  return Sentry.startSpan(
    { op: 'gen_ai.chat', name: `chat ${model}`, attributes: { 'gen_ai.system': provider, 'gen_ai.request.model': id } },
    async span => {
      const t0 = Date.now();
      const r = provider === 'do' ? await doChat(id, system, user, jsonSchema)
        : provider === 'gemini' ? await geminiChat(id, system, user, jsonSchema)
        : provider === 'ollama' ? await ollamaChat(id, system, user, jsonSchema)
        : (() => { throw new Error(`unknown provider ${provider}`); })();
      const res = { ...r, ms: Date.now() - t0 };
      span.setAttributes({ 'gen_ai.usage.input_tokens': res.inputTokens, 'gen_ai.usage.output_tokens': res.outputTokens });
      return res;
    },
  );
}

async function doChat(id: string, system: string, user: string, jsonSchema?: object) {
  const res = await fetch('https://inference.do-ai.run/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('DO_MODEL_ACCESS_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: id,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      ...(jsonSchema && { response_format: { type: 'json_schema', json_schema: { name: 'out', schema: jsonSchema } } }),
    }),
    // A normal card takes under 40 s; some requests hang with no reply until fetch gives up at 5 minutes.
    signal: AbortSignal.timeout(120_000),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`DO ${res.status}: ${JSON.stringify(j).slice(0, 1500)}`);
  return { text: j.choices[0].message.content, inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
}

async function geminiChat(id: string, system: string, user: string, jsonSchema?: object) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': need('GEMINI_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, ...(jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: jsonSchema }) },
    }),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(j).slice(0, 1500)}`);
  // Gemma on the Gemini API returns its thinking as extra parts; keep only the answer parts.
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => !p.thought).map((p: any) => p.text).join('');
  return { text, inputTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0 };
}

async function ollamaChat(id: string, system: string, user: string, jsonSchema?: object) {
  // node:http, not fetch: on a CPU, bigger models spend more than 5 minutes reading a long
  // transcript before the first byte, and fetch gives up waiting for headers after 5 minutes
  // even when streaming. node:http has no such timeout.
  const body = JSON.stringify({
    model: id,
    stream: true,
    think: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(jsonSchema && { format: jsonSchema }),
    // Ollama's default context is small; a 37-minute transcript needs ~10k tokens.
    options: { temperature: 0.2, num_ctx: 24576 },
  });
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, resolve);
    req.on('error', reject);
    req.end(body);
  });
  if (res.statusCode !== 200) {
    let err = '';
    for await (const chunk of res) err += chunk;
    throw new Error(`Ollama ${res.statusCode}: ${err.slice(0, 1500)}`);
  }
  let text = '', buf = '', last: any = {};
  for await (const chunk of res as AsyncIterable<Buffer>) {
    buf += Buffer.from(chunk).toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      text += j.message?.content ?? '';
      if (j.done) last = j;
    }
  }
  return { text, inputTokens: last.prompt_eval_count ?? 0, outputTokens: last.eval_count ?? 0 };
}

// For agents: retry network failures and timeouts (a DigitalOcean request sometimes hangs).
// Trials call `chat` directly so their error counts stay honest.
export async function chatRetry(model: string, system: string, user: string, jsonSchema?: object, tries = 5): Promise<LlmResult> {
  for (let i = 1; ; i++) {
    try { return await chat(model, system, user, jsonSchema); }
    catch (e) {
      if (i >= tries) throw e;
      console.log(`  call failed (${(e as Error).message.slice(0, 60)}), retry ${i} in ${10 * i} s`);
      await new Promise(r => setTimeout(r, 10_000 * i));
    }
  }
}
