// 팩 개봉. 1팩 = C·U 칸(perPack) + 레어 칸 1장(rareSlot 비중). 값은 data/pack_rates.json(가정).
import { shuffle, pickWeighted } from './rng.js';

const BASE_RARITIES = ['C', 'U', 'R', 'RR'];

// 결과: 팩 배열. 카드 한 장 = { no: 인쇄 번호, id: 덱에 넣을 카드 번호, rarity }
export function openPacks(rng, data, rates, count = 15) {
  const byRarity = {};
  for (const c of data.cards) {
    if (BASE_RARITIES.includes(c.rarity)) (byRarity[c.rarity] ??= []).push({ no: c.no, id: c.no, rarity: c.rarity });
  }
  for (const v of data.variants) (byRarity[v.rarity] ??= []).push({ no: v.no, id: v.baseNo, rarity: v.rarity });

  const take = (rarity, k) => shuffle(rng, byRarity[rarity]).slice(0, k);
  return Array.from({ length: count }, () => [
    ...Object.entries(rates.perPack).flatMap(([rarity, k]) => take(rarity, k)),
    ...take(pickWeighted(rng, rates.rareSlot), 1),
  ]);
}
