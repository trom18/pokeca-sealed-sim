// 포켓몬 특성·기술 효과. M5: 001~028 (풀·불꽃·물·번개). 카드 원문: data/cards.json
// 판정 근거: docs/RESEARCH.md 「포켓몬 001~028 Q&A」
// 기술 효과 함수 (s, c, db): c = { p: 쓰는 플레이어, o: 상대, A: 내 배틀 포켓몬, D: 상대 배틀 포켓몬, atk, card }
// 효과가 없는 기술(숫자 데미지만)은 적지 않는다 → game.js가 기본 데미지만 준다.
import { shuffle, randInt } from '../rng.js';
import { basicEnergyId } from '../cards.js';
import {
  BENCH_MAX, opp, topId, log, flip, coinText, draw, take, field, monAt, heal, stadiumName,
  setFx, isProtected, abilityOn, addCondition, trashEnergy, switchActive, newMon,
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
      0: (s, c, db) => { hit(s, c, 30, db); condition(s, c, 'burn', db); },
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
      0: (s, c, db) => { hit(s, c, 30, db); if (coin(s, c.p, '누르기')) condition(s, c, 'paralyzed', db); },
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

  // ---------- M6: 029~062 ----------
  [N(30)]: { // 슬리퍼
    attacks: {
      0: (s, c, db) => hit(s, c, 20 * s.players[c.o].hand.length, db),
      1: (s, c, db) => { hit(s, c, 50, db); condition(s, c, 'asleep', db); },
    },
  },
  [N(31)]: { attacks: { 0: (s, c, db) => { hit(s, c, 120, db); setFx(c.A, 'noDamage', s.turn + 1); } } }, // 기라티나 카오스크롤러
  [N(33)]: { attacks: { 0: (s, c, db) => { hit(s, c, 300, db); selfDamage(s, c, 30, db); } } }, // 메가골루그 ex
  [N(34)]: { attacks: { 0: (s, c, db) => hit(s, c, 100 + (db.get(topId(c.D)).rule ? 100 : 0), db) } }, // 러브로스 (메가진화 ex도 포켓몬 ex)
  [N(35)]: { attacks: { 0: (s, c, db) => pick(s, c.p, 'evolvesFrom', 1, { dest: 'evolve', to: -1, arg: nameOf(db, c.A) }) } }, // 모래두지 각성
  [N(36)]: { // 고지 구멍파기클로 (특성 반격가시는 damage.js)
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 60, db);
        const O = s.players[c.o];
        if (O.deck.length) {
          O.discard.push(O.deck.shift());
          log(s, c.p, `상대 덱 위 1장 트래쉬: ${db.get(O.discard.at(-1)).name}`);
        }
      },
    },
  },
  [N(37)]: { attacks: { 0: (s, c, db) => { hit(s, c, 80, db); setFx(c.A, 'reduce30', s.turn + 1); } } }, // 롱스톤 가드프레스
  [N(38)]: { attacks: { 0: (s, c, db) => hit(s, c, 150, db, { ignoreResistance: true }) } }, // 강철톤 하드스윙
  [N(39)]: { attacks: { 1: (s, c, db) => hit(s, c, 100 + (stadiumName(s, db)?.includes('전설') ? 170 : 0), db) } }, // 그란돈
  [N(40)]: { // 랜드로스 가이아크래시: 데미지 후 스타디움 트래쉬 (기절 판정보다 먼저)
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 110, db);
        if (s.stadium) {
          log(s, c.p, `스타디움 ${db.get(s.stadium.cards[0]).name} 트래쉬`);
          s.players[s.stadium.owner].discard.push(...s.stadium.cards);
          s.stadium = null;
        }
      },
    },
  },
  [N(41)]: { attacks: { 0: (s, c) => pick(s, c.p, 'pokemon', 1) } }, // 니드런♀ 친구찾기
  [N(43)]: { // 니드퀸
    ability: { // 어머니의 권유
      canUse: (s, p) => s.players[opp(p)].bench.length > 0,
      use: (s, p) => { if (coin(s, p, '어머니의 권유')) s.pending = { player: p, kind: 'catch' }; },
    },
    attacks: { 0: (s, c, db) => { hit(s, c, 150, db); setFx(c.A, 'noAttack', s.turn + 2); } },
  },
  [N(44)]: { attacks: { 0: (s, c, db) => condition(s, c, 'poison', db), 1: bugPanic } }, // 페이검
  [N(45)]: { // 아리아도스
    attacks: {
      0: (s, c, db) => condition(s, c, 'poison', db, 4),
      1: (s, c, db) => { hit(s, c, 80, db); setFx(c.A, 'noDamageFromBasic', s.turn + 1); },
    },
  },
  [N(46)]: { // 깜까미
    attacks: {
      0: (s, c, db) => {
        const O = s.players[c.o];
        const n = Math.min(5, O.deck.length);
        log(s, c.p, `상대 덱 위 ${n}장 공개: ${O.deck.slice(0, n).map(id => db.get(id).name).join(', ')}`);
        s.pending = { player: c.p, kind: 'lure', n };
      },
      1: (s, c) => { s.pending = { player: c.p, kind: 'counters', amount: 50 }; },
    },
  },
  [N(47)]: { // 오케이징 탁쳐서떨구기: 상대 패에서 보지 않고 1장
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 10, db);
        const O = s.players[c.o];
        if (O.hand.length) {
          const [id] = O.hand.splice(randInt(s.rng, O.hand.length), 1);
          O.discard.push(id);
          log(s, c.p, `상대 패 1장 트래쉬: ${db.get(id).name}`);
        }
      },
    },
  },
  [N(48)]: { // 메가칼라마네로 ex
    attacks: {
      0: (s, c, db) => hit(s, c, 70 * s.players[c.o].bench.length, db),
      1: (s, c, db) => { hit(s, c, 200, db); condition(s, c, 'confused', db); },
    },
  },
  [N(49)]: { attacks: { 0: (s, c) => { if (s.players[c.o].bench.length) s.pending = { player: c.p, kind: 'dragOut' }; } } }, // 크리만 끌어내기
  [N(50)]: { attacks: { 0: (s, c, db) => { hit(s, c, 30, db); setFx(c.A, 'reduce30', s.turn + 1); } } }, // 짜랑꼬 단단한머리
  [N(51)]: { // 짜랑고우 더블스매시
    attacks: { 0: (s, c, db) => hit(s, c, 70 * [coin(s, c.p, '더블스매시'), coin(s, c.p, '더블스매시')].filter(Boolean).length, db) },
  },
  [N(52)]: { // 짜랑고우거 스케일 비트
    ability: {
      canUse: (s, p) => s.players[p].deck.length > 0,
      use: (s, p) => { s.pending = { player: p, kind: 'scaleBeat', n: Math.min(6, s.players[p].deck.length) }; },
    },
  },
  [N(53)]: { // 모토마 브레이크스루
    attacks: { 1: (s, c, db) => { hit(s, c, 110, db); if (s.players[c.o].bench.length) s.pending = { player: c.p, kind: 'snipe', amount: 30, benchOnly: true }; } },
  },
  [N(54)]: { attacks: { 0: (s, c) => { s.pending = { player: c.p, kind: 'chargeBench' }; } } }, // 루리리 깡충깡충차지
  [N(55)]: { attacks: { 0: (s, c) => { if (s.players[c.p].bench.length) s.pending = { player: c.p, kind: 'selfSwitch' }; } } }, // 파비코 들뜸
  [N(57)]: { attacks: { 0: (s, c) => { s.pending = { player: c.p, kind: 'colorful' }; } } }, // 켈리몬 컬러풀휩
  [N(58)]: { // 메가레쿠쟈 ex
    onBench: (s, p, to, db) => { // 패왕의 포효: 패에서 벤치로 냈을 때 (원하면)
      const m = s.players[p].bench[to];
      if (abilityOn(s, m, db) && s.players[p].deck.length) s.pending = { player: p, kind: 'roarAsk', to };
    },
    attacks: { // 스톰에메랄다: 자신의 포켓몬 전원의 (불꽃)·(번개) 에너지 수 × 50
      0: (s, c, db) => hit(s, c, 50 * field(s.players[c.p]).flatMap(([, m]) => m.energy).filter(id => ['불꽃', '번개'].includes(db.get(id).energyType)).length, db),
    },
  },
  [N(59)]: { // 토네로스 스크루다이브
    attacks: {
      0: (s, c, db) => {
        hit(s, c, 70, db);
        const P = s.players[c.p];
        if (P.hand.length < 6 && P.deck.length) s.pending = { player: c.p, kind: 'drawTo6' };
      },
    },
  },
  [N(60)]: { attacks: { 0: (s, c, db) => { if (coin(s, c.p, '허찌르기')) hit(s, c, 30, db); else log(s, c.p, '기술 실패'); } } }, // 화살꼬빈
  [N(61)]: { attacks: { 0: (s, c, db) => { hit(s, c, 40, db); if (affects(s, c.D)) setFx(c.D, 'noRetreat', s.turn + 1); } } }, // 불화살빈 꽉쥐기
  [N(62)]: { // 파이어로 ex
    fromHand: { // 익사이팅 다이브: 자신의 필드에 (무색) 메가진화 ex가 있으면 패에서 벤치로 (용암동굴과 무관)
      canUse: (s, p, db) => s.players[p].bench.length < BENCH_MAX &&
        field(s.players[p]).some(([, m]) => db.get(topId(m)).type === '무색' && db.get(topId(m)).rule === '메가진화 ex'),
    },
    attacks: { 0: (s, c, db) => { hit(s, c, 150, db); pick(s, c.p, 'any', 2); } },
  },
};

