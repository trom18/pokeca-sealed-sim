// 트레이너스 효과 (M4). 카드 원문: data/cards.json
// 판정 근거: docs/RESEARCH.md 「트레이너스·특수 에너지 Q&A」
//  - 효과를 하나도 처리할 수 없으면 쓸 수 없다(canPlay).
//  - 덱에서 찾는 효과는 적힌 장수보다 적게(0장도) 고를 수 있다.
// 스타디움·특수 에너지·특별주문조끼처럼 늘 켜져 있는 효과는 core.js·damage.js에 있다.
import { shuffle } from '../rng.js';
import { ID, BENCH_MAX, opp, draw, log, flip, coinText, take, field, monAt, heal, switchActive, stadiumName, topId, newMon, evolveMon } from '../core.js';

const nameOf = (db, m) => db.get(topId(m)).name;
const deckLeft = (s, p) => s.players[p].deck.length > 0;

// 덱에서 찾기 조건 (c = 카드, pd = 선택 요청)
const FILTERS = {
  lantern: (c, pd) => c.category === '기본 에너지' && ['불꽃', '번개'].includes(c.energyType) && !pd.picked.includes(c.no),
  supportOrStadium: c => c.category === '서포트' || c.category === '스타디움',
  noRulePokemon: c => c.category === '포켓몬' && !c.rule,
  name: (c, pd) => c.category === '포켓몬' && c.name === pd.arg,
  basicPokemon: c => c.category === '포켓몬' && c.stage === '기본',
  basicEnergy: c => c.category === '기본 에너지',
  energy: c => c.category.endsWith('에너지'),
  pokemon: c => c.category === '포켓몬',
  any: () => true,
  evolvesFrom: (c, pd) => c.category === '포켓몬' && c.evolvesFrom === pd.arg,
};
// 덱에서 찾기 시작. dest: 'hand' 패로(공개) / 'bench' 벤치로 / 'attach' to 자리의 포켓몬에게 붙임 / 'evolve' to 자리의 포켓몬을 진화
export function pick(s, p, filter, max, { dest = 'hand', arg, to } = {}) {
  s.pending = { player: p, kind: 'pick', filter, max, picked: [], dest, arg, to };
}
const drawLog = (s, p, n) => log(s, p, `덱에서 ${draw(s.players[p], n).length}장 뽑음`);

// 카드 번호 → { canPlay(s, p), play(s, p, db) } / 도구 기술은 attack(s, p, db)
export const TRAINERS = {
  [ID.주먹밥]: {
    canPlay: (s, p) => s.players[p].active.damage > 0,
    play(s, p, db) {
      const P = s.players[p];
      const others = P.discard.filter(id => id === ID.주먹밥).length - 1; // 방금 트래쉬한 이 카드는 빼고 센다
      log(s, p, `${nameOf(db, P.active)} HP ${heal(s, P.active, 30 * (1 + others), db)} 회복`);
    },
  },
  [ID.랜턴]: { canPlay: deckLeft, play: (s, p) => pick(s, p, 'lantern', 2) },
  [ID.포켓패드]: { canPlay: deckLeft, play: (s, p) => pick(s, p, 'noRulePokemon', 1) },
  [ID.캐처]: {
    canPlay: (s, p) => s.players[opp(p)].bench.length > 0,
    play(s, p) {
      const heads = flip(s);
      log(s, p, `포켓몬 캐처: 동전 ${coinText(heads)}`);
      if (heads) s.pending = { player: p, kind: 'catch' };
    },
  },
  [ID.MC]: { canPlay: deckLeft, play: (s, p) => drawLog(s, p, s.players[opp(p)].prizes.length <= 3 ? 4 : 2) },
  [ID.성한]: { canPlay: deckLeft, play: (s, p) => pick(s, p, 'supportOrStadium', 3) },
  [ID.풍란]: {
    canPlay: deckLeft,
    play(s, p, db) {
      drawLog(s, p, 2);
      if (stadiumName(s, db)?.includes('전설')) {
        const P = s.players[p];
        P.hand.push(take(P.discard, ID.풍란));
        log(s, p, '전설 스타디움이 있어 풍&란의 수행을 패로 되돌림');
      }
    },
  },
  [ID.피아나]: { canPlay: (s, p) => s.players[p].bench.length > 0, play: (s, p) => { s.pending = { player: p, kind: 'switchOwn' }; } },
  [ID.가이]: { canPlay: deckLeft, play: (s, p) => drawLog(s, p, 3) },
  // 메가레쿠쟈캡의 기술 「델타기프트」: 캡이 붙은 자신의 포켓몬 전원에게 덱에서 기본 에너지를 1장씩
  [ID.캡]: {
    attack(s, c) {
      const targets = field(s.players[c.p]).filter(([, m]) => m.tool === ID.캡).map(([to]) => to);
      s.pending = { player: c.p, kind: 'deltaGift', targets };
    },
  },
};

