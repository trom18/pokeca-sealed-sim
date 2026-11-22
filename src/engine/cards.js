// 카드 조회와 판정. 기본 에너지는 cards.json에 없어서 여기서 만든다(무제한 사용).
export const BASIC_ENERGY_TYPES = ['풀', '불꽃', '물', '번개', '초', '격투', '악'];

// 카드 원문 표기를 따른다: "기본 (불꽃) 에너지"
export const basicEnergyId = type => `기본 (${type}) 에너지`;

// 카드 번호(no) → 카드. 기본 에너지 7종도 넣는다.
export function indexCards(data) {
  const db = new Map(data.cards.map(c => [c.no, c]));
  for (const type of BASIC_ENERGY_TYPES) {
    const id = basicEnergyId(type);
    db.set(id, { no: id, name: id, category: '기본 에너지', energyType: type, implemented: true });
  }
  return db;
}

export const isBasicEnergy = c => c.category === '기본 에너지';
export const isBasicPokemon = c => c.category === '포켓몬' && c.stage === '기본';
// 실드전 참가상 가이·포켓패드(프로모 M-P): 모두에게 1장씩 지급
export const isGiven = c => c.no.endsWith('/M-P');
