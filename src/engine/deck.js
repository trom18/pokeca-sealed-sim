// 덱 규칙 검사. 덱·풀은 { 카드 번호: 장수 } 형태.
import { isBasicEnergy, isBasicPokemon, isGiven } from './cards.js';

export const DECK_SIZE = 40;
export const SAME_NAME_MAX = 4;

// 개봉한 팩 → 쓸 수 있는 카드 수. 가이·포켓패드는 1장씩 더한다.
export function poolCounts(packs, data) {
  const pool = {};
  for (const pull of packs.flat()) pool[pull.id] = (pool[pull.id] ?? 0) + 1;
  for (const c of data.cards) if (isGiven(c)) pool[c.no] = 1;
  return pool;
}

export const deckSize = deck => Object.values(deck).reduce((s, k) => s + k, 0);

// 문제 목록(한국어 문장). 빈 배열이면 대전에 쓸 수 있는 덱.
export function deckProblems(deck, pool, db) {
  const out = [];
  const n = deckSize(deck);
  if (n !== DECK_SIZE) out.push(`덱은 40장이어야 합니다 (지금 ${n}장)`);
  const cards = Object.keys(deck).map(id => db.get(id));
  if (!cards.some(isBasicPokemon)) out.push('기본 포켓몬이 1장 이상 있어야 합니다');
  const byName = {};
  for (const c of cards) {
    if (isBasicEnergy(c)) continue;
    byName[c.name] = (byName[c.name] ?? 0) + deck[c.no];
    const have = pool[c.no] ?? 0;
    if (deck[c.no] > have) out.push(`${c.name}: 가진 카드(${have}장)보다 많이 넣었습니다`);
  }
  for (const [name, k] of Object.entries(byName)) {
    if (k > SAME_NAME_MAX) out.push(`같은 이름은 4장까지입니다: ${name} ${k}장`);
  }
  return out;
}

// 덱에 든 카드 중 효과가 아직 구현되지 않은 카드 이름(중복 없이)
export function unimplemented(deck, db) {
  return [...new Set(Object.keys(deck).map(id => db.get(id)).filter(c => !c.implemented).map(c => c.name))];
}
