// Speech to text on the laptop: Whisper (ONNX, through transformers.js) on the CPU. The audio never leaves the laptop;
// only the model weights are downloaded once, into the transformers.js cache.
// Input: 16 kHz mono float samples (the page records them that way).
import { pipeline } from '@huggingface/transformers';

// small, not base: base heard "fund" as "fun" and "kimchi" as "Kim Chi" (2026-10-24); small takes about 3 s, base 1.2 s.
const MODEL = process.env.WHISPER_MODEL ?? 'onnx-community/whisper-small';
let asr: any = null;
export async function transcribe(samples: Float32Array, language = 'english') {
  asr ??= await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  const t0 = Date.now();
  const r = await asr(samples, { language, task: 'transcribe' });
  const text = String(r.text ?? '').trim();
  // On near-silent audio Whisper makes up a stock phrase ("Thank you.", "you"); treat it as nothing heard.
  return { text: /^(thank you|thanks|you|thanks for watching|bye)[.!]*$/i.test(text) ? '' : text, ms: Date.now() - t0 };
}
