// 컴퓨터 행동 선택. 볼 수 있는 정보(view)와 할 수 있는 행동 목록만 받는다(숨은 정보 없음).
//   하수: 무작위. 기술을 쓸 수 있으면 기술 쪽으로, 아니면 차례 끝내기보다 다른 행동 쪽으로 치우친다.
//   중수: 우선순위 규칙. 준비(드로우·벤치·진화·에너지·특성)를 먼저 하고 마지막에 가장 좋은 기술(기절시킬 수 있으면 그 기술).
//   고수: 행동마다 이번 차례가 끝날 때까지(중수 방식으로) 미리 해 보고, 결과 점수가 가장 높은 행동을 고른다.
//         내 덱 순서·프라이즈와 상대의 패·덱은 모르므로, 무작위로 채운 가상 상태 몇 개에서 시뮬레이션한다.
import { random, randInt, makeRng, shuffle } from '../engine/rng.js';
import { basicEnergyId } from '../engine/cards.js';
import { baseDamage, calcDamage } from '../engine/damage.js';
import { legalActions, applyAction, actor, attacksOf, maxHp, canPay } from '../engine/game.js';

const pickRandom = (rng, list) => list[randInt(rng, list.length)];
const WORLDS = 4; // 고수가 상상하는 가상 상태 수
const ROLLOUT_STEPS = 60;

export function chooseAction(view, actions, rng, { level = '하수', db, deck } = {}) {
  if (level === '중수') return actions.length === 1 ? actions[0] : normal(view, actions, db);
  if (level === '고수') return actions.length === 1 ? actions[0] : expert(view, actions, rng, db, deck);
  const attacks = actions.filter(a => a.type === 'attack');
  if (attacks.length && random(rng) < 0.7) return pickRandom(rng, attacks);
  const others = actions.filter(a => a.type !== 'end' && a.type !== 'attack');
  if (others.length && random(rng) < 0.8) return pickRandom(rng, others);
  return pickRandom(rng, actions);
}

// ---------- 공통 판단 도구 (view와 실제 상태 모두에서 쓸 수 있게) ----------

const cardOf = (db, m) => db.get(m.cards[m.cards.length - 1]);
const monAt = (P, to) => (to === -1 ? P.active : P.bench[to]);
const field = P => [P.active, ...P.bench].filter(Boolean);
const left = (m, db) => maxHp(m, db) - m.damage;
const prizeValue = c => (c.rule === '메가진화 ex' ? 3 : c.rule ? 2 : 1);
const ready = (m, db) => attacksOf(m, db).some(a => canPay(a.cost, m.energy, db));
// 가장 센 기술 (데미지가 같으면 뒤의 기술)
const mainAttack = (m, db) => attacksOf(m, db).reduce((b, a) => (baseDamage(a) >= baseDamage(b) ? a : b));
// 비용에서 아직 못 채운 칸 수
function missing(cost, energy, db) {
  const have = energy.map(id => db.get(id).energyType);
  let miss = 0;
  for (const t of cost.filter(t => t !== '무색')) {
    const k = have.indexOf(t);
    if (k < 0) miss++;
    else have.splice(k, 1);
  }
  return miss + Math.max(0, cost.filter(t => t === '무색').length - have.length);
}
const helps = (m, energyId, db) => {
  const cost = mainAttack(m, db).cost;
  return missing(cost, [...m.energy, energyId], db) < missing(cost, m.energy, db);
};
const estDamage = (atk, A, D, db) => calcDamage(baseDamage(atk), cardOf(db, A), cardOf(db, D), true, { defenderTool: D.tool });
const canKO = (A, D, db) => attacksOf(A, db).some(a => canPay(a.cost, A.energy, db) && estDamage(a, A, D, db) >= left(D, db));
const readiness = (m, db) => (ready(m, db) ? 100 : 0) + m.energy.length * 10 + left(m, db) / 10;
const argmax = (list, f) => list.reduce((b, a) => (f(a) > f(b) ? a : b));

