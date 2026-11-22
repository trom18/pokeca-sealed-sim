// 매치 화면: 가위바위보 → 선후공 → 대전 → 판 결과 → 매치 결과. 플레이어 0 = 나, 1 = 컴퓨터.
// 화면은 viewFor(나)만 보고 그린다 → 컴퓨터의 패·덱·프라이즈는 화면에 나올 수 없다.
import { esc, colorOf, detailHtml, showSheet } from './card.js';
import { legalActions, applyAction, viewFor, actor, attacksOf, maxHp } from '../engine/game.js';
import { HANDS, playRps, chooseOrder, finishGame } from '../engine/match.js';
import { makeRng, randInt } from '../engine/rng.js';
import { chooseAction } from '../ai/ai.js';

const ME = 0;
const CPU = 1;
const CPU_DELAY = 700; // 컴퓨터 행동 사이 간격(ms)
const WHO = ['나', '컴퓨터'];
const COND = { asleep: '잠듦', paralyzed: '마비', confused: '혼란' };
const SEARCH = {
  lantern: () => '덱에서 기본 (불꽃)·(번개) 에너지를 1장씩까지 고르세요',
  supportOrStadium: () => '덱에서 서포트·스타디움을 합계 3장까지 고르세요',
  noRulePokemon: () => '덱에서 포켓몬(룰을 가진 포켓몬 제외)을 1장 고르세요',
  name: pd => `덱에서 「${pd.arg}」를 ${pd.max}장까지 골라 벤치로`,
  basicPokemon: pd => `덱에서 기본 포켓몬을 ${pd.max}장까지 골라 벤치로`,
  basicEnergy: pd => `덱에서 기본 에너지를 ${pd.max}장까지 골라 패로`,
  energy: () => '덱에서 에너지를 1장 골라 이 포켓몬에게 붙이세요',
  pokemon: () => '덱에서 포켓몬을 1장 고르세요',
  any: pd => `덱에서 원하는 카드를 ${pd.max}장까지 고르세요`,
  evolvesFrom: () => '덱에서 진화 카드를 골라 진화시키세요',
};
const FX = { noAttack: '기술 불가', noRetreat: '후퇴 불가', protect: '보호 중', noDamage: '데미지 안 받음', noDamageFromBasic: '기본 포켓몬 데미지 안 받음', reduce30: '받는 데미지 −30' };
const DONE = { deltaGift: '붙이지 않음', deepSea: '되돌리지 않음', roarAsk: '사용하지 않음', roar: '붙이지 않음', chargeBench: '붙이지 않음', drawTo6: '뽑지 않음', lure: '그만 고르기', scaleBeat: '그만 붙이기' };
const OPP_TARGET = ['catch', 'snipe', 'counters', 'dragOut'];
const PROMPT = {
  setupActive: () => '배틀 포켓몬으로 낼 기본 포켓몬을 고르세요',
  setupBench: () => '벤치에 낼 기본 포켓몬을 고르세요 (다 냈으면 완료)',
  extraDraw: () => '상대가 멀리건을 했습니다. 몇 장 더 뽑을까요?',
  extraBench: () => '추가로 뽑은 기본 포켓몬을 벤치에 낼 수 있습니다',
  promote: () => '새 배틀 포켓몬을 고르세요',
  pick: pd => `${SEARCH[pd.filter](pd)} (그만 찾으려면 완료)`,
  deltaGift: (pd, db, v) => `델타기프트: ${spot(db, v.players[ME], pd.targets[0])}에게 붙일 기본 에너지를 고르세요`,
  switchOwn: () => '배틀 포켓몬과 바꿀 벤치 포켓몬을 고르세요',
  moveEnergy: () => '새 배틀 포켓몬에게 옮길 에너지를 고르세요',
  catch: () => '상대의 배틀 포켓몬과 바꿀 상대 벤치 포켓몬을 고르세요',
  snipe: pd => `${pd.amount} 데미지를 줄 상대 ${pd.benchOnly ? '벤치 ' : ''}포켓몬을 고르세요 (벤치는 약점·저항력 없음)`,
  lure: () => '상대 덱 위 5장 중 상대 벤치로 보낼 기본 포켓몬을 고르세요',
  counters: pd => `데미지 카운터 ${pd.amount / 10}개를 올릴 상대 포켓몬을 고르세요`,
  dragOut: () => '배틀로 끌어낼 상대 벤치 포켓몬을 고르세요 (나오면 40 데미지)',
  chargeBench: () => '덱에서 벤치 포켓몬에게 붙일 에너지와 포켓몬을 고르세요',
  selfSwitch: () => '배틀 포켓몬과 바꿀 벤치 포켓몬을 고르세요',
  colorful: () => '패의 포켓몬을 보여줄 타입 수를 고르세요 (타입 1개당 30)',
  drawTo6: () => '패가 6장이 되도록 뽑을까요?',
  scaleBeat: () => '스케일 비트: 덱 위 6장의 기본 에너지를 (드래곤) 포켓몬에게 붙이세요',
  roarAsk: () => '메가레쿠쟈 ex의 특성 「패왕의 포효」를 사용할까요?',
  roar: () => '패왕의 포효: 덱 위 4장 중 이 포켓몬에게 붙일 기본 에너지를 고르세요',
  forcedSwitch: () => '상대 기술로 배틀 포켓몬을 바꿉니다. 새 배틀 포켓몬을 고르세요',
  oppEnergy: () => '트래쉬할 상대 배틀 포켓몬의 에너지를 고르세요',
  ownEnergy: pd => `트래쉬할 에너지 ${pd.count}개를 고르세요`,
  voltage: () => '트래쉬할 기본 에너지를 고르세요 (1장당 60 데미지)',
  buddyBoost: () => '버디 부스트: 붙일 에너지와 포켓몬을 고르세요 (불꽃·번개 1장씩까지)',
  deepSea: () => '심해 드로: 덱 아래로 되돌릴 패를 고르세요 (안 해도 됨)',
};

