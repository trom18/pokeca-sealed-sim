// 대전 엔진. 상태(state)는 평범한 데이터라 그대로 저장·복원·복사할 수 있다.
// 규칙 근거: docs/RESEARCH.md 2절. 가정: docs/PLAN.md 0절. 카드 효과는 M4~M6에서 더한다.
//   legalActions(state, db)  지금 할 수 있는 행동 목록 (선택 요청이 있으면 그 선택지)
//   applyAction(state, action, db)  새 상태를 돌려준다 (원래 상태는 그대로)
//   viewFor(state, player)  그 플레이어가 볼 수 있는 정보만
// 자리(to): -1 = 배틀 포켓몬, 0~4 = 벤치 번호. 패의 카드는 카드 번호(id)로 가리킨다.
import { makeRng, random, shuffle } from './rng.js';
import { isBasicPokemon } from './cards.js';
import { baseDamage, calcDamage } from './damage.js';

export const BENCH_MAX = 5;
const HAND_SIZE = 7;
const NO_MOVE = ['asleep', 'paralyzed']; // 기술·후퇴 불가 상태

const opp = p => 1 - p;
const topId = m => m.cards[m.cards.length - 1];
const name = (db, m) => db.get(topId(m)).name;
const freshCond = () => ({ poison: 0, burn: false, special: null, paralyzedTurn: 0 });
const flip = s => random(s.rng) < 0.5; // true = 앞면
const coinText = heads => (heads ? '앞면' : '뒷면');
const log = (s, p, t) => s.log.push({ p, t });
const take = (arr, id) => arr.splice(arr.indexOf(id), 1)[0];
const field = P => [[-1, P.active], ...P.bench.map((m, i) => [i, m])].filter(([, m]) => m);
const monAt = (P, to) => (to === -1 ? P.active : P.bench[to]);

function draw(P, n) {
  const got = P.deck.splice(0, n);
  P.hand.push(...got);
  return got;
}

// 필드에 나온 포켓몬 한 마리. cards = 아래(기본)부터 위(지금 모습)까지
export function newMon(id, turn) {
  return { cards: [id], energy: [], tool: null, damage: 0, cond: freshCond(), playedTurn: turn, evolvedTurn: -1 };
}

// 지금 행동해야 하는 플레이어
export const actor = s => (s.pending ? s.pending.player : s.current);

export function newGame({ decks, first, seed, db, prizeCount = 4, suddenDeath = false }) {
  const rng = makeRng(seed);
  const s = {
    rng, first, current: first, turn: 0, phase: 'setup', prizeCount, suddenDeath,
    players: decks.map(deck => ({
      deck: shuffle(rng, Object.entries(deck).flatMap(([id, k]) => Array(k).fill(id))),
      hand: [], prizes: [], discard: [], active: null, bench: [],
      mulligans: 0, extraDraws: 0, extraDrawn: [], turnsTaken: 0,
      energyAttached: false, supporterPlayed: false, stadiumPlayed: false, retreated: false,
    })),
    stadium: null, pending: null, queue: [], next: 'startGame', winner: null, reason: null, log: [],
  };
  dealHands(s, db);
  const order = [first, opp(first)];
  for (const p of order) s.queue.push({ player: p, kind: 'setupActive' }, { player: p, kind: 'setupBench' });
  for (const p of order) if (s.players[p].extraDraws) s.queue.push({ player: p, kind: 'extraDraw', max: s.players[p].extraDraws });
  advance(s, db);
  return s;
}

// 7장씩 뽑고 멀리건. 한쪽만 다시 뽑으면 상대가 추가 드로우 1회, 양쪽 다면 없음.
function dealHands(s, db) {
  const P = s.players;
  for (const pl of P) draw(pl, HAND_SIZE);
  for (;;) {
    const ok = P.map(pl => pl.hand.some(id => isBasicPokemon(db.get(id))));
    if (ok[0] && ok[1]) return;
    for (const p of [0, 1]) {
      if (ok[p]) continue;
      log(s, p, `기본 포켓몬이 없어 멀리건 (공개한 패: ${P[p].hand.map(id => db.get(id).name).join(', ')})`);
      P[p].deck = shuffle(s.rng, [...P[p].deck, ...P[p].hand]);
      P[p].hand = [];
      draw(P[p], HAND_SIZE);
      P[p].mulligans++;
      if (ok[opp(p)]) P[opp(p)].extraDraws++;
    }
  }
}