// ---------- 중수 ----------

function normal(v, actions, db) {
  const me = actor(v);
  if (v.pending) return pendingChoice(v, actions, me, db);
  return argmax(actions, a => score(v, me, a, db));
}

function score(v, me, a, db) {
  const P = v.players[me];
  const O = v.players[1 - me];
  const A = P.active;
  switch (a.type) {
    case 'attack': { // 준비 행동(20 이상)을 다 한 뒤에 고르도록 10~19
      const atk = attacksOf(A, db)[a.index];
      const dmg = estDamage(atk, A, O.active, db);
      return 10 + (dmg >= left(O.active, db) ? 9 : Math.min(dmg, 300) / 40) + (atk.text ? 0.5 : 0);
    }
    case 'bench': return P.bench.length < 3 ? 40 : 25;
    case 'evolve': return 45 + (db.get(a.id).rule === '메가진화 ex' ? 5 : 0);
    case 'attach': return helps(monAt(P, a.to), a.id, db) ? 30 + (a.to === -1 ? 5 : 0) : 6 + (a.to === -1 ? 1 : 0);
    case 'trainer': return trainerScore(v, me, a, db);
    case 'retreat': {
      const to = P.bench[a.to];
      if (!ready(A, db) && ready(to, db)) return 25;
      if (left(A, db) <= 30 && ready(to, db) && left(to, db) > left(A, db)) return 22;
      return -5;
    }
    case 'ability': return db.get(monAt(P, a.to).cards.at(-1)).ability.name === '심해 드로' && deckLeft(P) < 6 ? -5 : 33;
    case 'handAbility': return 38;
    default: return 0; // end
  }
}

// 덱에서 카드를 빼는 카드(뽑기·찾기): 쓰고 나서 덱이 5장 아래로 줄면 쓰지 않는다 (덱 아웃 방지)
const DECK_USE = { 가이: [3, 50], 'MC의 호응유도': [4, 45], 포켓패드: [1, 42], '풍&란의 수행': [2, 40], '모험 랜턴': [2, 38], 성한: [3, 35] };
const deckLeft = P => P.deckCount ?? P.deck.length;

function trainerScore(v, me, a, db) {
  const P = v.players[me];
  const O = v.players[1 - me];
  const c = db.get(a.id);
  if (DECK_USE[c.name]) return deckLeft(P) - DECK_USE[c.name][0] < 5 ? -5 : DECK_USE[c.name][1];
  switch (c.name) {
    case '맛있는 주먹밥': return P.active.damage >= 60 ? 35 : P.active.damage >= 30 ? 20 : 8;
    case '포켓몬 캐처': return O.bench.some(m => canKO(P.active, m, db)) ? 36 : 10;
    case '피아나의 신뢰': return !ready(P.active, db) && P.bench.some(m => ready(m, db)) ? 34 : -5;
    case '특별주문조끼': return cardOf(db, monAt(P, a.to)).rule === '포켓몬 ex' ? 26 : 12;
    case '메가레쿠쟈캡': return 18;
  }
  if (c.category === '스타디움') return v.stadium?.owner === me ? -5 : 15;
  return 20;
}