const aiRng = makeRng(Date.now() >>> 0); // 컴퓨터의 선택·가위바위보용 (저장하지 않음)
let shown = []; // 지금 화면의 행동 버튼이 가리키는 행동 목록 (data-arg = 번호)
let timer = null;

const topId = m => m.cards[m.cards.length - 1];
const nm = (db, m) => db.get(topId(m)).name;
const spot = (db, P, to) => (to === -1 ? `배틀 ${nm(db, P.active)}` : `벤치${to + 1} ${nm(db, P.bench[to])}`);
const dot = type => `<i class="dot" data-type="${esc(type)}">${esc(type[0])}</i>`;
const top = title => `<header class="top"><button class="link" data-act="home">처음 화면</button><b>${title}</b></header>`;
const gameName = m => (m.suddenDeath ? '서든데스' : `${m.wins[0] + m.wins[1] + 1}판`);
const actBtn = (a, text, cls = '') => `<button class="btn ${cls}" data-act="act" data-arg="${shown.indexOf(a)}">${esc(text)}</button>`;

function label(db, v, a) {
  const P = v.players[ME];
  const kind = v.pending?.kind;
  switch (a.type) {
    case 'bench': return '벤치에 내기';
    case 'evolve': return `진화 → ${spot(db, P, a.to)}`;
    case 'attach': return `붙이기 → ${spot(db, P, a.to)}`;
    case 'trainer': return a.to !== undefined ? `붙이기 → ${spot(db, P, a.to)}` : a.pair ? '좌·우 2장으로 내기' : '사용하기';
    case 'retreat': return `후퇴 → ${spot(db, P, a.to)} (트래쉬: ${a.discard.map(id => db.get(id).energyType).join('·') || '없음'})`;
    case 'attack': { const atk = attacksOf(P.active, db)[a.index]; return `${atk.name} ${atk.damage ?? ''}`; }
    case 'ability': return `특성 「${db.get(topId(a.to === -1 ? P.active : P.bench[a.to])).ability.name}」 사용`;
    case 'handAbility': return `특성 「${db.get(a.id).ability.name}」 사용 (벤치로)`;
    case 'end': return '차례 끝';
    case 'done': return DONE[kind] ?? '완료';
    case 'choose':
      if (a.use) return '사용하기';
      if (a.ids) return a.ids.length ? `트래쉬: ${a.ids.map(id => db.get(id).energyType ?? db.get(id).name).join('·')} (${a.ids.length}장)` : '트래쉬하지 않음';
      if (a.id && a.to !== undefined) return `${db.get(a.id).name} → ${spot(db, P, a.to)}`;
      if (a.id) return kind === 'deepSea' ? `덱 아래로: ${db.get(a.id).name}` : db.get(a.id).name;
      if (kind === 'colorful') return `타입 ${a.n}개 보여주기 (${a.n * 30} 데미지)`;
      if (kind === 'drawTo6') return `${a.n}장 뽑기`;
      if (a.n !== undefined) return `${a.n}장`;
      return OPP_TARGET.includes(kind) ? `상대 ${spot(db, v.players[CPU], a.to)}` : spot(db, P, a.to);
  }
}