// 선택 요청이 없을 때까지 진행 (준비 → 첫 차례, 기절 교체 → 다음 차례)
function advance(s, db) {
  for (;;) {
    if (s.phase === 'over' || s.pending) return;
    if (s.queue.length) {
      s.pending = s.queue.shift();
      if (!needed(s, db)) s.pending = null;
      continue;
    }
    const next = s.next;
    s.next = null;
    if (next === 'startGame') startGame(s, db);
    else if (next === 'nextTurn') startTurn(s, opp(s.current));
    else return;
  }
}

function startGame(s, db) {
  s.players.forEach((P, p) => {
    P.prizes = P.deck.splice(0, s.prizeCount);
    log(s, p, `배틀 포켓몬: ${name(db, P.active)}` + (P.bench.length ? ` / 벤치: ${P.bench.map(m => name(db, m)).join(', ')}` : ''));
  });
  s.phase = 'main';
  startTurn(s, s.first);
}

function startTurn(s, p) {
  const P = s.players[p];
  s.current = p;
  s.turn++;
  Object.assign(P, { energyAttached: false, supporterPlayed: false, stadiumPlayed: false, retreated: false });
  if (!P.deck.length) return gameOver(s, opp(p), '차례 시작에 덱이 없어 카드를 뽑지 못했습니다');
  draw(P, 1);
  log(s, p, `${s.turn}번째 차례 — 1장 뽑음`);
}

function gameOver(s, winner, reason) {
  Object.assign(s, { phase: 'over', winner, reason, pending: null, queue: [], next: null });
  log(s, null, reason);
}

// ---------- 선택 요청 ----------

// 이 선택 요청이 필요한지. 벤치가 1마리뿐인 교체는 바로 처리한다.
function needed(s, db) {
  const { player: p, kind } = s.pending;
  const P = s.players[p];
  const hasBasic = ids => ids.some(id => isBasicPokemon(db.get(id)));
  switch (kind) {
    case 'setupBench': return P.bench.length < BENCH_MAX && hasBasic(P.hand);
    case 'extraBench': return P.bench.length < BENCH_MAX && hasBasic(P.extraDrawn);
    case 'promote':
      if (P.bench.length === 1) { promote(s, p, 0, db); return false; }
      return P.bench.length > 0;
    default: return true;
  }
}

function pendingOptions(s, db) {
  const { player: p, kind, max } = s.pending;
  const P = s.players[p];
  const basics = ids => [...new Set(ids)].filter(id => isBasicPokemon(db.get(id))).map(id => ({ type: 'choose', id }));
  switch (kind) {
    case 'setupActive': return basics(P.hand);
    case 'setupBench': return [...basics(P.hand), { type: 'done' }];
    case 'extraBench': return [...basics(P.extraDrawn), { type: 'done' }];
    case 'extraDraw': return Array.from({ length: max + 1 }, (_, n) => ({ type: 'choose', n }));
    case 'promote': return P.bench.map((_, to) => ({ type: 'choose', to }));
  }
}

function resolvePending(s, a, db) {
  const { player: p, kind } = s.pending;
  const P = s.players[p];
  if (kind === 'setupActive') {
    P.active = newMon(take(P.hand, a.id), 0);
    s.pending = null;
  } else if (kind === 'setupBench' || kind === 'extraBench') {
    if (a.type === 'done') { s.pending = null; return; }
    P.bench.push(newMon(take(P.hand, a.id), 0));
    if (kind === 'extraBench') take(P.extraDrawn, a.id);
    if (!needed(s, db)) s.pending = null;
  } else if (kind === 'extraDraw') {
    P.extraDrawn = draw(P, a.n);
    log(s, p, `상대가 멀리건한 만큼 ${a.n}장 더 뽑음`);
    s.pending = null;
    s.queue.unshift({ player: p, kind: 'extraBench' });
  } else if (kind === 'promote') {
    promote(s, p, a.to, db);
    s.pending = null;
  }
}

