import { db } from './db.js';

/* ================= 常量 & 工具 ================= */
const TYPES = {
  order: { label: '点单', cls: 't-order' },
  special: { label: '店长特制', cls: 't-special' },
  trial: { label: '试作', cls: 't-trial' },
};
const RATING_TEXT = ['', '一般般', '还行', '不错', '好吃！', '超爱！'];
const PX_PER_DAY = 12; // 时光轴：每隔一天，竖线多长 12px
const PHOTO_MAX = 1600; // 原图压缩后最长边
const THUMB_SIZE = 320; // 缩略图（方形裁剪）

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const WD = '日一二三四五六';

const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayKey = () => toLocal(new Date()).slice(0, 10);
function dayNum(key) {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
}
const tOf = (dt) => dayNum(dt) + (Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16))) / 1440;
function parts(dt) {
  const [y, m, d] = dt.slice(0, 10).split('-').map(Number);
  return { y, m, d, wd: WD[new Date(y, m - 1, d).getDay()], hm: dt.slice(11, 16) };
}
const fmtFull = (dt) => { const p = parts(dt); return `${p.y}年${p.m}月${p.d}日 周${p.wd} ${p.hm}`; };
const fmtShort = (dt) => { const p = parts(dt); return `${p.m}月${p.d}日 周${p.wd} ${p.hm}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function stars(n, cls = '') {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<i class="${i <= n ? 'on' : ''}">★</i>`;
  return `<span class="stars ${cls}" aria-label="${n} 星">${s}</span>`;
}
const typeOf = (t) => TYPES[t] || TYPES.order;
const typeTag = (t) => `<span class="tag-type ${typeOf(t).cls}">${typeOf(t).label}</span>`;
const priceText = (p) => (p == null ? '' : `¥${Number(p).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`);
const nameOf = (e) => e.name || '未命名';

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Blob → object URL（随数据缓存一起失效） ---------- */
let urlMap = new WeakMap();
let urlList = [];
function urlFor(blob) {
  if (!blob) return '';
  let u = urlMap.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    urlMap.set(blob, u);
    urlList.push(u);
  }
  return u;
}
function revokeAll() {
  urlList.forEach((u) => URL.revokeObjectURL(u));
  urlList = [];
  urlMap = new WeakMap();
}

