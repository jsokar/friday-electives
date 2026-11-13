// Deterministic random numbers from a text seed, so the same seed always gives the same lottery.
export function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lottery number 0..999 for one student in one rotation (stable for a given seed). */
export function lotteryNumber(seed, studentId) {
  return Math.floor(makeRandom(`${seed}|${studentId}`)() * 1000);
}

/** Fisher–Yates shuffle with a seeded generator (returns a new array). */
export function seededShuffle(list, seed) {
  const rand = makeRandom(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newSeed() {
  const bytes = new Uint32Array(2);
  globalThis.crypto.getRandomValues(bytes); // available in browsers, Node 19+ and Deno
  return bytes[0].toString(36) + bytes[1].toString(36);
}
