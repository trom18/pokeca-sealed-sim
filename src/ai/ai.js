// 컴퓨터 행동 선택. 볼 수 있는 정보(view)와 할 수 있는 행동 목록만 받는다(숨은 정보 없음).
// 하수: 무작위. 기술을 쓸 수 있으면 기술 쪽으로, 아니면 차례 끝내기보다 다른 행동 쪽으로 치우친다.
import { random, randInt } from '../engine/rng.js';

const pick = (rng, list) => list[randInt(rng, list.length)];

export function chooseAction(view, actions, rng) {
  const attacks = actions.filter(a => a.type === 'attack');
  if (attacks.length && random(rng) < 0.7) return pick(rng, attacks);
  const others = actions.filter(a => a.type !== 'end' && a.type !== 'attack');
  if (others.length && random(rng) < 0.8) return pick(rng, others);
  return pick(rng, actions);
}