// ---------- 필드 그리기 ----------

// 아직 끝나지 않은 기술 효과 (다음 차례 기술 불가 등)
const fxText = (m, turn) => [
  ...Object.entries(FX).filter(([k]) => m.fx?.[k] >= turn).map(([, t]) => t),
  ...(m.fx?.lockAttack?.turn >= turn ? [`${m.fx.lockAttack.name} 불가`] : []),
];

function monBox(db, m, side, to, big, turn) {
  if (!m) return `<div class="mon empty${big ? ' big' : ''}"></div>`;
  const c = db.get(topId(m));
  const hp = maxHp(m, db);
  const left = Math.max(0, hp - m.damage);
  const conds = [m.cond.poison && '독', m.cond.burn && '화상', COND[m.cond.special], ...fxText(m, turn)].filter(Boolean);
  const can = side === ME && shown.some(a => a.type === 'ability' && a.to === to);
  return `<button class="mon${big ? ' big' : ''}${can ? ' can' : ''}" data-type="${esc(c.type)}" data-act="mon" data-arg="${side},${to}">` +
    `<span class="nm">${esc(c.name)}</span><span class="hp">HP ${left}/${hp}</span>` +
    `<span class="hpbar"><i style="width:${(left / hp) * 100}%"></i></span>` +
    `<span>${m.energy.map(id => dot(db.get(id).energyType)).join('')}</span>` +
    (m.tool ? `<small>도구 ${esc(db.get(m.tool).name)}</small>` : '') +
    (conds.length ? `<small class="cond">${conds.join(' ')}</small>` : '') + '</button>';
}

const benchRow = (db, bench, side, turn) =>
  `<div class="benchrow">${Array.from({ length: 5 }, (_, i) => monBox(db, bench[i], side, i, false, turn)).join('')}</div>`;

function pinfo(P, side) {
  const hand = side === ME ? P.hand.length : P.handCount;
  return `<div class="pinfo"><b>${WHO[side]}</b> 패 ${hand} · 덱 ${P.deckCount} · 프라이즈 ${P.prizeCount}` +
    `<button data-act="trash" data-arg="${side}">트래쉬 ${P.discard.length}</button></div>`;
}

function handRow(db, hand) {
  return `<div class="hand">${hand.map((id, i) => {
    const c = db.get(id);
    const can = shown.some(a => a.id === id && a.type !== 'choose');
    const info = c.category === '포켓몬' ? `${c.stage} HP${c.hp}` : c.category;
    return `<button class="hc${can ? ' can' : ''}" data-type="${esc(colorOf(c))}" data-act="hand" data-arg="${i}">` +
      `<b>${esc(c.name)}</b><small>${esc(info)}</small></button>`;
  }).join('')}</div>`;
}

function middle(db, v) {
  const st = v.stadium ? `<p>스타디움: ${esc(db.get(v.stadium.cards[0]).name)} (${WHO[v.stadium.owner]})</p>` : '';
  const lines = v.log.slice(-3).map(l => `<span>${l.p === null ? '' : WHO[l.p] + ': '}${esc(l.t)}</span>`).join('');
  return `<div class="mid">${st}<button class="log" data-act="log">${lines}<small>기록 전체 보기</small></button></div>`;
}

function bar(db, m, v, mine) {
  const g = m.game;
  if (g.phase === 'over') {
    const r = g.winner === ME ? '승리' : g.winner === CPU ? '패배' : '무승부 → 서든데스';
    return `<div class="bar"><p><b>이번 판: ${r}</b> — ${esc(g.reason)}</p><button class="btn" data-act="next">다음</button></div>`;
  }
  if (!mine) return `<div class="bar"><p class="muted">컴퓨터가 생각하는 중…</p></div>`;
  if (g.pending) return '';
  const A = v.players[ME].active;
  const attacks = attacksOf(A, db).map((atk, index) => {
    const a = shown.find(x => x.type === 'attack' && x.index === index);
    return a ? actBtn(a, label(db, v, a)) : `<button class="btn" disabled>${esc(`${atk.name} ${atk.damage ?? ''}`)}</button>`;
  }).join('');
  return `<div class="bar">${attacks}${actBtn(shown.find(a => a.type === 'end'), '차례 끝', 'sub')}</div>`;
}

