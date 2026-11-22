// 데미지 계산. 순서(docs/RESEARCH.md 2절 [KR규칙]):
// ① 기본 데미지(0 이하면 끝) ② 공격 측 효과 ③ 약점 ④ 저항력 ⑤ 받는 측 효과.
// 벤치 포켓몬에게는 약점·저항력을 계산하지 않는다. ②⑤의 포켓몬 효과는 M5~M6에서 더한다.
import { ID, opp, topId, monAt, log, isProtected, abilityOn } from './core.js';

// 기술 데미지 글자("130", "90+", "50×", 없음)의 숫자 부분
export function baseDamage(attack) {
  const n = parseInt(attack.damage, 10);
  return Number.isNaN(n) ? 0 : n;
}

// attacker·defender는 카드 데이터. toActive = 받는 쪽이 배틀 포켓몬인지. defenderTool = 받는 쪽에 붙은 도구
// ignoreResistance = 저항력 계산 안 함(강철톤 하드스윙). minus = 받는 쪽의 그 밖의 효과로 줄어드는 양
export function calcDamage(base, attacker, defender, toActive, { defenderTool, ignoreResistance = false, minus = 0 } = {}) {
  if (base <= 0) return 0;
  let dmg = base;
  if (toActive && defender.weakness?.type === attacker.type) dmg *= Number(defender.weakness.value.slice(1)); // "×2"
  if (toActive && !ignoreResistance && defender.resistance?.type === attacker.type) dmg += Number(defender.resistance.value); // "-30"
  // ⑤ 특별주문조끼: 붙인 포켓몬(메가진화 ex 제외)이 상대 메가진화 ex에게 받는 기술 데미지 −60
  if (defenderTool === ID.조끼 && attacker.rule === '메가진화 ex' && defender.rule !== '메가진화 ex') dmg -= 60;
  return Math.max(0, dmg - minus);
}

// p의 배틀 포켓몬이 기술로 상대 포켓몬(to: -1 배틀, 0~4 벤치)에게 데미지를 준다.
// ignoreEffects: 「상대의 배틀 포켓몬에게 걸려 있는 효과를 계산하지 않는다」(볼트로스 썬더에지) — 기술 효과·특성·도구로
//   데미지를 줄이거나 막는 것을 모두 무시 (docs/RESEARCH.md 「포켓몬 029~062 Q&A」)
export function dealDamage(s, p, to, base, db, { ignoreEffects = false, ignoreResistance = false } = {}) {
  const A = s.players[p].active;
  const D = monAt(s.players[opp(p)], to);
  const ac = db.get(topId(A));
  const dc = db.get(topId(D));
  // 데미지를 받지 않는 효과: 고속이동(데미지·효과), 카오스크롤러(데미지), 은밀침(기본 포켓몬의 데미지)
  if (!ignoreEffects && (isProtected(s, D) || D.fx?.noDamage === s.turn || (D.fx?.noDamageFromBasic === s.turn && ac.stage === '기본'))) {
    log(s, p, `${dc.name}은(는) 기술의 데미지를 받지 않음`);
    return 0;
  }
  // ⑤ 받는 쪽 효과: 가드프레스·단단한머리 −30, 강철톤 「고밀도아머」(데미지 카운터가 없을 때) −60
  let minus = 0;
  if (!ignoreEffects) {
    if (D.fx?.reduce30 === s.turn) minus += 30;
    if (topId(D) === ID.강철톤 && D.damage === 0 && abilityOn(s, D, db)) minus += 60;
  }
  const dmg = calcDamage(base, ac, dc, to === -1, { defenderTool: ignoreEffects ? null : D.tool, ignoreResistance, minus });
  D.damage += dmg;
  if (dmg > 0) D.attackDamaged = true;
  log(s, p, `${dc.name}에게 ${dmg} 데미지`);
  // 고지 「반격가시」: 배틀필드에서 기술의 데미지를 받으면(기절해도) 기술을 쓴 포켓몬에게 데미지 카운터 3개
  if (to === -1 && dmg > 0 && topId(D) === ID.고지 && abilityOn(s, D, db)) {
    A.damage += 30;
    log(s, opp(p), `반격가시: ${ac.name}에게 데미지 카운터 3개`);
  }
  return dmg;
}
