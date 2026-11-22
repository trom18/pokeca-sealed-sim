// 자동 덱 구성
//   autoBuild  (하수): 가장 많이 뽑은 2타입 포켓몬 + 트레이너스 + 기본 에너지 2종류
//   smartBuild (중수·고수, 사람의 「자동 구성」 버튼): 공략 PDF 별점(data/ratings.json)과 덱 짜는 법
//     — 2색, 유틸 포켓몬(루리리·에레브·니드런♀), 트레이너스 전부(메가레쿠쟈캡 1장이면 뺌), 기본 에너지 14~18장
import { BASIC_ENERGY_TYPES, basicEnergyId, isBasicPokemon } from '../engine/cards.js';
import { DECK_SIZE, SAME_NAME_MAX, deckSize } from '../engine/deck.js';

const MIN_ENERGY = 13;
const STAGE = { 기본: 0, '1진화': 1, '2진화': 2 };

// 고른 에너지 2타입으로 쓸 수 있는 기술이 있는지
const usableWith = (c, types) => c.attacks.some(a => a.cost.every(t => t === '무색' || types.includes(t)));

// 전설 스타디움은 좌·우 짝으로만 (같은 이름 4장 = 2짝까지)
function legendPairs(owned, pool) {
  return owned.filter(c => c.pairRule && c.no.includes('좌측')).map(left => {
    const right = owned.find(c => c.name === left.name && c.no.includes('우측'));
    return right ? { ids: [left.no, right.no], max: Math.min(pool[left.no], pool[right.no], SAME_NAME_MAX / 2) } : null;
  }).filter(Boolean);
}

// 묶음(ids)을 순서대로 넣는다. 진화 포켓몬은 덱에 든 진화 전 포켓몬 장수까지만, 덱이 limit장을 넘지 않게
function addUnits(deck, units, limit, db) {
  const countName = name => Object.entries(deck).reduce((s, [id, k]) => s + (db.get(id).name === name ? k : 0), 0);
  for (const ids of units) {
    const c = db.get(ids[0]);
    if (deckSize(deck) + ids.length > limit) continue;
    if (c.evolvesFrom && countName(c.evolvesFrom) <= (deck[c.no] ?? 0)) continue;
    for (const id of ids) deck[id] = (deck[id] ?? 0) + 1;
  }
}

// 남은 자리는 기본 에너지. 덱 포켓몬 기술에 필요한 에너지 비율대로 2타입에 나눈다.
function fillEnergy(deck, types, db) {
  const need = t => Object.entries(deck).reduce((s, [id, k]) =>
    s + k * (db.get(id).attacks ?? []).flatMap(a => a.cost).filter(x => x === t).length, 0);
  const rest = DECK_SIZE - deckSize(deck);
  const total = need(types[0]) + need(types[1]);
  const first = total ? Math.round(rest * need(types[0]) / total) : rest;
  if (first) deck[basicEnergyId(types[0])] = first;
  if (rest - first) deck[basicEnergyId(types[1])] = rest - first;
  return deck;
}

const ensureBasic = (deck, pokemon, db) => {
  if (!Object.keys(deck).some(id => isBasicPokemon(db.get(id)))) deck[pokemon.find(isBasicPokemon).no] = 1;
};

export function autoBuild(pool, db) {
  const owned = [...db.values()].filter(c => pool[c.no]);
  const pokemon = owned.filter(c => c.category === '포켓몬');

  // 1) 포켓몬 장수가 가장 많은 기본 에너지 타입 2개
  const score = t => pokemon.filter(c => c.type === t).reduce((s, c) => s + pool[c.no], 0);
  const types = [...BASIC_ENERGY_TYPES].sort((a, b) => score(b) - score(a)).slice(0, 2);

  // 2) 그 2타입(+드래곤·무색) 중 고른 에너지로 기술을 쓸 수 있는 포켓몬, 그리고 트레이너스
  const mons = pokemon.filter(c => [...types, '드래곤', '무색'].includes(c.type) && usableWith(c, types));
  const others = owned.filter(c => c.category !== '포켓몬' && !c.pairRule &&
    (c.category !== '특수 에너지' || types.includes(c.energyType)));
  const pairs = legendPairs(owned, pool).slice(0, 1); // 한 종류만

  // 3) 이름마다 1장째 → 2장째 … 순서로 채운다(트레이너스 먼저). 에너지 자리는 남긴다.
  const units = [];
  for (let copy = 0; copy < SAME_NAME_MAX; copy++) {
    for (const c of [...others, ...mons]) if (copy < Math.min(pool[c.no], SAME_NAME_MAX)) units.push([c.no]);
    for (const p of pairs) if (copy < p.max) units.push(p.ids);
  }
  const deck = {};
  addUnits(deck, units, DECK_SIZE - MIN_ENERGY, db);
  ensureBasic(deck, pokemon, db);
  return fillEnergy(deck, types, db);
}