function battle(ctx, m) {
  const { db } = ctx;
  const g = m.game;
  const v = viewFor(g, ME);
  const mine = g.phase !== 'over' && actor(g) === ME;
  shown = mine ? legalActions(g, db) : [];
  const [me, op] = v.players;
  const turn = v.phase === 'setup' ? '대전 준비' : `${v.turn}번째 차례 · ${WHO[v.current]}의 차례`;
  return top(`${gameName(m)} · 나 ${m.wins[0]} : ${m.wins[1]} 컴퓨터(${ctx.S.level})`) +
    `<p class="turn">${turn}${m.suddenDeath ? ' · 프라이즈 1장 먼저 가져가면 승리' : ''}</p>` +
    (mine && g.pending ? `<div class="prompt"><b>${esc(PROMPT[g.pending.kind](g.pending, db, v))}</b><div class="opts">` +
      shown.map(a => actBtn(a, label(db, v, a), a.type === 'done' ? 'sub' : '')).join('') + '</div></div>' : '') +
    pinfo(op, CPU) +
    (op.bench ? benchRow(db, op.bench, CPU, v.turn) + `<div class="active">${monBox(db, op.active, CPU, -1, true, v.turn)}</div>`
      : '<p class="muted">컴퓨터가 포켓몬을 뒷면으로 놓는 중…</p>') +
    middle(db, v) +
    `<div class="active">${monBox(db, me.active, ME, -1, true, v.turn)}</div>` +
    benchRow(db, me.bench, ME, v.turn) +
    pinfo(me, ME) +
    handRow(db, me.hand) +
    bar(db, m, v, mine);
}

// ---------- 매치 단계별 화면 ----------

function rps(m) {
  const again = m.rps ? `<p>나: ${m.rps.hands[0]} / 컴퓨터: ${m.rps.hands[1]} → 비겼습니다. 다시!</p>` : '';
  const intro = m.suddenDeath
    ? '<p class="warn">무승부라 서든데스입니다. 처음부터 다시, 프라이즈 6장을 놓고 먼저 1장을 가져가는 쪽이 이 판을 이깁니다.</p>'
    : '<p>이긴 쪽이 선공·후공을 고릅니다.</p>';
  return top(`${gameName(m)} · 가위바위보`) + intro + again +
    `<div class="seg">${HANDS.map(h => `<button data-act="rps" data-arg="${h}">${h}</button>`).join('')}</div>`;
}

function order(m) {
  const why = m.rps
    ? `가위바위보: 나 ${m.rps.hands[0]} / 컴퓨터 ${m.rps.hands[1]} → ${m.rps.winner === ME ? '이겼습니다!' : '컴퓨터가 이겼습니다.'}`
    : `지난 판에서 ${m.chooser === ME ? '졌으니' : '컴퓨터가 졌으니'} 선공·후공을 고릅니다.`;
  const pick = m.chooser === ME
    ? '<button class="btn" data-act="order" data-arg="1">선공</button><button class="btn sub" data-act="order" data-arg="0">후공</button>'
    : '<p>컴퓨터가 선공을 골랐습니다.</p><button class="btn" data-act="order" data-arg="1">시작</button>';
  return top(`${gameName(m)} · 나 ${m.wins[0]} : ${m.wins[1]} 컴퓨터`) + `<p>${why}</p>` + pick;
}

function over(m) {
  const rows = m.history.map((h, i) => {
    const r = h.winner === ME ? '승리' : h.winner === CPU ? '패배' : '무승부';
    return `<li>${h.suddenDeath ? '서든데스' : `${i + 1}번째 대전`}: ${r} (선공: ${WHO[h.first]}) — ${esc(h.reason)}</li>`;
  }).join('');
  return top('매치 결과') +
    `<p class="big">${m.winner === ME ? '매치 승리!' : '매치 패배'} ${m.wins[0]} : ${m.wins[1]}</p><ul>${rows}</ul>` +
    '<button class="btn" data-act="home">처음 화면으로</button>';
}

