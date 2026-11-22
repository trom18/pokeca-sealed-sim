// 팩 개봉 → 카드 확인 → 덱 구성 → 덱 완성 화면
import { cardLine, colorOf, esc } from './card.js';
import { BASIC_ENERGY_TYPES, basicEnergyId } from '../engine/cards.js';
import { poolCounts, deckProblems, deckSize, unimplemented } from '../engine/deck.js';
import { newMatch } from '../engine/match.js';
import { autoBuild } from '../ai/deckbuild.js';

const RARITIES = ['C', 'U', 'R', 'RR', 'AR', 'SR', 'SAR', 'MUR'];
const SECRET = ['AR', 'SR', 'SAR', 'MUR'];
const GROUPS = [
  ['포켓몬', c => c.category === '포켓몬'],
  ['트레이너스', c => !['포켓몬', '특수 에너지', '기본 에너지'].includes(c.category)],
  ['특수 에너지', c => c.category === '특수 에너지'],
];

const top = title => `<header class="top"><button class="link" data-act="home">처음 화면</button><b>${title}</b></header>`;
const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
const rarBadge = r => `<span class="rar${SECRET.includes(r) ? ' secret' : ''}">${r}</span>`;
// 카드 한 줄: 왼쪽을 누르면 상세 창, 오른쪽은 화면마다 다름
const row = (c, right) => `<div class="row" data-type="${esc(colorOf(c))}">` +
  `<button class="info" data-act="detail" data-arg="${esc(c.no)}">${cardLine(c)}</button>${right}</div>`;

// 가진 카드를 포켓몬 / 트레이너스 / 특수 에너지로 묶어 카드 번호 순서로
function grouped(ctx, pool, right) {
  const owned = [...ctx.db.values()].filter(c => pool[c.no]);
  return GROUPS.map(([title, isIn]) => {
    const list = owned.filter(isIn);
    if (!list.length) return '';
    return `<h3>${title} ${list.reduce((s, c) => s + pool[c.no], 0)}장</h3>` + list.map(c => row(c, right(c))).join('');
  }).join('');
}

function ratesNote(rates) {
  const slots = Object.entries(rates.perPack).map(([r, k]) => `${r} ${k}장`).join(' + ');
  const rare = Object.entries(rates.rareSlot).map(([r, p]) => `${r} ${p}%`).join(' · ');
  return `<p class="note">배출률은 공식 비공개라 <b>가정값</b>입니다. 1팩 = ${slots} + 레어 칸 1장 (${rare})</p>`;
}

