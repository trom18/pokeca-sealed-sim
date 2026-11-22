// 화면 시작점: 데이터 읽기, 중간 저장, 화면 전환, 처음 화면
import { indexCards } from '../engine/cards.js';
import { makeRng } from '../engine/rng.js';
import { openPacks } from '../engine/packs.js';
import { poolCounts } from '../engine/deck.js';
import { newMatch } from '../engine/match.js';
import { autoBuild, smartBuild } from '../ai/deckbuild.js';
import { showDetail } from './card.js';
import * as poolUi from './pool.js';
import * as battleUi from './battle.js';

const SAVE_KEY = 'pokeca-sealed-save';
const SAVE_VERSION = 1; // 저장 형식이 바뀌면 올린다(옛 저장은 무시)
const LEVELS = { 하수: '무작위로 둠', 중수: '정해진 규칙대로', 고수: '수를 미리 계산' };

const app = document.getElementById('app');
const [data, rates, ratings] = await Promise.all(['data/cards.json', 'data/pack_rates.json', 'data/ratings.json'].map(u => fetch(u).then(r => r.json())));
const ctx = { data, rates, ratings, db: indexCards(data), S: loadSave() ?? { v: SAVE_VERSION, screen: 'title', level: '하수' }, update };

function loadSave() {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  return s?.v === SAVE_VERSION ? s : null;
}

const save = () => localStorage.setItem(SAVE_KEY, JSON.stringify(ctx.S));
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

// 바뀔 때마다 바로 저장 → 다른 앱에 갔다 와서 페이지가 새로 열려도 그 자리에서 이어진다
function update() {
  save();
  render();
}

let shown = null;
function render() {
  app.innerHTML = screens[ctx.S.screen](ctx);
  if (shown !== ctx.S.screen) {
    shown = ctx.S.screen;
    window.scrollTo(0, 0);
  }
  battleUi.afterRender(ctx);
}

function title({ S }) {
  return '<h1>스톰에메랄다 실드전</h1>' +
    (S.mode ? '<button class="btn" data-act="resume">이어하기</button>' : '') +
    '<h3>컴퓨터 수준</h3><div class="seg">' +
    Object.entries(LEVELS).map(([l, info]) =>
      `<button class="${S.level === l ? 'on' : ''}" data-act="level" data-arg="${l}">${l}<small>${info}</small></button>`).join('') +
    '</div>' +
    '<button class="btn" data-act="sealed">정식 모드<small>15팩 개봉 → 카드 확인 → 40장 덱 → 3판 2선승</small></button>' +
    '<button class="btn" data-act="quick">빠른 시작<small>양쪽 덱을 무작위로 자동 구성 → 바로 3판 2선승</small></button>';
}

// 새 게임: 양쪽 15팩 개봉, 컴퓨터는 자기 수준에 맞게 덱을 짠다(하수는 단순하게, 중수·고수는 공략 별점으로).
// 빠른 시작은 내 덱도 자동 구성(별점 방식)으로 짜고 바로 매치로.
function newSession(ctx, mode) {
  if (ctx.S.mode && !confirm('진행 중인 게임이 지워집니다. 새로 시작할까요?')) return;
  const seed = newSeed();
  const rng = makeRng(seed);
  const packs = openPacks(rng, data, rates);
  const cpuPacks = openPacks(rng, data, rates);
  const cpuPool = poolCounts(cpuPacks, data);
  const cpu = { packs: cpuPacks, deck: ctx.S.level === '하수' ? autoBuild(cpuPool, ctx.db) : smartBuild(cpuPool, ctx.db, ratings) };
  ctx.S = { v: SAVE_VERSION, level: ctx.S.level, mode, seed, screen: 'open', packs, opened: 0, deck: {}, cpu };
  if (mode === 'quick') {
    const deck = smartBuild(poolCounts(packs, data), ctx.db, ratings);
    Object.assign(ctx.S, { screen: 'match', opened: packs.length, deck, match: newMatch({ decks: [deck, cpu.deck], seed: newSeed() }) });
  }
  ctx.update();
}

const titleActions = {
  level: (ctx, level) => { ctx.S.level = level; ctx.update(); },
  resume: ctx => { ctx.S.screen = ctx.S.back; ctx.update(); },
  home: ctx => { ctx.S.back = ctx.S.screen; ctx.S.screen = 'title'; ctx.update(); },
  sealed: ctx => newSession(ctx, 'sealed'),
  quick: ctx => newSession(ctx, 'quick'),
};

const screens = { title, ...poolUi.screens, ...battleUi.screens };
const actions = { ...titleActions, ...poolUi.actions, ...battleUi.actions, detail: (ctx, id) => showDetail(ctx.db.get(id)) };

// 버튼은 data-act(할 일)와 data-arg(대상)로 처리. 아래에서 올라온 창 안의 버튼이면 창을 닫고 실행.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  el.closest('.sheet-bg')?.remove();
  actions[el.dataset.act](ctx, el.dataset.arg);
});

// 다른 앱으로 갈 때 스크롤 위치도 저장해 두고, 다시 열 때 그 위치로
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    ctx.S.scrollY = window.scrollY;
    save();
  }
});
render();
if (ctx.S.scrollY) window.scrollTo(0, ctx.S.scrollY);
