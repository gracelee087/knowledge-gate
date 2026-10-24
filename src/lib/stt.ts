// Speech to text on the laptop: Whisper (ONNX, through transformers.js) on the CPU. The audio never leaves the laptop;
// only the model weights are downloaded once, into the transformers.js cache.
// Input: 16 kHz mono float samples (the page records them that way).
import { pipeline } from '@huggingface/transformers';

const MODEL = process.env.WHISPER_MODEL ?? 'onnx-community/whisper-base';
let asr: any = null;
export async function transcribe(samples: Float32Array, language = 'english') {
  asr ??= await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  const t0 = Date.now();
  const r = await asr(samples, { language, task: 'transcribe' });
  return { text: String(r.text ?? '').trim(), ms: Date.now() - t0 };
}
