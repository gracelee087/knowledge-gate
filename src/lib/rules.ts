// Verified rules: lessons that passed the verifier (src/agent/verify.ts). Adopted rules live in Backboard
// memory (assistant "lecture-gate-rules"), one memory per rule, so every agent run, on any machine, reads
// the same rules. data/rules.json keeps every candidate with its evidence, adopted or not, and is the
// fallback when Backboard can't be reached.
import '../lib/env.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BackboardClient } from 'backboard-sdk';

export type Rule = {
  id: string; agent: string; rule: string;
  status: 'adopted' | 'rejected' | 'needs-code';
  from: string[];          // timestamps of the lessons it came from
  evidence: object;        // what the verifier measured
  at: string; memoryId?: string;
};
const FILE = new URL('../../data/rules.json', import.meta.url);
const ASSISTANT = 'lecture-gate-rules';

export const loadRules = (): Rule[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
export const saveRules = (rules: Rule[]) => writeFileSync(FILE, JSON.stringify(rules, null, 1));

let client: BackboardClient | null = null, assistantId = '';
async function store() {
  if (!assistantId) {
    client = new BackboardClient({ apiKey: process.env.BACKBOARD_API_KEY! });
    let [a] = await client.listAssistants({ name: ASSISTANT, limit: 1 });
    a ??= await client.createAssistant({ name: ASSISTANT, description: 'Verified rules for the lecture-gate agents', system_prompt: 'Stores verified agent rules.' });
    assistantId = a.assistantId;
  }
  return { client: client!, assistantId };
}

// Save an adopted rule to Backboard memory; returns the memory id.
export async function publishRule(r: Rule): Promise<string> {
  const { client, assistantId } = await store();
  // Re-testing a rule must not store it twice.
  const same = (await allMemories()).find(m => m.metadata?.agent === r.agent && m.content.trim() === r.rule.trim());
  if (same) return same.id;
  const res: any = await client.addMemory(assistantId, { content: r.rule, metadata: { agent: r.agent, ruleId: r.id, status: 'adopted' } });
  return res.memory_id;
}

// Every memory in the rules store.
export async function allMemories(): Promise<any[]> {
  const { client, assistantId } = await store();
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const res: any = await client.getMemories(assistantId, { page, pageSize: 100 });
    out.push(...(res.memories ?? []));
    if (page >= (res.totalPages ?? 1)) return out;
  }
}

// Adopted rules for one agent: from Backboard, or from data/rules.json if Backboard fails.
export async function adoptedRules(agent: string): Promise<string[]> {
  try {
    const ms = await allMemories();
    return [...new Set(ms.filter(m => m.metadata?.agent === agent && m.metadata?.status === 'adopted').map(m => m.content as string))];
  } catch (e) {
    console.log(`  Backboard unavailable (${(e as Error).message.slice(0, 60)}); using data/rules.json`);
    return loadRules().filter(r => r.agent === agent && r.status === 'adopted').map(r => r.rule);
  }
}

export const rulesBlock = (rules: string[]) =>
  rules.length ? `\n\nRules learned from earlier runs (each one was tested before it was kept):\n- ${rules.join('\n- ')}` : '';