export function smartBuild(pool, db, ratings) {
  const owned = [...db.values()].filter(c => pool[c.no]);
  const pokemon = owned.filter(c => c.category === '포켓몬');
  const star = c => ratings.stars[c.name] ?? 0;
  // 진화 계열 점수: 자신과 풀에 있는 진화 카드 중 가장 높은 별점 (진화 전 포켓몬은 별점이 없어서)
  const lineStar = c => Math.max(star(c), ...pokemon.filter(e => e.evolvesFrom === c.name).map(lineStar));
  // 진화 전 포켓몬이 목록에 없는 진화 포켓몬은 뺀다
  const keepLines = list => {
    const next = list.filter(c => !c.evolvesFrom || list.some(x => x.name === c.evolvesFrom));
    return next.length === list.length ? list : keepLines(next);
  };
  const monsFor = types => keepLines(pokemon.filter(c => [...types, '드래곤', '무색'].includes(c.type) && usableWith(c, types)));
  const has = (list, pair) => list.some(([a, b]) => pair.includes(a) && pair.includes(b));

  // 1) 2색: 쓸 수 있는 포켓몬 별점 합 + 공략의 추천 조합 가산점(불꽃·번개 1티어, 풀·악·물·초, 격투·드래곤 비추천)
  const pairs = BASIC_ENERGY_TYPES.flatMap((a, i) => BASIC_ENERGY_TYPES.slice(i + 1).map(b => [a, b]));
  const pairScore = pair => monsFor(pair).reduce((s, c) => s + star(c) * Math.min(pool[c.no], 2), 0) +
    (has(ratings.typePairs.best, pair) ? 6 : has(ratings.typePairs.good, pair) ? 3 : 0) -
    3 * pair.filter(t => ratings.typePairs.avoid.includes(t)).length;
  const types = pairs.reduce((best, p) => (pairScore(p) > pairScore(best) ? p : best));
  const mons = monsFor(types);

  // 2) 넣을 카드에 점수를 매겨 높은 것부터: 유틸 포켓몬 1장 > 트레이너스 > 특수 에너지 > 포켓몬(별점, 같은 이름은 장수가 늘수록 낮게)
  const units = [];
  for (const c of pokemon.filter(c => ratings.utility.includes(c.name))) units.push({ ids: [c.no], value: 100, stage: 0 });
  for (const c of mons) {
    for (let k = 0; k < Math.min(pool[c.no], SAME_NAME_MAX); k++) {
      if (ratings.utility.includes(c.name) && k === 0) continue; // 1장째는 위에서 넣음
      units.push({ ids: [c.no], value: 20 + lineStar(c) * 10 - k * 8, stage: STAGE[c.stage] });
    }
  }
  for (const c of owned.filter(c => ['아이템', '서포트', '포켓몬의 도구'].includes(c.category))) {
    if (c.name === '메가레쿠쟈캡' && pool[c.no] === 1) continue;
    for (let k = 0; k < Math.min(pool[c.no], SAME_NAME_MAX); k++) units.push({ ids: [c.no], value: 90, stage: 0 });
  }
  for (const p of legendPairs(owned, pool)) for (let k = 0; k < p.max; k++) units.push({ ids: p.ids, value: 85 - k * 20, stage: 0 });
  for (const c of owned.filter(c => c.category === '특수 에너지' && types.includes(c.energyType))) {
    for (let k = 0; k < Math.min(pool[c.no], SAME_NAME_MAX); k++) units.push({ ids: [c.no], value: 80, stage: 0 });
  }
  // 그래도 자리가 남으면: 다른 타입이라도 고른 에너지로 기술을 쓸 수 있는 포켓몬
  for (const c of keepLines(pokemon.filter(c => usableWith(c, types) && !mons.includes(c)))) {
    for (let k = 0; k < Math.min(pool[c.no], SAME_NAME_MAX); k++) units.push({ ids: [c.no], value: 5 + star(c) - k, stage: STAGE[c.stage] });
  }
  units.sort((a, b) => b.value - a.value || a.stage - b.stage);

  const deck = {};
  addUnits(deck, units.map(u => u.ids), DECK_SIZE - ratings.energy.min, db);
  ensureBasic(deck, pokemon, db);
  return fillEnergy(deck, types, db);
}