export const screens = {
  match(ctx) {
    const m = ctx.S.match;
    if (m.step === 'rps') return rps(m);
    if (m.step === 'order') return order(m);
    if (m.step === 'over') return over(m);
    return battle(ctx, m);
  },
};

// 화면을 그린 뒤: 컴퓨터가 행동할 차례면 잠시 뒤 한 가지씩 한다 (저장되므로 새로 고쳐도 이어짐)
export function afterRender(ctx) {
  const cpuTurn = () => {
    const g = ctx.S.screen === 'match' && ctx.S.match.step === 'game' && ctx.S.match.game;
    return g && g.phase !== 'over' && actor(g) === CPU ? g : null;
  };
  if (timer || !cpuTurn()) return;
  timer = setTimeout(() => {
    timer = null;
    const g = cpuTurn();
    if (!g) return;
    const choice = chooseAction(viewFor(g, CPU), legalActions(g, ctx.db), aiRng, { level: ctx.S.level, db: ctx.db, deck: ctx.S.match.decks[CPU] });
    ctx.S.match.game = applyAction(g, choice, ctx.db);
    ctx.update();
  }, CPU_DELAY);
}

// ---------- 버튼 ----------

function monSheet(ctx, side, to) {
  const { db } = ctx;
  const g = ctx.S.match.game;
  const P = viewFor(g, ME).players[side];
  const m = to === -1 ? P.active : P.bench[to];
  const c = db.get(topId(m));
  const conds = [m.cond.poison && '독', m.cond.burn && '화상', COND[m.cond.special]].filter(Boolean);
  const hp = maxHp(m, db);
  const state = `<p class="muted">${WHO[side]}의 ${to === -1 ? '배틀 포켓몬' : `벤치${to + 1}`} · 남은 HP ${Math.max(0, hp - m.damage)}/${hp}` +
    (m.cards.length > 1 ? ` · 진화 전: ${m.cards.slice(0, -1).map(id => esc(db.get(id).name)).join(' → ')}` : '') + '<br>' +
    `에너지: ${m.energy.map(id => esc(db.get(id).name)).join(', ') || '없음'}` +
    (m.tool ? ` · 도구: ${esc(db.get(m.tool).name)}` : '') + (conds.length ? ` · 상태: ${conds.join(', ')}` : '') + '</p>';
  const own = side === ME && !g.pending
    ? shown.filter(a => (a.type === 'ability' && a.to === to) || (to === -1 && (a.type === 'attack' || a.type === 'retreat'))) : [];
  const v = viewFor(g, ME);
  showSheet(state + detailHtml(c) + own.map(a => actBtn(a, label(db, v, a))).join(''), c.type);
}

export const actions = {
  rps: (ctx, hand) => { ctx.S.match = playRps(ctx.S.match, [hand, HANDS[randInt(aiRng, 3)]]); ctx.update(); },
  order: (ctx, first) => { ctx.S.match = chooseOrder(ctx.S.match, first === '1', ctx.db); ctx.update(); },
  act: (ctx, i) => { ctx.S.match.game = applyAction(ctx.S.match.game, shown[i], ctx.db); ctx.update(); },
  next: ctx => { ctx.S.match = finishGame(ctx.S.match); ctx.update(); },
  hand: (ctx, i) => {
    const { db } = ctx;
    const g = ctx.S.match.game;
    const v = viewFor(g, ME);
    const id = v.players[ME].hand[i];
    const acts = shown.filter(a => a.id === id && a.type !== 'choose');
    showSheet(detailHtml(db.get(id)) + acts.map(a => actBtn(a, label(db, v, a))).join(''), colorOf(db.get(id)));
  },
  mon: (ctx, arg) => { const [side, to] = arg.split(',').map(Number); monSheet(ctx, side, to); },
  trash: (ctx, side) => {
    const P = viewFor(ctx.S.match.game, ME).players[side];
    const names = P.discard.map(id => esc(ctx.db.get(id).name));
    showSheet(`<h2>${WHO[side]}의 트래쉬 ${names.length}장</h2><p>${names.join(', ') || '없음'}</p>`, '트래쉬');
  },
  log: ctx => {
    const lines = viewFor(ctx.S.match.game, ME).log.slice().reverse()
      .map(l => `<li>${l.p === null ? '' : WHO[l.p] + ': '}${esc(l.t)}</li>`).join('');
    showSheet(`<h2>기록 (최근 것이 위)</h2><ul class="loglist">${lines}</ul>`, '트래쉬');
  },
};