/* ---------- 数据缓存 ---------- */
let cache = null;
async function entries() {
  if (!cache) {
    const all = await db.all();
    all.sort((a, b) => b.datetime.localeCompare(a.datetime) || (b.createdAt || 0) - (a.createdAt || 0));
    cache = all;
  }
  return cache;
}
function invalidate() { cache = null; revokeAll(); }
function allTags(list) {
  const m = new Map();
  list.forEach((e) => (e.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).map((x) => x[0]);
}
let persistAsked = false;
function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

/* ================= 路由 ================= */
const routes = [
  [/^#\/timeline$/, 'timeline', () => viewTimeline()],
  [/^#\/calendar$/, 'calendar', () => viewCalendar()],
  [/^#\/new(?:\?date=(\d{4}-\d{2}-\d{2}))?$/, 'new', (d) => viewForm(null, d)],
  [/^#\/edit\/([\w-]+)$/, 'form', (id) => viewForm(id)],
  [/^#\/entry\/([\w-]+)$/, 'detail', (id) => viewDetail(id)],
  [/^#\/review(?:\?tag=(.+))?$/, 'review', (tag) => viewReview(tag && decodeURIComponent(tag))],
];
const scrollMem = {};
let curKey = null;
let prevKey = null;
let navCount = 0;
let resetScroll = false;
let renderToken = 0;

function goBack(fallback = '#/timeline') {
  if (navCount > 0) history.back();
  else location.replace(fallback);
}

async function render() {
  const hash = location.hash || '#/timeline';
  let match = null;
  for (const [re, key, fn] of routes) {
    const m = hash.match(re);
    if (m) { match = { key, fn, args: m.slice(1) }; break; }
  }
  if (!match) { location.replace('#/timeline'); return; }

  if (curKey) scrollMem[curKey] = window.scrollY;
  prevKey = curKey;
  curKey = match.key;
  const token = ++renderToken;

  document.body.classList.toggle('is-form', match.key === 'new' || match.key === 'form');
  const tab = { timeline: 'timeline', calendar: 'calendar', new: 'new', review: 'review' }[match.key];
  $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));

  view.onclick = view.ontouchstart = view.ontouchend = null;
  try {
    await match.fn(...match.args);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><h2>出错了</h2><p>${esc(err.message)}</p></div>`;
  }
  if (token !== renderToken) return;

  const keep = ['timeline', 'calendar', 'review'].includes(match.key) && !resetScroll && scrollMem[match.key] != null;
  window.scrollTo(0, keep ? scrollMem[match.key] : 0);
  resetScroll = false;
  afterRender?.();
  afterRender = null;
}
let afterRender = null;

window.addEventListener('hashchange', () => { navCount++; render(); });
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-reset]');
  if (a) {
    if (a.getAttribute('href') === location.hash) { window.scrollTo({ top: 0, behavior: 'smooth' }); ev.preventDefault(); }
    else resetScroll = true;
  }
});
topbar.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-act=back]')) goBack();
});

function headerMain(active) {
  topbar.innerHTML = `
    <div class="brand"><img src="icons/icon.svg" alt=""><span>芭菲日记</span></div>
    <div class="seg">
      <a href="#/timeline" data-reset class="${active === 'timeline' ? 'on' : ''}">时光轴</a>
      <a href="#/calendar" data-reset class="${active === 'calendar' ? 'on' : ''}">日历</a>
    </div>`;
}
function headerSub(title, right = '') {
  topbar.innerHTML = `
    <button class="icon-btn" data-act="back" aria-label="返回">‹</button>
    <div class="topbar-title">${esc(title)}</div>
    <div class="topbar-right">${right}</div>`;
}
function headerPlain(title) {
  topbar.innerHTML = `<div class="brand"><img src="icons/icon.svg" alt=""><span>${esc(title)}</span></div>`;
}

/* 通用横向卡片 */
function rowCard(e, extra = '', snippet = false) {
  const th = e.photos?.[0]?.thumb;
  return `
    <div class="card row-card">
      <span class="thumb-wrap ${typeOf(e.type).cls}">${th ? `<img class="thumb" src="${urlFor(th)}" alt="" loading="lazy">` : '<img class="thumb thumb-empty" src="icons/icon.svg" alt="">'}</span>
      <div class="row-body">
        <div class="row-name">${esc(nameOf(e))}</div>
        <div class="row-meta">${typeTag(e.type)}${e.rating ? stars(e.rating, 'sm') : ''}</div>
        <div class="row-date">${fmtShort(e.datetime)}${extra}</div>
        ${snippet && e.thoughts ? `<div class="row-snippet">${esc(e.thoughts)}</div>` : ''}
      </div>
    </div>`;
}

/* ================= 时光轴 ================= */
let flashId = null;

function buildTimeline(list) {
  const nowStr = toLocal(new Date());
  const nowT = tOf(nowStr);
  const newest = list[0].datetime;
  const topStr = newest > nowStr ? newest : nowStr;
  const topT = tOf(topStr);
  const oldestYM = list[list.length - 1].datetime.slice(0, 7);
  const counts = {};
  list.forEach((e) => { const k = e.datetime.slice(0, 7); counts[k] = (counts[k] || 0) + 1; });

  // 时间点：月份刻度放在"下个月 1 日 0 点"的位置（从上往下读就是这个月的开头）
  const items = [];
  let [y, m] = topStr.slice(0, 7).split('-').map(Number);
  let first = true;
  for (;;) {
    const key = `${y}-${pad(m)}`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    items.push({ kind: 'month', y, m, count: counts[key] || 0, t: first ? topT + 1e-6 : dayNum(next), ord: 2 });
    first = false;
    if (key <= oldestYM) break;
    m--; if (m === 0) { m = 12; y--; }
  }
  if (nowT >= tOf(newest)) {
    items.push({ kind: 'now', t: nowT, since: dayNum(nowStr) - dayNum(newest), ord: 0 });
  }
  list.forEach((e, i) => {
    const older = list[i + 1];
    items.push({ kind: 'entry', e, t: tOf(e.datetime), gap: older ? dayNum(e.datetime) - dayNum(older.datetime) : null, ord: 1 });
  });
  items.sort((a, b) => b.t - a.t || a.ord - b.ord);

  // 加入按天数成比例的间隔；连续 ≥2 个空月折叠成一段"没来"
  const out = [];
  let prevT = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'month' && it.count === 0 && i > 0) {
      let j = i;
      while (j < items.length && items[j].kind === 'month' && items[j].count === 0) j++;
      if (j - i >= 2) {
        if (prevT !== null) out.push({ kind: 'gap', h: (prevT - it.t) * PX_PER_DAY });
        out.push({ kind: 'break', newer: items[i], older: items[j - 1], months: j - i });
        prevT = j < items.length ? items[j].t : items[j - 1].t;
        i = j - 1;
        continue;
      }
    }
    if (prevT !== null) out.push({ kind: 'gap', h: Math.max(0, (prevT - it.t) * PX_PER_DAY) });
    out.push(it);
    prevT = it.t;
  }
  out.push({ kind: 'start', e: list[list.length - 1] });
  return out;
}

function tlItemHTML(it) {
  switch (it.kind) {
    case 'gap':
      return it.h >= 1 ? `<div style="height:${Math.round(it.h)}px"></div>` : '';
    case 'month':
      return `
        <div class="tl-month ${it.count ? '' : 'empty'}">
          <div class="tl-month-label"><b>${it.m}月</b><span>${it.y}</span></div>
          ${it.count ? `<span class="tl-month-count"><small>去了</small><b>${it.count}</b><small>次</small></span>` : '<span class="tl-month-none">这个月没来</span>'}
        </div>`;
    case 'break': {
      const o = it.older, n = it.newer;
      const range = o.y === n.y ? `${o.y}年${o.m}–${n.m}月` : `${o.y}年${o.m}月 – ${n.y}年${n.m}月`;
      return `<div class="tl-break"><span>${range} · ${it.months} 个月没来</span></div>`;
    }
    case 'now':
      return `<div class="tl-now"><span class="tl-now-dot"></span>今天 · ${it.since === 0 ? '今天来过啦' : `距上次 ${it.since} 天`}</div>`;
    case 'entry': {
      const e = it.e;
      const gap = it.gap == null ? '' : it.gap === 0 ? ' · 同一天' : ` · 隔 ${it.gap} 天`;
      return `
        <a class="tl-item" href="#/entry/${e.id}" data-id="${e.id}">
          <span class="tl-dot ${typeOf(e.type).cls}"></span>
          ${rowCard(e, gap)}
        </a>`;
    }
    case 'start':
      return `<div class="tl-start">第一次记录 · ${fmtFull(it.e.datetime).slice(0, -6)}</div>`;
  }
  return '';
}

async function viewTimeline() {
  headerMain('timeline');
  const list = await entries();
  if (!list.length) {
    view.innerHTML = `
      <div class="empty">
        <img src="icons/icon.svg" alt="">
        <h2>还没有记录呢</h2>
        <p>今天在店里吃了什么？记下来吧</p>
        <a class="btn primary" href="#/new">记下第一杯</a>
      </div>`;
    return;
  }
  view.innerHTML = `<div class="tl">${buildTimeline(list).map(tlItemHTML).join('')}</div>`;
  if (flashId) {
    const id = flashId;
    flashId = null;
    afterRender = () => {
      const el = view.querySelector(`.tl-item[data-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
      }
    };
  }
}

/* ================= 日历 ================= */
const cal = { y: null, m: null, sel: null };

async function viewCalendar() {
  headerMain('calendar');
  const list = await entries();
  if (cal.y == null) {
    const d = new Date();
    cal.y = d.getFullYear();
    cal.m = d.getMonth() + 1;
  }
  const byDay = new Map();
  list.forEach((e) => {
    const k = e.datetime.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  });

  const draw = () => {
    const first = new Date(cal.y, cal.m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // 周一开头
    const dim = new Date(cal.y, cal.m, 0).getDate();
    const ym = `${cal.y}-${pad(cal.m)}`;
    const monthList = list.filter((e) => e.datetime.startsWith(ym));
    const rated = monthList.filter((e) => e.rating);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : null;
    const tk = todayKey();

    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell blank"></div>';
    for (let d = 1; d <= dim; d++) {
      const key = `${ym}-${pad(d)}`;
      const es = byDay.get(key) || [];
      const cover = es.find((e) => e.photos?.length)?.photos[0].thumb;
      const r = es.filter((e) => e.rating);
      const dayAvg = r.length ? Math.round(r.reduce((s, e) => s + e.rating, 0) / r.length) : 0;
      cells += `
        <button class="cal-cell ${es.length ? 'has' : ''} ${key === tk ? 'today' : ''} ${key === cal.sel ? 'sel' : ''}" data-day="${key}" aria-label="${cal.m}月${d}日${es.length ? `，${es.length} 条记录` : ''}">
          <span class="cal-box">
            ${cover ? `<img src="${urlFor(cover)}" alt="" loading="lazy">` : es.length ? '<span class="cal-noimg"></span>' : ''}
            <span class="cal-num">${d}</span>
            ${es.length ? `<span class="cal-badge">${es.length}</span>` : ''}
          </span>
          <span class="cal-stars">${dayAvg ? stars(dayAvg, 'xs') : ''}</span>
        </button>`;
    }

    let dayPanel = '';
    if (cal.sel && cal.sel.startsWith(ym) && byDay.has(cal.sel)) {
      const es = byDay.get(cal.sel);
      const p = parts(cal.sel + 'T00:00');
      dayPanel = `
        <section class="cal-day">
          <h3><span>${p.m}月${p.d}日 周${p.wd} · ${es.length} 条</span><a class="chip sm new" href="#/new?date=${cal.sel}">＋ 再记一条</a></h3>
          <div class="list">${es.map((e) => `<a href="#/entry/${e.id}">${rowCard(e, '', true)}</a>`).join('')}</div>
        </section>`;
    }

    view.innerHTML = `
      <div class="cal-head">
        <button class="icon-btn" data-nav="-1" aria-label="上个月">‹</button>
        <h2>${cal.y}年${cal.m}月</h2>
        <button class="icon-btn" data-nav="1" aria-label="下个月">›</button>
      </div>
      <div class="cal-sub">${monthList.length ? `本月去了 <b>${monthList.length}</b> 次${avg ? ` · 平均 ★${avg}` : ''}` : '这个月还没有记录'}</div>
      <div class="cal-week">${'一二三四五六日'.split('').map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      ${dayPanel || '<div class="cal-tip">点有照片的日子看记录，点空白日子直接新增 · 左右滑动换月</div>'}`;
  };

  const shift = (n) => {
    cal.m += n;
    if (cal.m === 0) { cal.m = 12; cal.y--; }
    if (cal.m === 13) { cal.m = 1; cal.y++; }
    draw();
  };

  view.onclick = (ev) => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { shift(Number(nav.dataset.nav)); return; }
    const cell = ev.target.closest('.cal-cell[data-day]');
    if (!cell) return;
    const key = cell.dataset.day;
    if (byDay.has(key)) {
      cal.sel = cal.sel === key ? null : key;
      draw();
      if (cal.sel) $('.cal-day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      location.hash = `#/new?date=${key}`;
    }
  };
  let sx = null, sy = null;
  view.ontouchstart = (ev) => { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; };
  view.ontouchend = (ev) => {
    if (sx == null || curKey !== 'calendar') return;
    const dx = ev.changedTouches[0].clientX - sx, dy = ev.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  };
  draw();
}

/* ================= 新增 / 编辑 ================= */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = src;
  });
}
function canvasBlob(canvas, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
}
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, PHOTO_MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const full = await canvasBlob(c, 0.82);

    const side = Math.min(w, h);
    const t = document.createElement('canvas');
    t.width = t.height = THUMB_SIZE;
    t.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
    const thumb = await canvasBlob(t, 0.78);
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

async function viewForm(id, dateParam) {
  const list = await entries();
  const e = id ? list.find((x) => x.id === id) : null;
  if (id && !e) { headerSub('找不到'); view.innerHTML = '<div class="empty"><h2>这条记录不见了</h2></div>'; return; }
  const isNew = !e;
  const now = new Date();
  const st = {
    photos: e ? [...(e.photos || [])] : [],
    type: e?.type || 'order',
    rating: e?.rating || 0,
    tags: e ? [...(e.tags || [])] : [],
    busy: 0,
  };
  const dt = e?.datetime || (dateParam ? `${dateParam}T${pad(now.getHours())}:${pad(now.getMinutes())}` : toLocal(now));
  const tagPool = allTags(list);

  headerSub(isNew ? '记一笔' : '编辑记录');
  view.innerHTML = `
    <form class="form" id="f" autocomplete="off">
      <div class="photo-strip" id="photos"></div>
      <input class="in big" name="name" placeholder="吃了什么？" value="${esc(e?.name)}" enterkeyhint="next" maxlength="60">
      <div class="type-pick" id="typePick">
        ${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-type="${k}" class="${v.cls}">${v.label}</button>`).join('')}
      </div>
      <div class="star-pick" id="starPick">
        ${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-v="${v}" aria-label="${v} 星">★</button>`).join('')}
        <span class="star-label" id="starLabel"></span>
      </div>
      <label class="field"><span class="field-label">我的要求 <em>跟店长说了什么</em></span>
        <textarea class="in" name="request" rows="2" placeholder="例：想要酸一点、不要太甜、加草莓…">${esc(e?.request)}</textarea></label>
      <label class="field"><span class="field-label">实际做出来的</span>
        <textarea class="in" name="actual" rows="2" placeholder="店长做了什么、用了哪些料…">${esc(e?.actual)}</textarea></label>
      <label class="field"><span class="field-label">感想</span>
        <textarea class="in" name="thoughts" rows="4" placeholder="吃下去的感觉、心情、想下次试试的…">${esc(e?.thoughts)}</textarea></label>
      <div class="field"><span class="field-label">标签</span>
        <div class="in tag-box" id="tagBox"><span id="tagChips" style="display:contents"></span><input id="tagInput" placeholder="输入后按回车" enterkeyhint="done"></div>
        <div class="tag-sugg" id="tagSugg"></div>
      </div>
      <div class="row2">
        <label class="field"><span class="field-label">时间</span>
          <input class="in" type="datetime-local" name="datetime" value="${dt}" required></label>
        <label class="field"><span class="field-label">价格 <em>选填</em></span>
          <span class="price-wrap"><span>¥</span><input class="in" name="price" inputmode="decimal" placeholder="—" value="${e?.price ?? ''}"></span></label>
      </div>
    </form>
    <div class="actionbar"><div class="actionbar-inner">
      <button type="button" class="btn ghost" id="cancelBtn">取消</button>
      <button type="submit" form="f" class="btn primary" id="saveBtn">保存</button>
    </div></div>`;

  const form = $('#f');
  const photosEl = $('#photos');
  const saveBtn = $('#saveBtn');
  const tagInput = $('#tagInput');

  // 照片
  const drawPhotos = () => {
    photosEl.innerHTML =
      st.photos.map((p, i) => `<div class="photo-item"><img src="${urlFor(p.thumb)}" alt=""><button type="button" class="rm" data-rm="${i}" aria-label="删除照片">×</button></div>`).join('') +
      Array.from({ length: st.busy }, () => '<div class="photo-item loading">压缩中…</div>').join('') +
      `<label class="photo-add"><input type="file" accept="image/*" multiple id="fileIn"><svg class="ico" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 11.5c0-1.4 1-2.5 2.4-2.5h3.2l2-3h6.8l2 3h3.2c1.4 0 2.4 1.1 2.4 2.5v11c0 1.4-1 2.5-2.4 2.5H7.4C6 25 5 23.9 5 22.5z"/><circle cx="16" cy="17" r="4.6"/></svg><span>${st.photos.length ? '再加' : '拍照/相册'}</span></label>`;
    saveBtn.disabled = st.busy > 0;
  };
  photosEl.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) { st.photos.splice(Number(rm.dataset.rm), 1); drawPhotos(); }
  });
  photosEl.addEventListener('change', async (ev) => {
    if (ev.target.id !== 'fileIn') return;
    const files = [...ev.target.files];
    st.busy += files.length;
    drawPhotos();
    for (const f of files) {
      try { st.photos.push(await compressPhoto(f)); } catch (err) { toast(err.message); }
      st.busy--;
      drawPhotos();
    }
  });
  drawPhotos();

  // 类型
  const drawType = () => $$('#typePick button').forEach((b) => b.classList.toggle('on', b.dataset.type === st.type));
  $('#typePick').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-type]');
    if (b) { st.type = b.dataset.type; drawType(); }
  });
  drawType();

  // 星级（再点同一颗可清除）
  const drawStars = () => {
    $$('#starPick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= st.rating));
    $('#starLabel').textContent = st.rating ? RATING_TEXT[st.rating] : '点星星评分';
  };
  $('#starPick').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-v]');
    if (!b) return;
    const v = Number(b.dataset.v);
    st.rating = st.rating === v ? 0 : v;
    drawStars();
  });
  drawStars();

  // 标签
  const addTag = (t) => {
    t = t.replace(/^#/, '').trim();
    if (t && !st.tags.includes(t)) st.tags.push(t);
    tagInput.value = '';
    drawTags();
  };
  const drawTags = () => {
    $('#tagChips').innerHTML = st.tags.map((t, i) => `<span class="chip on">${esc(t)}<button type="button" data-rmtag="${i}" aria-label="移除">×</button></span>`).join('');
    const q = tagInput.value.trim();
    const sugg = tagPool.filter((t) => !st.tags.includes(t) && (!q || t.toLowerCase().includes(q.toLowerCase()))).slice(0, 12);
    let html = sugg.map((t) => `<button type="button" class="chip sm" data-addtag="${esc(t)}">${esc(t)}</button>`).join('');
    if (q && !tagPool.includes(q) && !st.tags.includes(q)) html += `<button type="button" class="chip sm new" data-addtag="${esc(q)}">＋ 新标签「${esc(q)}」</button>`;
    $('#tagSugg').innerHTML = html;
  };
  $('#tagBox').addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-rmtag]');
    if (rm) { st.tags.splice(Number(rm.dataset.rmtag), 1); drawTags(); return; }
    tagInput.focus();
  });
  $('#tagSugg').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-addtag]');
    if (b) addTag(b.dataset.addtag);
  });
  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      if (tagInput.value.trim()) addTag(tagInput.value);
    } else if (ev.key === 'Backspace' && !tagInput.value && st.tags.length) {
      st.tags.pop();
      drawTags();
    }
  });
  tagInput.addEventListener('input', () => {
    const v = tagInput.value;
    if (/[,，、\s]$/.test(v) && v.trim()) addTag(v.slice(0, -1));
    else drawTags();
  });
  drawTags();

  $$('textarea', form).forEach((ta) => { autoGrow(ta); ta.addEventListener('input', () => autoGrow(ta)); });
  $('#cancelBtn').onclick = () => goBack(isNew ? '#/timeline' : `#/entry/${id}`);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (st.busy) return;
    if (tagInput.value.trim()) addTag(tagInput.value);
    const fd = new FormData(form);
    const priceRaw = String(fd.get('price') || '').trim().replace(/[¥￥,\s]/g, '');
    const price = priceRaw === '' ? null : Number(priceRaw);
    if (price !== null && !Number.isFinite(price)) { toast('价格请填数字'); return; }
    const entry = {
      id: e?.id || uid(),
      datetime: String(fd.get('datetime') || '').slice(0, 16) || toLocal(new Date()),
      name: String(fd.get('name') || '').trim(),
      type: st.type,
      photos: st.photos,
      request: String(fd.get('request') || '').trim(),
      actual: String(fd.get('actual') || '').trim(),
      rating: st.rating,
      thoughts: String(fd.get('thoughts') || '').trim(),
      tags: st.tags,
      price,
      createdAt: e?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (!entry.name && !entry.photos.length && !entry.thoughts) {
      toast('至少写个名字吧～');
      form.name.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await db.put(entry);
    } catch (err) {
      saveBtn.disabled = false;
      toast('保存失败：' + err.message);
      return;
    }
    invalidate();
    requestPersist();
    toast(isNew ? '记下来啦' : '已更新');
    if (isNew) {
      const day = entry.datetime.slice(0, 10);
      if (prevKey === 'calendar' || dateParam) {
        cal.y = Number(day.slice(0, 4));
        cal.m = Number(day.slice(5, 7));
        cal.sel = day;
        if (prevKey === 'calendar') history.back(); else location.replace('#/calendar');
      } else {
        flashId = entry.id;
        if (prevKey === 'timeline') history.back(); else location.replace('#/timeline');
      }
    } else {
      goBack(`#/entry/${entry.id}`);
    }
  });

  if (isNew && !dateParam) setTimeout(() => form.name.focus({ preventScroll: true }), 50);
}

