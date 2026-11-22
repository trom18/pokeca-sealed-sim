// game.js와 카드 효과(effects/)가 함께 쓰는 작은 도구들, 그리고 늘 켜져 있는 스타디움·특수 에너지 효과.
import { random } from './rng.js';

// 효과에서 이름으로 부르는 카드 번호
export const ID = {
  주먹밥: '063/076', 랜턴: '064/076', 캡: '065/076', 조끼: '066/076', MC: '067/076', 성한: '068/076',
  풍란: '069/076', 피아나: '070/076', 가이: '88/M-P', 포켓패드: '87/M-P', 캐처: '098/076',
  그로우: '104/076', 니트로: '105/076', 버블: '106/076',
  고지: '036/076', 강철톤: '038/076',
};

export const BENCH_MAX = 5;
export const opp = p => 1 - p;
export const topId = m => m.cards[m.cards.length - 1];
export const freshCond = () => ({ poison: 0, burn: false, special: null, paralyzedTurn: 0 });
export const flip = s => random(s.rng) < 0.5; // true = 앞면
export const coinText = heads => (heads ? '앞면' : '뒷면');
export const log = (s, p, t) => s.log.push({ p, t });
export const take = (arr, id) => arr.splice(arr.indexOf(id), 1)[0];
export const field = P => [[-1, P.active], ...P.bench.map((m, i) => [i, m])].filter(([, m]) => m);
export const monAt = (P, to) => (to === -1 ? P.active : P.bench[to]);
export const stadiumName = (s, db) => (s.stadium ? db.get(s.stadium.cards[0]).name : null);

export function draw(P, n) {
  const got = P.deck.splice(0, n);
  P.hand.push(...got);
  return got;
}

// 필드에 나온 포켓몬 한 마리. cards = 아래(기본)부터 위(지금 모습)까지.
// fx = 기술로 받은 효과 { noAttack, noRetreat, protect: 그 효과가 걸리는 차례 번호, lockAttack: { name, turn } }
export function newMon(id, turn) {
  return { cards: [id], energy: [], tool: null, damage: 0, cond: freshCond(), fx: {}, playedTurn: turn, evolvedTurn: -1, abilityTurn: -1 };
}

// 진화: 카드를 위에 올린다. 데미지·에너지·도구는 그대로, 특수 상태와 받고 있던 효과는 사라진다
export function evolveMon(m, id, turn) {
  m.cards.push(id);
  m.evolvedTurn = turn;
  m.cond = freshCond();
  m.fx = {};
  m.abilityTurn = -1;
}

// 기술 효과 걸기 (그 차례에만 작동)
export const setFx = (m, key, value) => { (m.fx ??= {})[key] = value; };
// 고속이동 등: 이 차례에 기술의 데미지·효과를 받지 않는 상태인지
export const isProtected = (s, m) => m.fx?.protect === s.turn;

// 배틀 포켓몬과 벤치 포켓몬 교체. 벤치로 간 포켓몬은 특수 상태가 회복되고 받고 있던 효과가 사라진다.
export function switchActive(P, to) {
  const old = P.active;
  old.cond = freshCond();
  old.fx = {};
  P.active = P.bench[to];
  P.bench[to] = old;
}

// 최대 HP. 그로우 풀 에너지: 붙인 (풀) 포켓몬은 1장당 +20
export function maxHp(m, db) {
  const c = db.get(topId(m));
  return c.hp + (c.type === '풀' ? 20 * m.energy.filter(id => id === ID.그로우).length : 0);
}

// HP 회복(데미지를 줄인다). 전설의 해구: 회복량 2배. 실제로 회복한 양을 돌려준다.
export function heal(s, m, amount, db) {
  const n = Math.min(m.damage, stadiumName(s, db) === '전설의 해구' ? amount * 2 : amount);
  m.damage -= n;
  return n;
}

// 특성이 지금 작동하는지. 전설의 용암동굴: 필드의 진화 포켓몬은 특성이 없어진다.
export function abilityOn(s, m, db) {
  const c = db.get(topId(m));
  return !!c.ability && !(stadiumName(s, db) === '전설의 용암동굴' && c.stage !== '기본');
}

// 버블 물 에너지: 붙인 (물) 포켓몬은 특수 상태가 되지 않고, 받고 있던 특수 상태도 회복
const bubbled = (m, db) => db.get(topId(m)).type === '물' && m.energy.includes(ID.버블);

export function clearProtected(s, db) {
  for (const P of s.players) for (const [, m] of field(P)) if (bubbled(m, db)) m.cond = freshCond();
}

// 특수 상태 걸기 (기술 효과용). 걸리면 true. poisonCounters: 독으로 올리는 데미지 카운터 수 (아리아도스 격통독은 4)
export function addCondition(s, m, kind, db, poisonCounters = 1) {
  if (bubbled(m, db)) return false;
  if (kind === 'poison') m.cond.poison = Math.max(m.cond.poison, poisonCounters);
  else if (kind === 'burn') m.cond.burn = true;
  else {
    m.cond.special = kind;
    if (kind === 'paralyzed') m.cond.paralyzedTurn = s.turn;
  }
  return true;
}

// 붙어 있는 에너지 트래쉬. 니트로 불꽃 에너지: 자기 (불꽃) 포켓몬의 기술 효과로 트래쉬되면 기술이 끝난 뒤 패로
export function trashEnergy(s, p, m, ids, db, byOwnAttack) {
  const P = s.players[p];
  for (const id of ids) {
    P.discard.push(take(m.energy, id));
    if (byOwnAttack && id === ID.니트로 && db.get(topId(m)).type === '불꽃') (s.returnToHand ??= []).push({ p, id });
  }
}

export function returnAfterAttack(s, db) {
  for (const { p, id } of s.returnToHand ?? []) {
    s.players[p].hand.push(take(s.players[p].discard, id));
    log(s, p, `${db.get(id).name}을(를) 패로 되돌림`);
  }
  s.returnToHand = [];
}