export const screens = {
  open(ctx) {
    const { S, db } = ctx;
    const last = S.packs[S.opened - 1];
    const done = S.opened === S.packs.length;
    return top('팩 개봉') +
      `<p class="big">${S.opened} / ${S.packs.length} 팩</p>` +
      (last ? last.map(p => row(db.get(p.id), rarBadge(p.rarity))).join('') : '<p>버튼을 눌러 팩을 여세요.</p>') +
      (done ? btn('toPool', '카드 확인하러 가기') : btn('openOne', '팩 열기') + btn('openAll', '남은 팩 모두 열기', 'sub')) +
      ratesNote(ctx.rates);
  },

  pool(ctx) {
    const pulls = ctx.S.packs.flat();
    const pool = poolCounts(ctx.S.packs, ctx.data);
    const n = r => pulls.filter(p => p.rarity === r).length;
    const secretsOf = id => pulls.filter(p => p.id === id && SECRET.includes(p.rarity)).map(p => rarBadge(p.rarity)).join(' ');
    return top('카드 확인') +
      `<p>개봉 ${pulls.length}장 + 지급 2장(가이·포켓패드)</p>` +
      `<p class="muted">${RARITIES.filter(n).map(r => `${r} ${n(r)}`).join(' · ')}</p>` +
      `<p class="muted">카드를 누르면 전체 효과를 볼 수 있습니다.</p>` +
      grouped(ctx, pool, c => `<span class="right">${secretsOf(c.no)} ×${pool[c.no]}</span>`) +
      btn('toDeck', '덱 만들기');
  },

  deck(ctx) {
    const { S, db } = ctx;
    const pool = poolCounts(S.packs, ctx.data);
    const n = deckSize(S.deck);
    const problems = deckProblems(S.deck, pool, db);
    const todo = unimplemented(S.deck, db);
    const sums = [0, 0, 0]; // 포켓몬, 트레이너스, 에너지
    for (const [id, k] of Object.entries(S.deck)) {
      const c = db.get(id);
      sums[c.category === '포켓몬' ? 0 : c.category.endsWith('에너지') ? 2 : 1] += k;
    }
    // max가 없으면 무제한(기본 에너지)
    const counter = (c, max) => {
      const k = S.deck[c.no] ?? 0;
      return `<span class="cnt"><button data-act="sub" data-arg="${esc(c.no)}"${k ? '' : ' disabled'}>−</button>` +
        `<b>${k}</b><small>/${max ?? '∞'}</small>` +
        `<button data-act="add" data-arg="${esc(c.no)}"${max !== undefined && k >= max ? ' disabled' : ''}>+</button></span>`;
    };
    return top('덱 구성') +
      `<div class="sum"><b class="${n === 40 ? 'ok' : 'bad'}">${n} / 40장</b>` +
      `<small>포켓몬 ${sums[0]} · 트레이너스 ${sums[1]} · 에너지 ${sums[2]}</small>` +
      `<div class="row2">${btn('auto', '자동 구성', 'sub')}${btn('clear', '비우기', 'sub')}</div></div>` +
      (problems.length ? `<ul class="bad">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="ok">덱 규칙을 모두 지켰습니다.</p>') +
      (todo.length ? `<p class="warn">효과가 아직 구현되지 않은 카드 ${todo.length}종이 덱에 있습니다 (대전에서 효과 없이 동작): ${esc(todo.join(', '))}</p>` : '') +
      grouped(ctx, pool, c => counter(c, pool[c.no])) +
      '<h3>기본 에너지 (무제한)</h3>' +
      BASIC_ENERGY_TYPES.map(t => db.get(basicEnergyId(t))).map(c => row(c, counter(c))).join('') +
      `<button class="btn" data-act="toReady"${problems.length ? ' disabled' : ''}>덱 완성</button>`;
  },

  ready(ctx) {
    return top('덱 완성') +
      '<p class="big">40장 덱 완성!</p>' +
      `<p>컴퓨터(${ctx.S.level})도 15팩을 열고 덱을 만들었습니다. 매치는 3판 2선승이고, 매치 중에는 덱을 바꿀 수 없습니다.</p>` +
      btn('startMatch', '대전 시작') +
      btn('toDeck', '덱 고치기', 'sub');
  },
};

const go = (ctx, screen) => { ctx.S.screen = screen; ctx.update(); };

export const actions = {
  openOne: ctx => { ctx.S.opened++; ctx.update(); },
  openAll: ctx => { ctx.S.opened = ctx.S.packs.length; go(ctx, 'pool'); },
  toPool: ctx => go(ctx, 'pool'),
  toDeck: ctx => go(ctx, 'deck'),
  toReady: ctx => go(ctx, 'ready'),
  startMatch: ctx => {
    ctx.S.match = newMatch({ decks: [ctx.S.deck, ctx.S.cpu.deck], seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    go(ctx, 'match');
  },
  add: (ctx, id) => { ctx.S.deck[id] = (ctx.S.deck[id] ?? 0) + 1; ctx.update(); },
  sub: (ctx, id) => { if (!--ctx.S.deck[id]) delete ctx.S.deck[id]; ctx.update(); },
  auto: ctx => {
    if (deckSize(ctx.S.deck) && !confirm('지금 덱을 지우고 자동으로 만들까요?')) return;
    ctx.S.deck = autoBuild(poolCounts(ctx.S.packs, ctx.data), ctx.db);
    ctx.update();
  },
  clear: ctx => {
    if (!confirm('덱을 모두 비울까요?')) return;
    ctx.S.deck = {};
    ctx.update();
  },
};
