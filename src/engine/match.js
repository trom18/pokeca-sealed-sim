// 매치: 3판 2선승. 상태는 평범한 데이터(저장·복원 가능). 플레이어 0 = 사람, 1 = 컴퓨터.
// 첫 판·서든데스는 가위바위보 승자가, 2·3판은 직전 판에서 진 쪽이 선공·후공을 고른다(배틀규정 10쪽).
// 무승부(동시에 같은 수의 승리 조건)는 서든데스(프라이즈 6장, 1장 먼저 가져가면 승리)로 그 판의 승패를 정한다(배틀규정 8쪽).
import { makeRng, randInt } from './rng.js';
import { newGame } from './game.js';

export const HANDS = ['가위', '바위', '보'];
const BEATS = { 가위: '보', 바위: '가위', 보: '바위' };

export function newMatch({ decks, seed }) {
  return { decks, rng: makeRng(seed), wins: [0, 0], history: [], step: 'rps', rps: null, chooser: null, suddenDeath: false, game: null, winner: null };
}

// hands = [0의 손, 1의 손]
export function playRps(match, hands) {
  const m = structuredClone(match);
  const [a, b] = hands;
  const winner = a === b ? null : BEATS[a] === b ? 0 : 1;
  m.rps = { hands, winner };
  if (winner !== null) {
    m.step = 'order';
    m.chooser = winner;
  }
  return m;
}

// chooser가 선공(goFirst)인지 후공인지 골랐다 → 새 판 시작
export function chooseOrder(match, goFirst, db) {
  const m = structuredClone(match);
  const first = goFirst ? m.chooser : 1 - m.chooser;
  const extra = m.suddenDeath ? { prizeCount: 6, suddenDeath: true } : {};
  m.game = newGame({ decks: m.decks, first, seed: randInt(m.rng, 2 ** 32), db, ...extra });
  m.step = 'game';
  return m;
}

// 지금 판이 끝났을 때 호출: 결과 기록 → 서든데스 / 다음 판 / 매치 끝
export function finishGame(match) {
  const m = structuredClone(match);
  const g = m.game;
  m.history.push({ winner: g.winner, reason: g.reason, first: g.first, suddenDeath: m.suddenDeath });
  m.game = null;
  m.rps = null;
  if (g.winner === 'draw') {
    m.suddenDeath = true;
    m.step = 'rps';
    return m;
  }
  m.suddenDeath = false;
  m.wins[g.winner]++;
  if (m.wins[g.winner] === 2) {
    m.step = 'over';
    m.winner = g.winner;
  } else {
    m.step = 'order';
    m.chooser = 1 - g.winner;
  }
  return m;
}