function promote(s, p, to, db) {
  const P = s.players[p];
  P.active = P.bench.splice(to, 1)[0];
  log(s, p, `${name(db, P.active)}을(를) 배틀 포켓몬으로 내보냄`);
}

// ---------- 할 수 있는 행동 ----------

export function legalActions(s, db) {
  if (s.phase === 'over') return [];
  if (s.pending) return pendingOptions(s, db);
  const P = s.players[s.current];
  const spots = field(P);
  const out = [];
  for (const id of new Set(P.hand)) {
    const c = db.get(id);
    if (c.category === '포켓몬') {
      if (c.stage === '기본' && P.bench.length < BENCH_MAX) out.push({ type: 'bench', id });
      if (c.evolvesFrom && P.turnsTaken > 0) {
        for (const [to, m] of spots) if (canEvolve(s, m, c, db)) out.push({ type: 'evolve', id, to });
      }
    } else if (c.category.endsWith('에너지')) {
      if (!P.energyAttached) for (const [to] of spots) out.push({ type: 'attach', id, to });
    } else {
      out.push(...trainerActions(s, P, c, spots, db));
    }
  }
  out.push(...retreatActions(P, db));
  const A = P.active;
  if (s.turn !== 1 && !NO_MOVE.includes(A.cond.special)) {
    db.get(topId(A)).attacks.forEach((atk, index) => {
      if (canPay(atk.cost, A.energy, db)) out.push({ type: 'attack', index });
    });
  }
  out.push({ type: 'end' });
  return out;
}

// 각자 첫 차례가 아니고(호출하는 쪽에서 확인), 이번 차례에 나오거나 진화한 포켓몬이 아닐 때
const canEvolve = (s, m, c, db) => name(db, m) === c.evolvesFrom && m.playedTurn !== s.turn && m.evolvedTurn !== s.turn;

function trainerActions(s, P, c, spots, db) {
  const id = c.no;
  switch (c.category) {
    case '아이템': return [{ type: 'trainer', id }];
    case '서포트': return P.supporterPlayed || s.turn === 1 ? [] : [{ type: 'trainer', id }];
    case '포켓몬의 도구': return spots.filter(([, m]) => !m.tool).map(([to]) => ({ type: 'trainer', id, to }));
    case '스타디움': {
      if (P.stadiumPlayed || (s.stadium && db.get(s.stadium.cards[0]).name === c.name)) return [];
      if (!c.pairRule) return [{ type: 'trainer', id }];
      // 전설 스타디움: 패의 좌측 1장 + 같은 이름 우측 1장을 함께 낸다
      const pair = id.includes('좌측') && P.hand.find(h => h.includes('우측') && db.get(h).name === c.name);
      return pair ? [{ type: 'trainer', id, pair }] : [];
    }
  }
  return [];
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [x, ...rest] = arr;
  return [...combinations(rest, k - 1).map(c => [x, ...c]), ...combinations(rest, k)];
}

function retreatActions(P, db) {
  const A = P.active;
  if (P.retreated || !P.bench.length || NO_MOVE.includes(A.cond.special)) return [];
  const cost = db.get(topId(A)).retreat;
  const picks = new Map(combinations(A.energy, cost).map(c => c.sort()).map(c => [c.join('|'), c]));
  return P.bench.flatMap((_, to) => [...picks.values()].map(discard => ({ type: 'retreat', to, discard })));
}

// 기술 비용: 타입 칸은 그 타입 에너지로, 무색 칸은 남은 아무 에너지로
export function canPay(cost, energy, db) {
  const left = energy.map(id => db.get(id).energyType);
  for (const t of cost) {
    if (t === '무색') continue;
    const k = left.indexOf(t);
    if (k < 0) return false;
    left.splice(k, 1);
  }
  return left.length >= cost.filter(t => t === '무색').length;
}

// ---------- 행동 적용 ----------

const actionKey = a => JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]]));

export function applyAction(state, action, db) {
  const k = actionKey(action);
  if (!legalActions(state, db).some(a => actionKey(a) === k)) throw new Error('할 수 없는 행동: ' + JSON.stringify(action));
  const s = structuredClone(state);
  if (s.pending) resolvePending(s, action, db);
  else doMain(s, action, db);
  advance(s, db);
  return s;
}

