// 포켓몬 특성·기술 효과. M5: 001~028 (풀·불꽃·물·번개). 카드 원문: data/cards.json
// 판정 근거: docs/RESEARCH.md 「포켓몬 001~028 Q&A」
// 기술 효과 함수 (s, c, db): c = { p: 쓰는 플레이어, o: 상대, A: 내 배틀 포켓몬, D: 상대 배틀 포켓몬, atk, card }
// 효과가 없는 기술(숫자 데미지만)은 적지 않는다 → game.js가 기본 데미지만 준다.
import { shuffle } from '../rng.js';
import { basicEnergyId } from '../cards.js';
import {
  opp, topId, log, flip, coinText, draw, take, field, monAt, heal, stadiumName,
  setFx, isProtected, abilityOn, addCondition, trashEnergy, switchActive,
} from '../core.js';
import { dealDamage } from '../damage.js';
import { pick } from './trainers.js';

const N = n => String(n).padStart(3, '0') + '/076';
const nameOf = (db, m) => db.get(topId(m)).name;
const hit = (s, c, base, db, opts) => dealDamage(s, c.p, -1, base, db, opts);
const affects = (s, m) => !isProtected(s, m); // 기술의 효과를 받는지 (고속이동으로 보호 중이면 안 받음)
const FIRE = basicEnergyId('불꽃');

function coin(s, p, what) {
  const heads = flip(s);
  log(s, p, `${what}: 동전 ${coinText(heads)}`);
  return heads;
}

function selfDamage(s, c, n, db) {
  c.A.damage += n;
  log(s, c.p, `${nameOf(db, c.A)} 자신에게도 ${n} 데미지`);
}

// 서로 다른 조합만 (같은 카드끼리는 구별하지 않음). ok(크기)로 고를 장수를 정한다.
function combos(ids, ok) {
  const out = new Map();
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const c = ids.filter((_, i) => mask & (1 << i)).sort();
    if (ok(c.length)) out.set(c.join('|'), c);
  }
  return [...out.values()];
}

// 비나방·세꿀버리 「버그패닉」: 덱 아래 7장(모자라면 있는 만큼) 중 「버그패닉」 포켓몬 수 × 50. 포켓몬은 덱으로 섞고 나머지는 트래쉬
function bugPanic(s, c, db) {
  const P = s.players[c.p];
  const shown = P.deck.splice(Math.max(0, P.deck.length - 7));
  const isMon = id => db.get(id).category === '포켓몬';
  const n = shown.filter(id => isMon(id) && db.get(id).attacks.some(a => a.name === '버그패닉')).length;
  log(s, c.p, `덱 아래 ${shown.length}장 공개: ${shown.map(id => db.get(id).name).join(', ')}`);
  hit(s, c, 50 * n, db);
  P.deck = shuffle(s.rng, [...P.deck, ...shown.filter(isMon)]);
  P.discard.push(...shown.filter(id => !isMon(id)));
}

const isBoostEnergy = c => c.category === '기본 에너지' && ['불꽃', '번개'].includes(c.energyType);

