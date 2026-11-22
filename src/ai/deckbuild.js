// 자동 덱 구성(하수용): 가장 많이 뽑은 2타입 포켓몬 + 트레이너스 + 기본 에너지 2종류
import { BASIC_ENERGY_TYPES, basicEnergyId, isBasicPokemon } from '../engine/cards.js';
import { DECK_SIZE, SAME_NAME_MAX, deckSize } from '../engine/deck.js';

const MIN_ENERGY = 13;

export function autoBuild(pool, db) {
  const owned = [...db.values()].filter(c => pool[c.no]);
  const pokemon = owned.filter(c => c.category === '포켓몬');

  // 1) 포켓몬 장수가 가장 많은 기본 에너지 타입 2개
  const score = t => pokemon.filter(c => c.type === t).reduce((s, c) => s + pool[c.no], 0);
  const types = [...BASIC_ENERGY_TYPES].sort((a, b) => score(b) - score(a)).slice(0, 2);

  // 2) 그 2타입(+드래곤·무색) 중 고른 에너지로 기술을 쓸 수 있는 포켓몬, 그리고 트레이너스
  const usable = c => c.attacks.some(a => a.cost.every(t => t === '무색' || types.includes(t)));
  const mons = pokemon.filter(c => [...types, '드래곤', '무색'].includes(c.type) && usable(c));
  const others = owned.filter(c => c.category !== '포켓몬' && !c.pairRule &&
    (c.category !== '특수 에너지' || types.includes(c.energyType)));
  // 전설 스타디움은 좌·우 짝으로만, 한 종류만 (같은 이름 4장 = 2짝까지)
  const pairs = owned.filter(c => c.pairRule && c.no.includes('좌측')).map(left => {
    const right = owned.find(c => c.name === left.name && c.no.includes('우측'));
    return right ? { ids: [left.no, right.no], max: Math.min(pool[left.no], pool[right.no], SAME_NAME_MAX / 2) } : null;
  }).filter(Boolean).slice(0, 1);

  // 3) 이름마다 1장째 → 2장째 … 순서로 채운다(트레이너스 먼저). 에너지 자리는 남긴다.
  const units = [];
  for (let copy = 0; copy < SAME_NAME_MAX; copy++) {
    for (const c of [...others, ...mons]) if (copy < Math.min(pool[c.no], SAME_NAME_MAX)) units.push([c.no]);
    for (const p of pairs) if (copy < p.max) units.push(p.ids);
  }
  const deck = {};
  const countName = name => Object.entries(deck).reduce((s, [id, k]) => s + (db.get(id).name === name ? k : 0), 0);
  for (const ids of units) {
    const c = db.get(ids[0]);
    if (deckSize(deck) + ids.length > DECK_SIZE - MIN_ENERGY) continue;
    // 진화 포켓몬은 덱에 든 진화 전 포켓몬 장수까지만
    if (c.evolvesFrom && countName(c.evolvesFrom) <= (deck[c.no] ?? 0)) continue;
    for (const id of ids) deck[id] = (deck[id] ?? 0) + 1;
  }
  if (!Object.keys(deck).some(id => isBasicPokemon(db.get(id)))) deck[pokemon.find(isBasicPokemon).no] = 1;

  // 4) 남은 자리는 기본 에너지. 덱 포켓몬 기술에 필요한 에너지 비율대로 나눈다.
  const need = t => Object.entries(deck).reduce((s, [id, k]) =>
    s + k * (db.get(id).attacks ?? []).flatMap(a => a.cost).filter(x => x === t).length, 0);
  const rest = DECK_SIZE - deckSize(deck);
  const total = need(types[0]) + need(types[1]);
  const first = total ? Math.round(rest * need(types[0]) / total) : rest;
  if (first) deck[basicEnergyId(types[0])] = first;
  if (rest - first) deck[basicEnergyId(types[1])] = rest - first;
  return deck;
}
