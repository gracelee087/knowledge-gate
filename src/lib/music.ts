// Background music for the demo: a soft bed under the host while an answer is prepared, and a calm loop for a tired user.
// This sends only the music prompt below to ElevenLabs (POST /v1/music); no user text leaves the laptop.
// Each loop is generated once and cached on disk, so playing it again costs nothing. Demo only.
import '../lib/env.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { need } from './env.ts';

const LOOPS = {
  wait: { ms: 30_000, prompt: 'Soft, light, gently upbeat lo-fi hip hop bed, mellow keys, warm vinyl texture, relaxed drums, low energy, background music under a speaking voice, seamless loop, no vocals' },
  relax: { ms: 60_000, prompt: 'Calm, relaxing ambient piano, slow and spacious, soft pads, peaceful and soothing for a tired listener, no drums, seamless loop, no vocals' },
};
const CACHE = new URL('../../data/cache/music/', import.meta.url);

export async function music(kind: 'wait' | 'relax'): Promise<Buffer> {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${kind}.mp3`, CACHE);
  if (existsSync(file)) return readFileSync(file);
  const { ms, prompt } = LOOPS[kind];
  const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': need('ELEBENT_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: ms, force_instrumental: true }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const audio = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, audio);
  return audio;
}