// 상대 배틀 포켓몬에게 특수 상태 (고속이동 보호·버블 물 에너지면 안 걸림)
function condition(s, c, kind, db, poisonCounters) {
  if (affects(s, c.D) && addCondition(s, c.D, kind, db, poisonCounters)) {
    log(s, c.p, `${nameOf(db, c.D)} ${{ poison: '독', burn: '화상', asleep: '잠듦', paralyzed: '마비', confused: '혼란' }[kind]}`);
  }
}

// 그 밖에 기술을 쓸 수 없는 경우 (카드 특성·기술 조건)
export function attackUsable(s, p, m, index, db) {
  const P = s.players[p];
  const card = db.get(topId(m));
  // 메가골루그 ex 「기동 제한」: 패 10장 이상일 때만 (도구 기술도 포함)
  if (topId(m) === N(33) && abilityOn(s, m, db) && P.hand.length < 10) return false;
  // 기라티나 카오스크롤러: 자신의 이전 차례에 자신의 포켓몬이 카오스크롤러를 썼다면 불가
  const atk = card.attacks[index];
  if (atk?.name === '카오스크롤러' && P.lastAttack?.name === '카오스크롤러' && P.lastAttack.turn === s.turn - 2) return false;
  return true;
}

// ---------- 늘 작동하는 특성 ----------