/* ================= 详情 ================= */
function openViewer(photos, start) {
  const ov = document.createElement('div');
  ov.className = 'viewer';
  ov.innerHTML = `
    <div class="viewer-track">${photos.map((p) => `<div class="viewer-slide"><img src="${urlFor(p.full)}" alt=""></div>`).join('')}</div>
    <button class="viewer-close" aria-label="关闭">×</button>`;
  document.body.append(ov);
  const track = $('.viewer-track', ov);
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; });
  ov.addEventListener('click', () => ov.remove());
}

async function viewDetail(id) {
  const list = await entries();
  const e = list.find((x) => x.id === id);
  if (!e) {
    headerSub('');
    view.innerHTML = '<div class="empty"><h2>这条记录不见了</h2><p>可能已经被删除</p><a class="btn" href="#/timeline">回时光轴</a></div>';
    return;
  }
  headerSub(fmtShort(e.datetime).split(' ').slice(0, 2).join(' '), `<a class="text-btn" href="#/edit/${e.id}">编辑</a>`);
  const n = e.photos?.length || 0;
  const sec = (icon, title, text, cls = '') => (text ? `<section class="card d-sec ${cls}"><h4>${title}</h4><p>${esc(text)}</p></section>` : '');
  let vs = '';
  if (e.request && e.actual) {
    vs = `<div class="d-vs">${sec('', '我的要求', e.request)}<div class="arrow">↓</div>${sec('', '实际做出来的', e.actual)}</div>`;
  } else {
    vs = sec('', '我的要求', e.request) + sec('', '实际做出来的', e.actual);
  }
  view.innerHTML = `
    ${n ? `<div class="gallery-wrap"><div class="gallery" id="gallery">${e.photos.map((p, i) => `<img src="${urlFor(p.full)}" data-i="${i}" alt="照片 ${i + 1}">`).join('')}</div></div>
      ${n > 1 ? `<div class="gallery-count">共 ${n} 张 · 左右滑动 · 点开看大图</div>` : ''}` : ''}
    <section class="card d-head">
      <div class="d-top">${typeTag(e.type)}<span class="d-price">${priceText(e.price)}</span></div>
      <h1>${esc(nameOf(e))}</h1>
      <div class="d-rating">${e.rating ? `${stars(e.rating, 'lg')}<span>${RATING_TEXT[e.rating]}</span>` : '<span>未评分</span>'}</div>
      <div class="d-date">${fmtFull(e.datetime)}</div>
    </section>
    ${vs}
    ${sec('', '感想', e.thoughts, 'thoughts')}
    ${e.tags?.length ? `<div class="d-tags">${e.tags.map((t) => `<a class="chip sm" href="#/review?tag=${encodeURIComponent(t)}"># ${esc(t)}</a>`).join('')}</div>` : ''}
    <div class="d-actions">
      <a class="btn ghost" href="#/edit/${e.id}">编辑</a>
      <button class="btn danger" id="delBtn">删除</button>
    </div>`;

  $('#gallery')?.addEventListener('click', (ev) => {
    const img = ev.target.closest('img[data-i]');
    if (img) openViewer(e.photos, Number(img.dataset.i));
  });
  $('#delBtn').onclick = async () => {
    if (!confirm(`确定删除「${nameOf(e)}」吗？删除后无法恢复。`)) return;
    await db.remove(e.id);
    invalidate();
    toast('已删除');
    goBack('#/timeline');
  };
}