// 카드 번호 → { attacks: { 기술 번호: 효과 }, ability: { canUse, use }, firstTurn: [선공 첫 차례에도 쓸 수 있는 기술 번호] }
export const POKEMON = {
  [N(1)]: { // 헤라크로스
    attacks: {
      0: (s, c, db) => { hit(s, c, 20, db); log(s, c.p, `덱에서 ${draw(s.players[c.p], 2).length}장 뽑음`); },
      1: (s, c, db) => { hit(s, c, 130, db); selfDamage(s, c, 30, db); },
    },
  },
  [N(2)]: { attacks: { 0: (s, c) => pick(s, c.p, 'name', 2, { dest: 'bench', arg: '비구술' }) } }, // 비구술 증식하기
  [N(3)]: { // 비나방
    attacks: {
      0: (s, c, db) => { hit(s, c, 30, db); if (affects(s, c.D)) setFx(c.D, 'noAttack', s.turn + 1); },
      1: bugPanic,
    },
  },
  [N(4)]: { attacks: { 0: (s, c, db) => hit(s, c, 10 + (coin(s, c.p, '띄워날리기') ? 10 : 0), db) } }, // 선인왕
  [N(5)]: { // 밤선인
    attacks: {
      0: (s, c) => { s.pending = { player: c.p, kind: 'snipe', amount: 30 }; },
      1: (s, c, db) => hit(s, c, 10 + 50 * field(s.players[c.o]).filter(([, m]) => abilityOn(s, m, db)).length, db),
    },
  },
  [N(6)]: { // 세꿀버리
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 10, db);
        const P = s.players[c.p];
        P.hand.push(...c.A.cards, ...c.A.energy, ...(c.A.tool ? [c.A.tool] : []));
        P.active = null;
        log(s, c.p, `${nameOf(db, c.A)}과(와) 붙어 있는 카드를 모두 패로`);
      },
      1: bugPanic,
    },
  },
  [N(7)]: { attacks: { 1: (s, c, db) => hit(s, c, 80 + (db.get(topId(c.D)).stage !== '기본' ? 80 : 0), db) } }, // 비퀸 클린히트
  [N(9)]: { // 메가갑주무사 ex
    attacks: {
      0: (s, c, db) => hit(s, c, 60 + (c.D.damage > 0 ? 160 : 0), db),
      1: (s, c, db) => { hit(s, c, 160, db); if (affects(s, c.D)) setFx(c.D, 'noRetreat', s.turn + 1); },
    },
  },
  [N(10)]: { // 가디 울부짖기: 상대가 고른 벤치 포켓몬과 교체
    attacks: {
      0: (s, c) => { if (s.players[c.o].bench.length && affects(s, c.D)) s.pending = { player: c.o, kind: 'forcedSwitch' }; },
    },
  },
  [N(11)]: { // 윈디
    attacks: {
      0: (s, c, db) => hit(s, c, 90 + (s.players[c.o].prizes.length <= 4 ? 90 : 0), db),
      1: (s, c, db) => { hit(s, c, 200, db); selfDamage(s, c, 50, db); },
    },
  },
  [N(12)]: { attacks: { 0: (s, c) => pick(s, c.p, 'basicEnergy', 2) } }, // 마그마 힘모으기
  [N(13)]: { // 마그마번 버디 부스트
    ability: {
      canUse: (s, p, m, to, db) => s.players[p].hand.some(id => isBoostEnergy(db.get(id))),
      use: (s, p) => { s.pending = { player: p, kind: 'buddyBoost', used: [] }; },
    },
  },
  [N(14)]: { // 코터스
    attacks: {
      0: (s, c, db) => { hit(s, c, 30, db); if (affects(s, c.D) && addCondition(s, c.D, 'burn', db)) log(s, c.p, `${nameOf(db, c.D)} 화상`); },
      1: (s, c, db) => { hit(s, c, 120, db); setFx(c.A, 'lockAttack', { name: '화염폭', turn: s.turn + 2 }); },
    },
  },
  [N(15)]: { // 히트로토무 ex
    attacks: {
      0: (s, c, db) => {
        const P = s.players[c.p];
        const fires = P.discard.filter(id => id === FIRE);
        log(s, c.p, `트래쉬의 기본 (불꽃) 에너지 ${fires.length}장 공개`);
        hit(s, c, 30 * fires.length, db);
        P.discard = P.discard.filter(id => id !== FIRE);
        P.deck = shuffle(s.rng, [...P.deck, ...fires]);
      },
      1: (s, c, db) => { hit(s, c, 170, db); s.pending = { player: c.p, kind: 'ownEnergy', count: 2 }; },
    },
  },
  [N(16)]: { // 앤티골 파괴불
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 30, db);
        if (coin(s, c.p, '파괴불') && c.D.energy.length && affects(s, c.D)) s.pending = { player: c.p, kind: 'oppEnergy' };
      },
    },
  },
  [N(17)]: { // 만타인
    attacks: {
      0: (s, c) => {
        for (const p of [c.p, c.o]) {
          const P = s.players[p];
          P.deck = shuffle(s.rng, [...P.deck, ...P.hand]);
          P.hand = [];
          draw(P, 4);
        }
        log(s, c.p, '서로 패를 모두 덱으로 되돌려 섞고 4장씩 뽑음');
      },
      1: (s, c, db) => { hit(s, c, 30, db); log(s, c.p, `${nameOf(db, c.A)} HP ${heal(s, c.A, 30, db)} 회복`); },
    },
  },
  [N(18)]: { // 가이오가 거친회오리
    attacks: {
      1: (s, c, db) => {
        hit(s, c, 100, db);
        if (stadiumName(s, db)?.includes('전설')) s.players[c.o].bench.forEach((_, to) => dealDamage(s, c.p, to, 50, db));
      },
    },
  },
  [N(20)]: { // 탱탱겔 심해 드로
    ability: {
      canUse: (s, p) => s.players[p].deck.length > 0,
      use(s, p) {
        draw(s.players[p], 1);
        log(s, p, '덱에서 1장 뽑음');
        s.pending = { player: p, kind: 'deepSea' };
      },
    },
  },
  [N(21)]: { // 약어리 ex 오션 게인
    ability: {
      canUse: (s, p, m, to) => to === -1 && m.damage > 0,
      use: (s, p, m, to, db) => log(s, p, `${nameOf(db, m)} HP ${heal(s, m, 50, db)} 회복`),
    },
  },
  [N(22)]: { attacks: { 0: (s, c) => pick(s, c.p, 'basicPokemon', 2, { dest: 'bench' }) } }, // 에레브 동료부르기
  [N(23)]: { // 에레키블
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 30, db);
        if (coin(s, c.p, '누르기') && affects(s, c.D) && addCondition(s, c.D, 'paralyzed', db)) log(s, c.p, `${nameOf(db, c.D)} 마비`);
      },
      1: (s, c) => { s.pending = { player: c.p, kind: 'voltage' }; },
    },
  },
  [N(24)]: { // 라이코 ex
    firstTurn: [0],
    attacks: {
      0: (s, c) => pick(s, c.p, 'energy', 1, { dest: 'attach', to: -1 }),
      1: (s, c, db) => { hit(s, c, 200, db); if (!coin(s, c.p, '파워러시')) setFx(c.A, 'noAttack', s.turn + 2); },
    },
  },
  [N(25)]: { attacks: { 0: (s, c, db) => hit(s, c, 90, db, { ignoreEffects: true }) } }, // 볼트로스 썬더에지
  [N(26)]: { // 찌르성게 에너지크래시
    attacks: { 0: (s, c, db) => hit(s, c, 20 * field(s.players[c.o]).reduce((n, [, m]) => n + m.energy.length, 0), db) },
  },
  [N(27)]: { attacks: { 0: (s, c, db) => { hit(s, c, 10, db); if (coin(s, c.p, '고속이동')) setFx(c.A, 'protect', s.turn + 1); } } }, // 찌리비
  [N(28)]: { // 찌리비크 습격: 이번 차례에 찌리비에서 진화했다면 +90
    attacks: { 0: (s, c, db) => hit(s, c, 30 + (c.A.evolvedTurn === s.turn && c.A.cards.at(-2) === N(27) ? 90 : 0), db) },
  },
};

