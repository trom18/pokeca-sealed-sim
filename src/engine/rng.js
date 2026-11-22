// 시드 난수 (mulberry32). 상태가 숫자 하나라 저장·복원이 쉽다.
export function makeRng(seed) {
  return { s: seed >>> 0 };
}

export function random(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(rng, n) {
  return Math.floor(random(rng) * n);
}

// 원본은 그대로 두고 섞은 새 배열을 돌려준다
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// { 이름: 비중 } 에서 비중대로 하나 고른다
export function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  let x = random(rng) * entries.reduce((s, [, w]) => s + w, 0);
  for (const [key, w] of entries) {
    x -= w;
    if (x < 0) return key;
  }
  return entries[entries.length - 1][0];
}