/* ================= 回顾 ================= */
const rv = { q: '', type: 'all', min: 0, tags: new Set(), sort: 'new' };
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installPrompt = ev; });

function filterList(list) {
  const q = rv.q.trim().toLowerCase();
  let out = list.filter((e) => {
    if (rv.type !== 'all' && e.type !== rv.type) return false;
    if (rv.min && (e.rating || 0) < rv.min) return false;
    if (rv.tags.size && ![...rv.tags].every((t) => (e.tags || []).includes(t))) return false;
    if (q) {
      const hay = [e.name, e.request, e.actual, e.thoughts, ...(e.tags || [])].join('\n').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (rv.sort === 'rating') out = [...out].sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.datetime.localeCompare(a.datetime));
  return out;
}

async function viewReview(tagParam) {
  headerPlain('回顾');
  if (tagParam) {
    Object.assign(rv, { q: '', type: 'all', min: 0, sort: 'new' });
    rv.tags = new Set([tagParam]);
    history.replaceState(null, '', '#/review');
  }
  const list = await entries();
  const tags = allTags(list);
  const thisMonth = todayKey().slice(0, 7);
  const rated = list.filter((e) => e.rating);
  const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : '–';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  view.innerHTML = `
    <div class="card stats">
      <div><b>${list.length}</b><span>总记录</span></div>
      <div><b>${list.filter((e) => e.datetime.startsWith(thisMonth)).length}</b><span>本月</span></div>
      <div><b>${avg}</b><span>平均星级</span></div>
    </div>
    <div class="search"><input class="in" type="search" id="q" placeholder="搜索名称、要求、感想、标签…" value="${esc(rv.q)}" enterkeyhint="search"></div>
    <div class="quick">
      <button class="btn ghost" data-preset="top">★ 高分记录</button>
      <button class="btn ghost" data-preset="reset">清除筛选</button>
    </div>
    <div class="filter-row" id="fType"><span class="fl">类型</span>
      ${[['all', '全部'], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button class="chip" data-type="${k}">${l}</button>`).join('')}
    </div>
    <div class="filter-row" id="fMin"><span class="fl">评分</span>
      ${[[0, '全部'], [3, '★3 以上'], [4, '★4 以上'], [5, '★5']].map(([v, l]) => `<button class="chip" data-min="${v}">${l}</button>`).join('')}
    </div>
    ${tags.length ? `<div class="filter-row" id="fTags"><span class="fl">标签</span>${tags.map((t) => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="sort-row">
      <span class="count" id="count"></span>
      <div class="seg" id="fSort"><button data-sort="new">最新</button><button data-sort="rating">高分</button></div>
    </div>
    <div class="results" id="results"></div>

    <section class="card backup">
      <h3>数据备份</h3>
      <p>数据只保存在这台设备的浏览器里。换手机或清理浏览器前，记得导出备份（含照片）。</p>
      <div class="btns">
        <button class="btn ghost" id="expBtn">导出 JSON</button>
        <label class="btn ghost">导入 JSON<input type="file" accept="application/json,.json" id="impIn" hidden></label>
      </div>
      ${installPrompt ? '<button class="btn primary install" id="installBtn">添加到主屏幕</button>' : ''}
      <div class="info" id="storageInfo">${isIOS && !standalone ? '在 Safari 里点「分享」→「添加到主屏幕」，就能像 App 一样离线使用。<br>' : ''}</div>
    </section>`;

  const sync = () => {
    $$('#fType .chip').forEach((b) => b.classList.toggle('on', b.dataset.type === rv.type));
    $$('#fMin .chip').forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === rv.min));
    $$('#fTags .chip').forEach((b) => b.classList.toggle('on', rv.tags.has(b.dataset.tag)));
    $$('#fSort button').forEach((b) => b.classList.toggle('on', b.dataset.sort === rv.sort));
    const res = filterList(list);
    $('#count').textContent = `${res.length} 条记录`;
    $('#results').innerHTML = res.length
      ? res.map((e) => `<a href="#/entry/${e.id}">${rowCard(e, e.price != null ? ` · ${priceText(e.price)}` : '', true)}</a>`).join('')
      : `<div class="no-result">${list.length ? '没有符合条件的记录' : '还没有记录，先去记一笔吧'}</div>`;
  };

  $('#q').addEventListener('input', (ev) => { rv.q = ev.target.value; sync(); });
  view.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.type) rv.type = b.dataset.type;
    else if (b.dataset.min != null) rv.min = Number(b.dataset.min);
    else if (b.dataset.tag) { rv.tags.has(b.dataset.tag) ? rv.tags.delete(b.dataset.tag) : rv.tags.add(b.dataset.tag); }
    else if (b.dataset.sort) rv.sort = b.dataset.sort;
    else if (b.dataset.preset === 'top') { rv.min = 4; rv.sort = 'rating'; }
    else if (b.dataset.preset === 'reset') { Object.assign(rv, { q: '', type: 'all', min: 0, sort: 'new' }); rv.tags = new Set(); $('#q').value = ''; }
    else return;
    sync();
  };
  view.ontouchstart = view.ontouchend = null;
  sync();

  $('#expBtn').onclick = () => exportJSON().catch((err) => toast('导出失败：' + err.message));
  $('#impIn').onchange = (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (f) importJSON(f).catch((err) => toast('导入失败：' + err.message));
  };
  $('#installBtn')?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#installBtn')?.remove();
  });
  navigator.storage?.estimate?.().then(({ usage }) => {
    const el = $('#storageInfo');
    if (el && usage != null) el.insertAdjacentHTML('beforeend', `已使用约 ${(usage / 1048576).toFixed(1)} MB 存储空间`);
  });
}

