// 데미지 계산. 순서(docs/RESEARCH.md 2절 [KR규칙]):
// ① 기본 데미지(0 이하면 끝) ② 공격 측 효과 ③ 약점 ④ 저항력 ⑤ 받는 측 효과.
// 벤치 포켓몬에게는 약점·저항력을 계산하지 않는다. ②⑤의 포켓몬 효과는 M5~M6에서 더한다.
import { ID } from './core.js';

// 기술 데미지 글자("130", "90+", "50×", 없음)의 숫자 부분
export function baseDamage(attack) {
  const n = parseInt(attack.damage, 10);
  return Number.isNaN(n) ? 0 : n;
}

// attacker·defender는 카드 데이터. toActive = 받는 쪽이 배틀 포켓몬인지. defenderTool = 받는 쪽에 붙은 도구
export function calcDamage(base, attacker, defender, toActive, { defenderTool } = {}) {
  if (base <= 0) return 0;
  let dmg = base;
  if (toActive && defender.weakness?.type === attacker.type) dmg *= Number(defender.weakness.value.slice(1)); // "×2"
  if (toActive && defender.resistance?.type === attacker.type) dmg += Number(defender.resistance.value); // "-30"
  // ⑤ 특별주문조끼: 붙인 포켓몬(메가진화 ex 제외)이 상대 메가진화 ex에게 받는 기술 데미지 −60
  if (defenderTool === ID.조끼 && attacker.rule === '메가진화 ex' && defender.rule !== '메가진화 ex') dmg -= 60;
  return Math.max(0, dmg);
}