const FORCES = ['토네로스', '볼트로스', '랜드로스', '러브로스'];

// 기술 비용. 「화신 단결」(토네로스·볼트로스·랜드로스·러브로스): 4종이 모두 자신의 필드에 있으면 (무색) 에너지가 필요 없다
export function attackCost(s, p, m, atk, db) {
  if (db.get(topId(m)).ability?.name === '화신 단결' && abilityOn(s, m, db)) {
    const names = field(s.players[p]).map(([, x]) => nameOf(db, x));
    if (FORCES.every(n => names.includes(n))) return atk.cost.filter(t => t !== '무색');
  }
  return atk.cost;
}

// 후퇴 비용. 꼬시레 「저자세」: 상대 필드에 포켓몬 ex(메가진화 ex 포함)가 있으면 0
// 파비코리 「코튼 캐리」: 파비코리가 있는 한 자신의 기본 포켓몬은 0
export function retreatCost(s, p, m, db) {
  if (topId(m) === N(8) && abilityOn(s, m, db) && field(s.players[opp(p)]).some(([, x]) => db.get(topId(x)).rule)) return 0;
  if (db.get(topId(m)).stage === '기본' && field(s.players[p]).some(([, x]) => topId(x) === N(56) && abilityOn(s, x, db))) return 0;
  return db.get(topId(m)).retreat;
}