/* ---------- 导出 / 导入 ---------- */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve(null);
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(s) {
  if (typeof s !== 'string' || !s.startsWith('data:')) return null;
  const [head, body] = s.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportJSON() {
  const list = await entries();
  if (!list.length) { toast('还没有可导出的记录'); return; }
  toast('正在打包…');
  const out = {
    app: 'parfait-diary',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: await Promise.all(list.map(async (e) => ({
      ...e,
      photos: await Promise.all((e.photos || []).map(async (p) => ({ full: await blobToDataURL(p.full), thumb: await blobToDataURL(p.thumb) }))),
    }))),
  };
  const filename = `parfait-diary-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`已导出 ${list.length} 条记录`);
}

function normalizeImported(e) {
  const dt = typeof e.datetime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.datetime) ? e.datetime.slice(0, 16) : toLocal(new Date());
  const price = e.price === '' || e.price == null ? null : Number(e.price);
  return {
    id: String(e.id || uid()),
    datetime: dt,
    name: String(e.name || ''),
    type: TYPES[e.type] ? e.type : 'order',
    photos: (Array.isArray(e.photos) ? e.photos : [])
      .map((p) => ({ full: dataURLToBlob(p?.full), thumb: dataURLToBlob(p?.thumb || p?.full) }))
      .filter((p) => p.full),
    request: String(e.request || ''),
    actual: String(e.actual || ''),
    rating: Math.max(0, Math.min(5, Math.round(Number(e.rating) || 0))),
    thoughts: String(e.thoughts || ''),
    tags: (Array.isArray(e.tags) ? e.tags : []).map(String).filter(Boolean),
    price: Number.isFinite(price) ? price : null,
    createdAt: Number(e.createdAt) || Date.now(),
    updatedAt: Number(e.updatedAt) || Date.now(),
  };
}

async function importJSON(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('这不是有效的备份文件'); return; }
  const arr = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(arr) || !arr.length) { toast('备份文件里没有记录'); return; }
  const existing = new Set((await entries()).map((e) => e.id));
  const dup = arr.filter((e) => existing.has(String(e.id))).length;
  if (!confirm(`将导入 ${arr.length} 条记录${dup ? `，其中 ${dup} 条与现有记录相同，会被覆盖` : ''}。继续吗？`)) return;
  await db.putMany(arr.map(normalizeImported));
  invalidate();
  requestPersist();
  toast(`已导入 ${arr.length} 条记录`);
  render();
}

/* ================= 启动 ================= */
if (!location.hash) history.replaceState(null, '', '#/timeline');
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