function doMain(s, a, db) {
  const p = s.current;
  const P = s.players[p];
  const c = a.id && db.get(a.id);
  switch (a.type) {
    case 'bench':
      P.bench.push(newMon(take(P.hand, a.id), s.turn));
      log(s, p, `${c.name}을(를) 벤치에 냄`);
      break;
    case 'evolve': {
      const m = monAt(P, a.to);
      log(s, p, `${name(db, m)} → ${c.name} 진화`);
      m.cards.push(take(P.hand, a.id));
      m.evolvedTurn = s.turn;
      m.cond = freshCond();
      break;
    }
    case 'attach': {
      const m = monAt(P, a.to);
      m.energy.push(take(P.hand, a.id));
      P.energyAttached = true;
      log(s, p, `${name(db, m)}에게 ${c.name}`);
      break;
    }
    case 'trainer': playTrainer(s, p, a, db); break;
    case 'retreat': retreat(s, p, a, db); break;
    case 'attack':
      attack(s, p, a.index, db);
      if (s.phase !== 'over') endTurn(s, db);
      break;
    case 'end': endTurn(s, db); break;
  }
}

function playTrainer(s, p, a, db) {
  const P = s.players[p];
  const c = db.get(a.id);
  const note = c.implemented ? '' : ' (효과 미구현)';
  take(P.hand, a.id);
  if (c.category === '포켓몬의 도구') {
    const m = monAt(P, a.to);
    m.tool = a.id;
    log(s, p, `${name(db, m)}에게 ${c.name}${note}`);
  } else if (c.category === '스타디움') {
    if (s.stadium) s.players[s.stadium.owner].discard.push(...s.stadium.cards);
    s.stadium = { owner: p, cards: a.pair ? [a.id, take(P.hand, a.pair)] : [a.id] };
    P.stadiumPlayed = true;
    log(s, p, `스타디움 ${c.name}${note}`);
  } else {
    if (c.category === '서포트') P.supporterPlayed = true;
    P.discard.push(a.id);
    log(s, p, `${c.name}${note}`);
  }
}

function retreat(s, p, a, db) {
  const P = s.players[p];
  const A = P.active;
  for (const id of a.discard) P.discard.push(take(A.energy, id));
  A.cond = freshCond();
  P.active = P.bench[a.to];
  P.bench[a.to] = A;
  P.retreated = true;
  log(s, p, `${name(db, A)} 후퇴 → ${name(db, P.active)}`);
}

function attack(s, p, index, db) {
  const A = s.players[p].active;
  const card = db.get(topId(A));
  const atk = card.attacks[index];
  log(s, p, `${card.name}의 「${atk.name}」`);
  if (A.cond.special === 'confused') {
    const heads = flip(s);
    log(s, p, `혼란: 동전 ${coinText(heads)}`);
    if (!heads) {
      A.damage += 30;
      log(s, p, '기술 실패 — 자신에게 데미지 카운터 3개');
      resolveKOs(s, db);
      return;
    }
  }
  const D = s.players[opp(p)].active;
  const dmg = calcDamage(baseDamage(atk), card, db.get(topId(D)), true);
  D.damage += dmg;
  log(s, p, `${name(db, D)}에게 ${dmg} 데미지${atk.text && !card.implemented ? ' (기술 효과 미구현)' : ''}`);
  resolveKOs(s, db);
}

// 차례 끝: 포켓몬 체크 → 기절 처리 → 교체 요청 → 다음 차례
function endTurn(s, db) {
  s.players[s.current].turnsTaken++;
  checkup(s, db);
  resolveKOs(s, db);
  if (s.phase === 'over') return;
  for (const p of [s.current, opp(s.current)]) if (!s.players[p].active) s.queue.push({ player: p, kind: 'promote' });
  s.next = 'nextTurn';
}