function pendingChoice(v, actions, me, db) {
  const P = v.players[me];
  const O = v.players[1 - me];
  const pd = v.pending;
  const choices = actions.filter(a => a.type !== 'done');
  const done = actions.find(a => a.type === 'done');
  const energyTarget = a => (a.to !== undefined ? monAt(P, a.to)
    : pd.kind === 'roar' ? P.bench[pd.to] : pd.kind === 'deltaGift' ? monAt(P, pd.targets[0]) : P.active);
  const fit = a => (helps(energyTarget(a), a.id, db) ? 30 : 5);
  // 상대 포켓몬 고르기: 기절시킬 수 있는(남은 HP가 적은) 포켓몬, 프라이즈가 많은 포켓몬
  const target = a => {
    const m = monAt(O, a.to);
    const amount = pd.amount ?? 0;
    const ko = amount ? left(m, db) <= amount : canKO(P.active, m, db);
    return (ko ? 1000 * prizeValue(cardOf(db, m)) : 0) + (400 - left(m, db));
  };
  switch (pd.kind) {
    case 'setupActive': return argmax(actions, a => (db.get(a.id).rule ? 0 : 1000) + db.get(a.id).hp);
    case 'extraDraw': case 'colorful': return argmax(actions, a => a.n);
    case 'promote': case 'switchOwn': case 'selfSwitch': case 'forcedSwitch': return argmax(actions, a => readiness(P.bench[a.to], db));
    case 'catch': case 'dragOut': case 'snipe': case 'counters': return argmax(actions, target);
    case 'pick': return choices.length ? argmax(choices, a => cardValue(P, db.get(a.id), db)) : done;
    case 'deltaGift': case 'roar': case 'chargeBench': case 'buddyBoost': case 'scaleBeat': case 'moveEnergy':
      return choices.length ? argmax(choices, fit) : done;
    case 'ownEnergy': { // 남는 에너지로 가장 센 기술을 쓸 수 있게
      const after = ids => ids.reduce((e, id) => { e.splice(e.indexOf(id), 1); return e; }, [...P.active.energy]);
      return argmax(actions, a => -missing(mainAttack(P.active, db).cost, after(a.ids), db));
    }
    case 'voltage': return argmax(actions, a => a.ids.length);
    case 'drawTo6': return deckLeft(P) > 10 ? choices[0] : done;
    // 덱이 적으면 덜 필요한 패 1장을 덱 아래로 되돌려 덱 수를 지킨다
    case 'deepSea': return deckLeft(P) > 10 ? done : argmax(choices, a => -cardValue(P, db.get(a.id), db));
    case 'roarAsk': return choices[0];
    default: return choices[0] ?? actions[0]; // setupBench·extraBench·lure·oppEnergy 등
  }
}

// 덱에서 찾을 카드의 값어치: 필드 포켓몬의 진화 카드 > 기본 포켓몬 > 서포트 > 필요한 에너지 > 그 밖
function cardValue(P, c, db) {
  const names = field(P).map(m => cardOf(db, m).name);
  if (c.category === '포켓몬') return c.evolvesFrom && names.includes(c.evolvesFrom) ? 60 : c.stage === '기본' ? 40 + (c.rule ? 10 : 0) : 25;
  if (c.category === '서포트') return 35;
  if (c.category.endsWith('에너지')) return field(P).some(m => helps(m, c.no, db)) ? 30 : 15;
  return 20;
}

// ---------- 고수 ----------

// 덱 안을 보면서 고르는 선택(덱에서 찾기·덱 위 몇 장 보기)은 가상 상태의 덱과 실제 덱이 달라 시뮬레이션하지 않는다
const LOOKS_AT_DECK = ['pick', 'deltaGift', 'chargeBench', 'scaleBeat', 'roar', 'lure'];

function expert(v, actions, rng, db, deck) {
  if (v.phase === 'setup' || LOOKS_AT_DECK.includes(v.pending?.kind)) return normal(v, actions, db);
  const me = actor(v);
  const worlds = Array.from({ length: WORLDS }, () => determinize(v, me, rng, db, deck));
  return argmax(actions, a => worlds.reduce((sum, w) => sum + evaluate(rollout(applyAction(w, a, db), v.turn, db), me, db), 0));
}

// 모르는 상대 카드 자리 채움: 상대 필드 포켓몬 기술에 가장 많이 필요한 타입의 기본 에너지
function fillerFor(O, db) {
  const n = {};
  for (const m of field(O)) for (const a of attacksOf(m, db)) for (const t of a.cost) if (t !== '무색') n[t] = (n[t] ?? 0) + 1;
  const type = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  return basicEnergyId(BASIC_TYPES.includes(type) ? type : '악');
}
const BASIC_TYPES = ['풀', '불꽃', '물', '번개', '초', '격투', '악'];