// ---------- 늘 작동하는 특성 ----------

const FORCES = ['토네로스', '볼트로스', '랜드로스', '러브로스'];

// 기술 비용. 볼트로스 「화신 단결」: 4종이 모두 자신의 필드에 있으면 (무색) 에너지가 필요 없다
export function attackCost(s, p, m, atk, db) {
  if (topId(m) === N(25) && abilityOn(s, m, db)) {
    const names = field(s.players[p]).map(([, x]) => nameOf(db, x));
    if (FORCES.every(n => names.includes(n))) return atk.cost.filter(t => t !== '무색');
  }
  return atk.cost;
}

// 후퇴 비용. 꼬시레 「저자세」: 상대 필드에 포켓몬 ex(메가진화 ex 포함)가 있으면 0
export function retreatCost(s, p, m, db) {
  if (topId(m) === N(8) && abilityOn(s, m, db) && field(s.players[opp(p)]).some(([, x]) => db.get(topId(x)).rule)) return 0;
  return db.get(topId(m)).retreat;
}

export const firstTurnOK = (m, index) => POKEMON[topId(m)]?.firstTurn?.includes(index) ?? false;

// ---------- 효과 중간의 선택 요청 ----------

export const PENDING = {
  // 밤선인 직격탄: 상대 포켓몬 1마리 골라 데미지 (배틀 포켓몬만 약점·저항력)
  snipe: {
    options: (s, pd) => [-1, ...s.players[opp(pd.player)].bench.keys()].map(to => ({ type: 'choose', to })),
    resolve(s, pd, a, db) { dealDamage(s, pd.player, a.to, pd.amount, db); s.pending = null; },
  },
  // 가디 울부짖기: 상대(pd.player)가 새 배틀 포켓몬을 고른다
  forcedSwitch: {
    options: (s, pd) => s.players[pd.player].bench.map((_, to) => ({ type: 'choose', to })),
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      switchActive(P, a.to);
      log(s, pd.player, `${nameOf(db, P.active)}을(를) 배틀 포켓몬으로 내보냄`);
      s.pending = null;
    },
  },
  // 앤티골 파괴불: 상대 배틀 포켓몬의 에너지 1개 트래쉬
  oppEnergy: {
    options: (s, pd) => [...new Set(s.players[opp(pd.player)].active.energy)].map(id => ({ type: 'choose', id })),
    resolve(s, pd, a, db) {
      const O = s.players[opp(pd.player)];
      O.discard.push(take(O.active.energy, a.id));
      log(s, pd.player, `상대의 ${db.get(a.id).name}을(를) 트래쉬`);
      s.pending = null;
    },
  },
  // 히트로토무 ex 스트롱플레어: 자신의 에너지 count개 트래쉬
  ownEnergy: {
    options: (s, pd) => {
      const e = s.players[pd.player].active.energy;
      return combos(e, n => n === Math.min(pd.count, e.length)).map(ids => ({ type: 'choose', ids }));
    },
    resolve(s, pd, a, db) {
      trashEnergy(s, pd.player, s.players[pd.player].active, a.ids, db, true);
      log(s, pd.player, `에너지 트래쉬: ${a.ids.map(id => db.get(id).name).join(', ')}`);
      s.pending = null;
    },
  },
  // 에레키블 볼티지해머: 붙어 있는 기본 에너지를 원하는 만큼 트래쉬 × 60
  voltage: {
    options: (s, pd, db) => combos(s.players[pd.player].active.energy.filter(id => db.get(id).category === '기본 에너지'), () => true)
      .map(ids => ({ type: 'choose', ids })),
    resolve(s, pd, a, db) {
      trashEnergy(s, pd.player, s.players[pd.player].active, a.ids, db, true);
      log(s, pd.player, `기본 에너지 ${a.ids.length}장 트래쉬`);
      dealDamage(s, pd.player, -1, 60 * a.ids.length, db);
      s.pending = null;
    },
  },
  // 마그마번 버디 부스트: 패의 기본 (불꽃)·(번개) 에너지를 1장씩까지 에레키블·마그마번에게
  buddyBoost: {
    options(s, pd, db) {
      const P = s.players[pd.player];
      const targets = field(P).filter(([, m]) => ['에레키블', '마그마번'].includes(nameOf(db, m))).map(([to]) => to);
      const energies = [...new Set(P.hand)].filter(id => isBoostEnergy(db.get(id)) && !pd.used.includes(db.get(id).energyType));
      return [...energies.flatMap(id => targets.map(to => ({ type: 'choose', id, to }))), { type: 'done' }];
    },
    resolve(s, pd, a, db) {
      if (a.type === 'choose') {
        const P = s.players[pd.player];
        monAt(P, a.to).energy.push(take(P.hand, a.id));
        pd.used.push(db.get(a.id).energyType);
        log(s, pd.player, `버디 부스트: ${nameOf(db, monAt(P, a.to))}에게 ${db.get(a.id).name}`);
      }
      if (a.type === 'done' || pd.used.length === 2) s.pending = null;
    },
  },
  // 탱탱겔 심해 드로: 원하면 패 1장을 덱 아래로 (무엇인지는 상대에게 보이지 않음)
  deepSea: {
    options: (s, pd) => [...[...new Set(s.players[pd.player].hand)].map(id => ({ type: 'choose', id })), { type: 'done' }],
    resolve(s, pd, a) {
      if (a.type === 'choose') {
        const P = s.players[pd.player];
        P.deck.push(take(P.hand, a.id));
        log(s, pd.player, '패 1장을 덱 아래로 되돌림');
      }
      s.pending = null;
    },
  },
};