// 포켓몬 체크: ① 독 ② 화상 ③ 잠듦 ④ 마비 (양쪽 배틀 포켓몬)
function checkup(s, db) {
  const actives = [s.current, opp(s.current)].map(p => [p, s.players[p].active]).filter(([, m]) => m);
  for (const [p, m] of actives) {
    if (!m.cond.poison) continue;
    m.damage += 10 * m.cond.poison;
    log(s, p, `독: ${name(db, m)}에게 데미지 카운터 ${m.cond.poison}개`);
  }
  for (const [p, m] of actives) {
    if (!m.cond.burn) continue;
    m.damage += 20;
    const heads = flip(s);
    if (heads) m.cond.burn = false;
    log(s, p, `화상: ${name(db, m)}에게 데미지 카운터 2개, 동전 ${coinText(heads)}${heads ? ' → 회복' : ''}`);
  }
  for (const [p, m] of actives) {
    if (m.cond.special !== 'asleep') continue;
    const heads = flip(s);
    if (heads) m.cond.special = null;
    log(s, p, `잠듦: 동전 ${coinText(heads)}${heads ? ' → 깨어남' : ''}`);
  }
  for (const [p, m] of actives) {
    if (m.cond.special !== 'paralyzed' || p !== s.current || m.cond.paralyzedTurn >= s.turn) continue;
    m.cond.special = null;
    log(s, p, `마비 회복: ${name(db, m)}`);
  }
}

// HP만큼 데미지를 받은 포켓몬 기절 → 트래쉬, 상대가 프라이즈(보통 1, ex 2, 메가진화 ex 3) → 승패 확인
function resolveKOs(s, db) {
  const owed = [0, 0];
  s.players.forEach((P, p) => {
    for (const [to, m] of field(P)) {
      const c = db.get(topId(m));
      if (m.damage < c.hp) continue;
      log(s, p, `${c.name} 기절`);
      P.discard.push(...m.cards, ...m.energy, ...(m.tool ? [m.tool] : []));
      owed[opp(p)] += c.rule === '메가진화 ex' ? 3 : c.rule === '포켓몬 ex' ? 2 : 1;
      if (to === -1) P.active = null;
      else P.bench[to] = null;
    }
    P.bench = P.bench.filter(Boolean);
  });
  owed.forEach((n, p) => {
    if (!n) return;
    const got = s.players[p].prizes.splice(0, n);
    s.players[p].hand.push(...got);
    log(s, p, `프라이즈 ${got.length}장을 가져감`);
  });
  checkWin(s);
}

// 승리 조건: 프라이즈를 모두 가져옴(서든데스는 1장), 상대 필드에 포켓몬 없음.
// 동시에 일어나면 조건이 많은 쪽이 승리, 같으면 무승부 → 서든데스 (배틀규정 8쪽)
function checkWin(s) {
  const conds = [0, 1].map(p => {
    const P = s.players[p];
    const O = s.players[opp(p)];
    const out = [];
    if (s.suddenDeath ? P.prizes.length < s.prizeCount : P.prizes.length === 0) out.push(s.suddenDeath ? '서든데스에서 프라이즈를 먼저 가져감' : '프라이즈를 모두 가져감');
    if (!O.active && !O.bench.length) out.push('상대 필드에 포켓몬이 없음');
    return out;
  });
  const [a, b] = conds.map(c => c.length);
  if (!a && !b) return;
  if (a === b) return gameOver(s, 'draw', '양쪽이 같은 수의 승리 조건을 동시에 만족 → 서든데스');
  const w = a > b ? 0 : 1;
  gameOver(s, w, conds[w].join(', '));
}

// ---------- 보이는 정보 ----------

// 상대 패, 양쪽 덱·프라이즈(뒷면), 난수 상태는 숨긴다. 준비 중에는 상대가 뒷면으로 놓은 포켓몬도 숨긴다.
export function viewFor(s, p) {
  const v = structuredClone(s);
  delete v.rng;
  v.players.forEach((P, q) => {
    P.deckCount = P.deck.length;
    P.prizeCount = P.prizes.length;
    delete P.deck;
    delete P.prizes;
    if (q === p) return;
    P.handCount = P.hand.length;
    delete P.hand;
    delete P.extraDrawn;
    if (v.phase === 'setup') {
      delete P.active;
      delete P.bench;
    }
  });
  return v;
}
