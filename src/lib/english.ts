// Cards must be English only: the channel's titles and chapter names are Korean, and small models
// sometimes copy them instead of translating. Returns the JSON paths of strings that contain Hangul.
const RANGES = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7a3]]; // Hangul jamo, compatibility jamo, syllables
const hasHangul = (s: string) => [...s].some(ch => { const c = ch.codePointAt(0)!; return RANGES.some(([lo, hi]) => c >= lo && c <= hi); });

export function nonEnglish(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return hasHangul(value) ? [path || '.'] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonEnglish(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => nonEnglish(v, path ? `${path}.${k}` : k));
  return [];
}
