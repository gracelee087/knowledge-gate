// Embeddings, same model string shape as llm.ts:
//   do/bge-m3              DigitalOcean serverless inference (cloud side: lectures only)
//   ollama/embeddinggemma  local Ollama (laptop side: personal notes never leave the laptop)
import { need } from './env.ts';

export async function embed(model: string, texts: string[]): Promise<number[][]> {
  const [provider, ...rest] = model.split('/');
  const id = rest.join('/');
  const out: number[][] = [];
  for (let s = 0; s < texts.length; s += 32) {
    const input = texts.slice(s, s + 32);
    if (provider === 'do') {
      const res = await fetch('https://inference.do-ai.run/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${need('DO_MODEL_ACCESS_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, input }),
        signal: AbortSignal.timeout(60_000),
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`DO embeddings ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);
      out.push(...j.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding));
    } else if (provider === 'ollama') {
      const res = await fetch('http://127.0.0.1:11434/api/embed', { method: 'POST', body: JSON.stringify({ model: id, input }) });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);
      out.push(...j.embeddings);
    } else throw new Error(`unknown provider ${provider}`);
  }
  return out;
}

export const cosine = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
};