export const firstTurnOK = (m, index) => POKEMON[topId(m)]?.firstTurn?.includes(index) ?? false;

// ---------- 효과 중간의 선택 요청 ----------

const bothSides = (s, p) => [-1, ...s.players[opp(p)].bench.keys()].map(to => ({ type: 'choose', to }));
const benchOf = P => [...P.bench.keys()].map(to => ({ type: 'choose', to }));
// 덱 위 n장(카드는 덱에 그대로 둔 채)에서 고른 카드를 꺼낸다
function takeFromTop(P, pd, id) {
  P.deck.splice(P.deck.indexOf(id), 1);
  pd.n -= 1;
  return id;
}

export const PENDING = {
  // 밤선인 직격탄·모토마 브레이크스루: 상대 포켓몬 1마리 골라 데미지 (배틀 포켓몬만 약점·저항력)
  snipe: {
    options: (s, pd) => (pd.benchOnly ? benchOf(s.players[opp(pd.player)]) : bothSides(s, pd.player)),
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
  // 깜까미 속여꾀어내기: 공개한 상대 덱 위 n장 중 기본 포켓몬을 원하는 만큼 상대 벤치로, 남은 카드는 섞는다
  lure: {
    options(s, pd, db) {
      const O = s.players[opp(pd.player)];
      const basics = O.bench.length < BENCH_MAX ? [...new Set(O.deck.slice(0, pd.n))].filter(id => db.get(id).category === '포켓몬' && db.get(id).stage === '기본') : [];
      return [...basics.map(id => ({ type: 'choose', id })), { type: 'done' }];
    },
    resolve(s, pd, a, db) {
      const O = s.players[opp(pd.player)];
      if (a.type === 'choose') {
        O.bench.push(newMon(takeFromTop(O, pd, a.id), s.turn));
        log(s, pd.player, `상대 벤치로: ${db.get(a.id).name}`);
        if (PENDING.lure.options(s, pd, db).length > 1) return;
      }
      O.deck = shuffle(s.rng, O.deck);
      s.pending = null;
    },
  },
  // 깜까미 불길한눈: 상대 포켓몬 1마리에게 데미지 카운터 (데미지가 아니라 약점·저항력·반격가시·산정 없음)
  counters: {
    options: (s, pd) => bothSides(s, pd.player),
    resolve(s, pd, a, db) {
      const m = monAt(s.players[opp(pd.player)], a.to);
      if (affects(s, m)) {
        m.damage += pd.amount;
        log(s, pd.player, `${nameOf(db, m)}에게 데미지 카운터 ${pd.amount / 10}개`);
      } else log(s, pd.player, `${nameOf(db, m)}은(는) 기술의 효과를 받지 않음`);
      s.pending = null;
    },
  },
  // 크리만 끌어내기: 상대 벤치 포켓몬을 배틀로 끌어내고 40
  dragOut: {
    options: (s, pd) => benchOf(s.players[opp(pd.player)]),
    resolve(s, pd, a, db) {
      const O = s.players[opp(pd.player)];
      switchActive(O, a.to);
      log(s, pd.player, `상대의 ${nameOf(db, O.active)}을(를) 배틀 포켓몬으로 끌어냄`);
      dealDamage(s, pd.player, -1, 40, db);
      s.pending = null;
    },
  },
  // 루리리 깡충깡충차지: 덱에서 에너지 1장을 벤치 포켓몬에게
  chargeBench: {
    options(s, pd, db) {
      const P = s.players[pd.player];
      const energies = [...new Set(P.deck)].filter(id => db.get(id).category.endsWith('에너지'));
      return [...energies.flatMap(id => [...P.bench.keys()].map(to => ({ type: 'choose', id, to }))), { type: 'done' }];
    },
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      if (a.type === 'choose') {
        P.bench[a.to].energy.push(take(P.deck, a.id));
        log(s, pd.player, `덱에서 ${nameOf(db, P.bench[a.to])}에게 ${db.get(a.id).name}`);
      }
      P.deck = shuffle(s.rng, P.deck);
      s.pending = null;
    },
  },
  // 파비코 들뜸: 이 포켓몬을 벤치 포켓몬과 교체
  selfSwitch: {
    options: (s, pd) => benchOf(s.players[pd.player]),
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      switchActive(P, a.to);
      log(s, pd.player, `${nameOf(db, P.active)}을(를) 배틀 포켓몬으로`);
      s.pending = null;
    },
  },
  // 켈리몬 컬러풀휩: 패의 포켓몬을 보여주고 타입 수 × 30 (보여줄 타입 수를 고른다)
  colorful: {
    options(s, pd, db) {
      const types = new Set(s.players[pd.player].hand.map(id => db.get(id)).filter(c => c.category === '포켓몬').map(c => c.type));
      return Array.from({ length: types.size + 1 }, (_, n) => ({ type: 'choose', n }));
    },
    resolve(s, pd, a, db) {
      const shown = [];
      for (const id of s.players[pd.player].hand) {
        const c = db.get(id);
        if (shown.length < a.n && c.category === '포켓몬' && !shown.some(x => x.type === c.type)) shown.push(c);
      }
      if (shown.length) log(s, pd.player, `패에서 보여줌: ${shown.map(c => c.name).join(', ')}`);
      dealDamage(s, pd.player, -1, 30 * a.n, db);
      s.pending = null;
    },
  },
  // 토네로스 스크루다이브: 원하면 패가 6장이 되도록 뽑기
  drawTo6: {
    options: (s, pd) => [{ type: 'choose', n: 6 - s.players[pd.player].hand.length }, { type: 'done' }],
    resolve(s, pd, a) {
      if (a.type === 'choose') log(s, pd.player, `덱에서 ${draw(s.players[pd.player], a.n).length}장 뽑음`);
      s.pending = null;
    },
  },
  // 짜랑고우거 스케일 비트: 덱 위 n장 중 기본 에너지를 원하는 만큼 (드래곤) 포켓몬에게, 남은 카드는 섞는다
  scaleBeat: {
    options(s, pd, db) {
      const P = s.players[pd.player];
      const targets = field(P).filter(([, m]) => db.get(topId(m)).type === '드래곤').map(([to]) => to);
      const energies = [...new Set(P.deck.slice(0, pd.n))].filter(id => db.get(id).category === '기본 에너지');
      return [...energies.flatMap(id => targets.map(to => ({ type: 'choose', id, to }))), { type: 'done' }];
    },
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      if (a.type === 'choose') {
        monAt(P, a.to).energy.push(takeFromTop(P, pd, a.id));
        log(s, pd.player, `스케일 비트: ${nameOf(db, monAt(P, a.to))}에게 ${db.get(a.id).name}`);
        if (PENDING.scaleBeat.options(s, pd, db).length > 1) return;
      }
      P.deck = shuffle(s.rng, P.deck);
      s.pending = null;
    },
  },
  // 메가레쿠쟈 ex 패왕의 포효: 쓸지 먼저 고른 뒤(쓰기 전에는 덱을 보지 않는다), 덱 위 4장에서 기본 에너지 1장을 이 포켓몬에게
  roarAsk: {
    options: () => [{ type: 'choose', use: true }, { type: 'done' }],
    resolve(s, pd, a) {
      s.pending = a.type === 'choose' ? { player: pd.player, kind: 'roar', to: pd.to, n: Math.min(4, s.players[pd.player].deck.length) } : null;
    },
  },
  roar: {
    options(s, pd, db) {
      const energies = [...new Set(s.players[pd.player].deck.slice(0, pd.n))].filter(id => db.get(id).category === '기본 에너지');
      return [...energies.map(id => ({ type: 'choose', id })), { type: 'done' }];
    },
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      if (a.type === 'choose') {
        P.bench[pd.to].energy.push(takeFromTop(P, pd, a.id));
        log(s, pd.player, `패왕의 포효: ${nameOf(db, P.bench[pd.to])}에게 ${db.get(a.id).name}`);
      }
      // 남은 카드는 뒷면으로 섞어 덱 아래로
      const rest = P.deck.splice(0, pd.n);
      P.deck.push(...shuffle(s.rng, rest));
      s.pending = null;
    },
  },
};