// 보이는 정보로 실제와 같은 모양의 상태를 만든다. 숨은 카드는 무작위로 채운다.
//  - 내 덱·프라이즈: 내 덱 목록에서 보이는 카드를 뺀 나머지를 섞어서 (덱 목록을 모르면 채움 카드)
//  - 상대 패·덱·프라이즈: 모르므로 상대 주력 타입의 기본 에너지로 채운다 → 상대는 「에너지를 붙이고 기술」 정도로 가정
function determinize(v, me, rng, db, deck) {
  const s = structuredClone(v);
  s.log = [];
  s.rng = makeRng(randInt(rng, 2 ** 32));
  const P = s.players[me];
  const O = s.players[1 - me];
  const seen = [...P.hand, ...P.discard, ...field(P).flatMap(m => [...m.cards, ...m.energy, ...(m.tool ? [m.tool] : [])]),
    ...(s.stadium?.owner === me ? s.stadium.cards : [])];
  const rest = deck ? Object.entries(deck).flatMap(([id, k]) => Array(k).fill(id)) : [];
  for (const id of seen) {
    const k = rest.indexOf(id);
    if (k >= 0) rest.splice(k, 1);
  }
  const hidden = rest.length === P.deckCount + P.prizeCount ? shuffle(rng, rest) : Array(P.deckCount + P.prizeCount).fill(fillerFor(P, db));
  P.prizes = hidden.slice(0, P.prizeCount);
  P.deck = hidden.slice(P.prizeCount);
  const filler = fillerFor(O, db);
  O.hand = Array(O.handCount).fill(filler);
  O.deck = Array(O.deckCount).fill(filler);
  O.prizes = Array(O.prizeCount).fill(filler);
  O.extraDrawn = [];
  for (const X of [P, O]) for (const k of ['deckCount', 'prizeCount', 'handCount']) delete X[k];
  return s;
}

// 이번 차례(turn)와 그다음 차례(상대의 대응)가 끝날 때까지 양쪽 모두 중수 방식으로 진행
function rollout(s, turn, db) {
  for (let i = 0; i < ROLLOUT_STEPS && s.phase !== 'over' && s.turn <= turn + 1; i++) {
    s = applyAction(s, normal(s, legalActions(s, db), db), db);
  }
  return s;
}

// 상대의 대응까지 끝난 뒤 내 입장의 점수: 승패 > 프라이즈 차 > 다음 기절 위협 > 필드(남은 HP·에너지·준비) > 패
function evaluate(s, me, db) {
  if (s.phase === 'over') return s.winner === me ? 1e6 : s.winner === 'draw' ? 0 : -1e6;
  const P = s.players[me];
  const O = s.players[1 - me];
  const taken = X => s.prizeCount - X.prizes.length;
  const side = X => field(X).reduce((n, m) => n + left(m, db) * 0.6 + m.energy.length * 25 + 15 + (ready(m, db) ? 30 : 0), 0);
  let v = 1000 * (taken(P) - taken(O)) + side(P) - side(O) + 5 * Math.min(P.hand.length, 8);
  if (P.active && O.active) {
    // 다음 차례에 에너지 1장을 더 붙인다고 보고 기절시킬 수 있는지
    const threat = (A, D) => attacksOf(A, db).some(a => a.cost.length <= A.energy.length + 1 && estDamage(a, A, D, db) >= left(D, db));
    if (threat(O.active, P.active)) v -= 400 * prizeValue(cardOf(db, P.active));
    if (threat(P.active, O.active)) v += 150 * prizeValue(cardOf(db, O.active));
  }
  if (P.deck.length < 5) v -= (5 - P.deck.length) * 100;
  return v;
}