const basicsInDeck = (s, p, db) => [...new Set(s.players[p].deck)].filter(id => db.get(id).category === '기본 에너지');
const candidates = (s, pd, db) => {
  if (pd.dest === 'bench' && s.players[pd.player].bench.length >= BENCH_MAX) return [];
  return [...new Set(s.players[pd.player].deck)].filter(id => FILTERS[pd.filter](db.get(id), pd));
};
const DEST_TEXT = { hand: '덱에서 찾아 공개하고 패로', bench: '덱에서 벤치로', attach: '덱에서 붙임', evolve: '덱에서 찾아 진화' };

function finishSearch(s, pd, db) {
  s.players[pd.player].deck = shuffle(s.rng, s.players[pd.player].deck);
  log(s, pd.player, pd.picked.length ? `${DEST_TEXT[pd.dest ?? 'hand']}: ${pd.picked.map(id => db.get(id).name).join(', ')}` : '덱에서 찾은 카드 없음');
  s.pending = null;
}

// 효과 중간의 선택 요청: options(s, pd, db) 선택지 / resolve(s, pd, action, db) 처리
export const PENDING = {
  pick: {
    options: (s, pd, db) => [...candidates(s, pd, db).map(id => ({ type: 'choose', id })), { type: 'done' }],
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      if (a.type === 'choose') {
        const id = take(P.deck, a.id);
        if (pd.dest === 'bench') P.bench.push(newMon(id, s.turn));
        else if (pd.dest === 'attach') monAt(P, pd.to).energy.push(id);
        else if (pd.dest === 'evolve') evolveMon(monAt(P, pd.to), id, s.turn);
        else P.hand.push(id);
        pd.picked.push(a.id);
      }
      if (a.type === 'done' || pd.picked.length >= pd.max || !candidates(s, pd, db).length) finishSearch(s, pd, db);
    },
  },
  deltaGift: {
    options: (s, pd, db) => [...basicsInDeck(s, pd.player, db).map(id => ({ type: 'choose', id })), { type: 'done' }],
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      const to = pd.targets.shift();
      if (a.type === 'choose') {
        monAt(P, to).energy.push(take(P.deck, a.id));
        log(s, pd.player, `델타기프트: ${nameOf(db, monAt(P, to))}에게 ${db.get(a.id).name}`);
      }
      if (!pd.targets.length) {
        P.deck = shuffle(s.rng, P.deck);
        s.pending = null;
      }
    },
  },
  switchOwn: {
    options: (s, pd) => s.players[pd.player].bench.map((_, to) => ({ type: 'choose', to })),
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      switchActive(P, a.to);
      log(s, pd.player, `${nameOf(db, P.bench[a.to])} ↔ ${nameOf(db, P.active)} 교체`);
      // 피아나의 신뢰: 벤치로 간 포켓몬의 에너지 1개를 반드시 새 배틀 포켓몬에게
      s.pending = P.bench[a.to].energy.length ? { player: pd.player, kind: 'moveEnergy', from: a.to } : null;
    },
  },
  moveEnergy: {
    options: (s, pd) => [...new Set(s.players[pd.player].bench[pd.from].energy)].map(id => ({ type: 'choose', id })),
    resolve(s, pd, a, db) {
      const P = s.players[pd.player];
      P.active.energy.push(take(P.bench[pd.from].energy, a.id));
      log(s, pd.player, `${db.get(a.id).name}을(를) ${nameOf(db, P.active)}에게 옮김`);
      s.pending = null;
    },
  },
  catch: {
    options: (s, pd) => s.players[opp(pd.player)].bench.map((_, to) => ({ type: 'choose', to })),
    resolve(s, pd, a, db) {
      const O = s.players[opp(pd.player)];
      switchActive(O, a.to);
      log(s, pd.player, `상대의 ${nameOf(db, O.active)}을(를) 배틀 포켓몬으로 끌어냄`);
      s.pending = null;
    },
  },
};
