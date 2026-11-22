// 카드 그리기 (이미지 없이 이름·타입 색·HP·기술 글자). 목록 한 줄과 아래에서 올라오는 상세 창.
export const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// 카드 색을 정하는 타입: 포켓몬은 타입, 에너지는 에너지 타입, 트레이너스는 회색
export const colorOf = c => (c.category === '포켓몬' ? c.type : c.energyType ?? '트레이너스');

const side = c => (c.no.includes('좌측') ? ' (좌)' : c.no.includes('우측') ? ' (우)' : '');

// 목록 한 줄의 왼쪽(이름 + 짧은 정보)
export function cardLine(c) {
  const info = c.category === '포켓몬' ? `${c.stage} · HP${c.hp}${c.rule ? ' · ' + c.rule : ''}` : c.category;
  return `<span class="nm">${esc(c.name + side(c))}</span>` +
    `<small>${esc(info)}${c.implemented ? '' : ' · <b class="todo">효과 미구현</b>'}</small>`;
}

const costHtml = cost => cost.length
  ? cost.map(t => `<i class="dot" data-type="${esc(t)}">${esc(t[0])}</i>`).join('')
  : '<i class="dot">0</i>';

const attackHtml = a =>
  `<p><span class="cost">${costHtml(a.cost)}</span> <b>${esc(a.name)}</b> <b class="dmg">${esc(a.damage ?? '')}</b>` +
  (a.text ? `<br>${esc(a.text)}` : '') + '</p>';

export function detailHtml(c) {
  const h = [`<h2>${esc(c.name + side(c))}</h2>`];
  if (c.category === '포켓몬') {
    h.push(`<p>${esc(c.type)} 타입 · ${esc(c.stage)}${c.evolvesFrom ? ` (${esc(c.evolvesFrom)}에서 진화)` : ''} · HP ${c.hp}` +
      `${c.rule ? ' · ' + esc(c.rule) : ''}</p>`);
    if (c.ability) h.push(`<p><b>특성 「${esc(c.ability.name)}」</b><br>${esc(c.ability.text)}</p>`);
    for (const a of c.attacks) h.push(attackHtml(a));
    const wr = x => (x ? esc(`${x.type} ${x.value}`) : '없음');
    h.push(`<p class="muted">약점 ${wr(c.weakness)} · 저항력 ${wr(c.resistance)} · 후퇴 ${c.retreat}</p>`);
  } else if (c.category === '기본 에너지') {
    h.push('<p>기본 에너지 · 덱에 몇 장이든 넣을 수 있습니다.</p>');
  } else {
    h.push(`<p class="muted">${esc(c.category)}</p><p>${esc(c.effect)}</p>`);
    for (const a of c.attacks ?? []) h.push(attackHtml(a));
    if (c.pairRule) h.push(`<p class="muted">${esc(c.pairRule)}</p>`);
    for (const r of c.rulesText ?? []) h.push(`<p class="muted">${esc(r)}</p>`);
  }
  if (!c.implemented) h.push('<p class="todo">이 카드 효과는 아직 대전에서 동작하지 않습니다.</p>');
  if (c.category !== '기본 에너지') h.push(`<p class="muted">카드 번호 ${esc(c.no)}${c.rarity ? ' · ' + esc(c.rarity) : ''}</p>`);
  return h.join('');
}

// 아래에서 올라오는 창. 바깥이나 닫기를 누르면 닫힌다. 안의 행동 버튼(data-act)은 main.js가 처리하고 창을 닫는다.
export function showSheet(html, type) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" data-type="${esc(type)}">${html}<button class="btn sub" data-close>닫기</button></div>`;
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.hasAttribute('data-close')) bg.remove();
  });
  document.body.append(bg);
}

export const showDetail = c => showSheet(detailHtml(c), colorOf(c));
