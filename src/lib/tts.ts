// Voices for the AI team, for the demo: each job speaks with its own ElevenLabs voice.
// This sends the spoken text to ElevenLabs, so it is off unless the page server starts with --voices elevenlabs;
// without it the browser's own voices are used and nothing leaves the laptop.
// Audio is cached on disk by voice and text, so a repeated answer costs nothing.
import '../lib/env.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { need } from './env.ts';

// Premade and library voices on this account (GET /v1/voices, 2026-10-24).
export const TEAM_VOICES: Record<string, { name: string; voice: string }> = {
  today: { name: 'Note Merger', voice: 'XrExE9yKIg1WjnnlVkGX' }, // Matilda: knowledgeable, professional
  notes: { name: 'Notes Assistant', voice: 'onwK4e9ZLuTAKqWW03F9' }, // Daniel: steady broadcaster
  hackathons: { name: 'Hackathon Scout', voice: 'dXtC3XhB9GtPusIpNtQx' }, // Hale: commercial
  flights: { name: 'Travel Agent', voice: 'WQP7cQUF5aAS6Axh5yaa' }, // Elara: crisp narrator
  latest: { name: 'Paper Reader', voice: 'Xb7hH8MSUJpSbSDYk0k2' }, // Alice: clear educator
  host: { name: 'Host', voice: 'vChnJZ1Cu89g2XXumPfT' }, // Lara: natural, relatable (the demo video's narrator)
};
const CACHE = new URL('../../data/cache/tts/', import.meta.url);

export async function speech(text: string, who: string) {
  const v = TEAM_VOICES[who] ?? TEAM_VOICES.notes;
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${createHash('sha1').update(`${v.voice}\n${text}`).digest('hex')}.mp3`, CACHE);
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': need('ELEBENT_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }), // flash: the lowest delay, for answers read out live
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const audio = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, audio);
  return audio;
}

// The same voice, streamed: audio goes to `res` as ElevenLabs makes it, so playback starts before the clip is done;
// the full clip is cached at the end like speech().
export async function speechTo(res: import('node:http').ServerResponse, text: string, who: string) {
  const v = TEAM_VOICES[who] ?? TEAM_VOICES.notes;
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${createHash('sha1').update(`${v.voice}\n${text}`).digest('hex')}.mp3`, CACHE);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  if (existsSync(file)) return res.end(readFileSync(file));
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}/stream?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': need('ELEBENT_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  });
  if (!r.ok || !r.body) return res.end();
  const parts: Buffer[] = [];
  for await (const chunk of r.body as any) { const b = Buffer.from(chunk); parts.push(b); res.write(b); }
  res.end();
  writeFileSync(file, Buffer.concat(parts));
}
