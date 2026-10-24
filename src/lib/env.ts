import { readFileSync } from 'node:fs';

// Minimal .env loader: KEY=value per line, no quoting rules.
const text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
for (const line of text.split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0 && !process.env[line.slice(0, i).trim()]) {
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}
