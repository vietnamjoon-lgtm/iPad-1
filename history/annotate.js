// 본문 필기: 주제 화면의 본문 위에 바로 펜·형광펜으로 쓴다.
// 획은 가까운 문장·카드(앵커)에 붙여서 그 요소 안의 상대 위치로 저장한다.
// 그래서 화면을 돌리거나 O/X 해설이 펼쳐져서 글이 움직여도 필기가 그 문장을 따라간다.

import { drawStroke, fingerAllowed, setFinger, storeGet, storePut } from "./notes.js";

const PENS = [
  ["#1d1d1f", "검정 펜"],
  ["#0071e3", "파랑 펜"],
  ["#e30000", "빨강 펜"],
];
const HIGHLIGHTS = [
  ["#ffd60a", "노랑 형광펜"],
  ["#30d158", "초록 형광펜"],
  ["#ff6ab4", "분홍 형광펜"],
];
const SIZES = [
  { w: 2, hl: 14, label: "가늘게" },
  { w: 3.2, hl: 20, label: "보통" },
  { w: 5, hl: 28, label: "굵게" },
];
const ERASER_R = 12;
// 필기를 붙일 수 있는 본문 요소
const ANCHORS = ".topic-head, .block, .block > h3, .sec, .sec h4, .topic [data-key], .pager";

let article = null; // 지금 주제의 본문 (.topic)
let topicId = null;
let data = null; // { strokes: [{ t, c, w, a: 앵커, p: [x비율, y비율, 필압, ...] }] }
let layer = null;
let ink = null;
let live = null;
let on = false; // 필기 모드
let tool = { kind: "hl", color: HIGHLIGHTS[0][0] };
let sizeIndex = 1;
let undo = [];
let redo = [];
let current = null;
let activePointer = null;
let activeType = "";
let fingers = 0; // 화면에 닿아 있는 손가락 수 (펜슬 제외)
let anchors = new Map(); // 앵커 이름 → 요소
let observer = null;
let frame = 0;
let saveTimer = null;
let bar = null;

const keyOf = (id) => `ann-${id}`;

// ---------- 붙였다 떼기 ----------

export async function mountAnnotations(el, id) {
  unmountAnnotations();
  if (!el) return;
  article = el;
  topicId = id;
  article.classList.add("annotatable");
  layer = document.createElement("div");
  layer.className = "ann-layer";
  ink = document.createElement("canvas");
  live = document.createElement("canvas");
  layer.append(ink, live);
  article.append(layer);
  live.addEventListener("pointerdown", onDown);
  live.addEventListener("pointermove", onMove);
  live.addEventListener("pointerup", onUp);
  live.addEventListener("pointercancel", onUp);
  live.addEventListener("contextmenu", (e) => e.preventDefault());
  // 스크롤은 브라우저에 맡기고, 쓰는 중일 때만 막는다
  live.addEventListener("touchstart", onTouch, { passive: false });
  live.addEventListener("touchmove", onTouch, { passive: false });
  live.addEventListener("touchend", onTouch);
  live.addEventListener("touchcancel", onTouch);
  data = (await storeGet(keyOf(id))) || { topic: id, strokes: [] };
  if (article !== el) return; // 그 사이 다른 주제로 넘어감
  undo = [];
  redo = [];
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  });
  observer.observe(article);
  layout();
  setOn(on);
}

export function unmountAnnotations() {
  flushSave();
  if (observer) observer.disconnect();
  observer = null;
  if (layer) layer.remove();
  if (article) article.classList.remove("annotatable", "annotating");
  layer = ink = live = article = null;
  current = null;
  activePointer = null;
  fingers = 0;
  if (bar) bar.hidden = true;
}

export function toggleAnnotate() {
  setOn(!on);
}

function setOn(value) {
  on = value;
  if (!article) return;
  article.classList.toggle("annotating", on);
  buildBar();
  bar.hidden = !on;
  document.body.classList.toggle("annotating", on);
  const btn = article.querySelector(".ann-btn");
  if (btn) {
    btn.textContent = on ? "✍️ 필기 끝내기" : "✍️ 본문에 필기";
    btn.setAttribute("aria-pressed", on);
  }
  updateBar();
}

// ---------- 위치 계산 ----------

function anchorName(el, i) {
  if (el.dataset.key) return el.dataset.key;
  if (el.classList.contains("topic-head")) return "head";
  if (el.classList.contains("pager")) return "pager";
  return `${el.tagName.toLowerCase()}-${i}`;
}

function rectIn(el) {
  const a = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - a.left, y: r.top - a.top, w: r.width || 1, h: r.height || 1 };
}

function layout() {
  if (!article) return;
  anchors = new Map();
  [...article.querySelectorAll(ANCHORS)].forEach((el, i) => anchors.set(anchorName(el, i), el));
  const w = article.clientWidth;
  const h = article.clientHeight;
  layer.style.width = `${w}px`;
  layer.style.height = `${h}px`;
  // 본문이 길어도 아이패드 사파리가 그릴 수 있게 캔버스 픽셀 수를 제한한다
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(7e6 / (w * h)));
  for (const c of [ink, live]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  redraw();
}

// 저장된 상대 위치 → 지금 화면의 본문 좌표
function absolute(s) {
  const el = s.a === "_article" ? article : anchors.get(s.a);
  if (!el) return null;
  const r = s.a === "_article" ? { x: 0, y: 0, w: article.clientWidth, h: article.clientHeight } : rectIn(el);
  const p = [];
  for (let i = 0; i < s.p.length; i += 3) p.push(r.x + s.p[i] * r.w, r.y + s.p[i + 1] * r.h, s.p[i + 2]);
  return { t: s.t, c: s.c, w: s.w, p };
}

function clear(c) {
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.restore();
}

function redraw() {
  clear(ink);
  clear(live);
  const ctx = ink.getContext("2d");
  for (const s of data.strokes) {
    s._abs = absolute(s);
    if (s._abs) drawStroke(ctx, s._abs);
  }
}

// 획 첫 점을 감싸는 가장 작은 본문 요소에 붙인다
function attach(stroke) {
  const [x, y] = stroke.p;
  let best = null;
  let bestArea = Infinity;
  for (const [name, el] of anchors) {
    const r = rectIn(el);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && r.w * r.h < bestArea) {
      best = { name, r };
      bestArea = r.w * r.h;
    }
  }
  const r = best ? best.r : { x: 0, y: 0, w: article.clientWidth, h: article.clientHeight };
  const rel = [];
  for (let i = 0; i < stroke.p.length; i += 3) {
    rel.push(round4((stroke.p[i] - r.x) / r.w), round4((stroke.p[i + 1] - r.y) / r.h), stroke.p[i + 2]);
  }
  return { t: stroke.t, c: stroke.c, w: stroke.w, a: best ? best.name : "_article", p: rel };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

// ---------- 입력 ----------

function pointIn(e) {
  const a = layer.getBoundingClientRect();
  const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
  return [Math.round((e.clientX - a.left) * 10) / 10, Math.round((e.clientY - a.top) * 10) / 10, Math.round(pressure * 100) / 100];
}

// ---------- 손가락: 펜슬만 쓰기일 때는 한 손가락, 아니면 두 손가락으로 스크롤 ----------
// 아이패드 사파리는 터치 이벤트를 막아야만 스크롤이 멈추므로, 쓰는 중일 때만 막는다.

const isStylus = (t) => t.touchType === "stylus";

function onTouch(e) {
  const all = [...e.touches];
  fingers = all.filter((t) => !isStylus(t)).length;
  if (e.type === "touchend" || e.type === "touchcancel") return;
  // 두 번째 손가락이 닿으면 한 손가락으로 쓰던 획은 취소하고 스크롤에 맡긴다
  if (fingers >= 2 && activeType === "touch") cancelStroke();
  const stylus = all.some(isStylus) || [...e.changedTouches].some(isStylus);
  if (stylus || activeType === "pen") e.preventDefault();
  else if (e.type === "touchmove" && activeType === "touch" && fingers === 1) e.preventDefault();
}

function onDown(e) {
  if (!on) return;
  if (e.pointerType === "touch" && (!fingerAllowed() || fingers >= 2 || !e.isPrimary)) return;
  if (activePointer !== null) return;
  if (e.pointerType === "pen" && fingerAllowed() && !onDown.noticed) {
    onDown.noticed = true;
    setFinger(false);
    toast("펜슬이 감지돼서 손가락으로는 화면을 움직이게 했어요. 아래 ✋ 버튼으로 바꿀 수 있어요.");
    updateBar();
  }
  if (e.pointerType !== "touch") e.preventDefault();
  activePointer = e.pointerId;
  activeType = e.pointerType;
  try {
    live.setPointerCapture(e.pointerId);
  } catch {}
  const pt = pointIn(e);
  if (tool.kind === "eraser" || (e.pointerType === "pen" && e.buttons & 32)) {
    current = { erase: true, removed: false };
    eraseAt(pt);
    return;
  }
  const size = SIZES[sizeIndex];
  current = tool.kind === "hl" ? { t: "hl", c: tool.color, w: size.hl, p: [...pt] } : { t: "pen", c: tool.color, w: size.w, p: [...pt] };
  drawLive();
}

function onMove(e) {
  if (e.pointerId !== activePointer || !current) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) {
    const pt = pointIn({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: e.pointerType });
    if (current.erase) eraseAt(pt);
    else {
      const p = current.p;
      if (Math.hypot(pt[0] - p[p.length - 3], pt[1] - p[p.length - 2]) >= 1) p.push(...pt);
    }
  }
  if (!current.erase) drawLive();
}

function onUp(e) {
  if (e.pointerId !== activePointer) return;
  // 브라우저가 스크롤을 시작하면 손가락 획은 취소된다
  if (e.type === "pointercancel" && activeType === "touch") return cancelStroke();
  activePointer = null;
  activeType = "";
  const s = current;
  current = null;
  clear(live);
  if (!s) return;
  if (s.erase) {
    if (s.removed) changed();
    return;
  }
  snapshot();
  const saved = attach(s);
  data.strokes = [...data.strokes, saved];
  saved._abs = absolute(saved);
  if (saved._abs) drawStroke(ink.getContext("2d"), saved._abs);
  scheduleSave();
  updateBar();
}

function cancelStroke() {
  activePointer = null;
  activeType = "";
  current = null;
  clear(live);
}

function drawLive() {
  clear(live);
  drawStroke(live.getContext("2d"), current);
}

function segDist(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function hits(abs, x, y) {
  if (!abs) return false;
  const p = abs.p;
  const r = ERASER_R + abs.w / 2;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= r;
  for (let i = 3; i < p.length; i += 3) if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= r) return true;
  return false;
}

function eraseAt([x, y]) {
  const keep = data.strokes.filter((s) => !hits(s._abs, x, y));
  if (keep.length === data.strokes.length) return;
  if (!current.removed) snapshot();
  current.removed = true;
  data.strokes = keep;
  redraw();
}

// ---------- 되돌리기·저장 ----------

function snapshot() {
  undo.push(data.strokes.slice());
  if (undo.length > 80) undo.shift();
  redo = [];
}

function changed() {
  redraw();
  scheduleSave();
  updateBar();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

function flushSave() {
  if (!saveTimer || !data) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const clean = { topic: data.topic, updated: Date.now(), strokes: data.strokes.map(({ t, c, w, a, p }) => ({ t, c, w, a, p })) };
  storePut(keyOf(data.topic), clean.strokes.length ? clean : null);
}

// ---------- 도구 막대 ----------

function buildBar() {
  if (bar) return;
  bar = document.createElement("div");
  bar.className = "ann-bar";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "본문 필기 도구");
  bar.innerHTML = `
    ${PENS.map(([c, label]) => `<button type="button" class="ab tool" data-ann="pen" data-color="${c}" aria-label="${label}"><i style="background:${c}"></i></button>`).join("")}
    ${HIGHLIGHTS.map(([c, label]) => `<button type="button" class="ab tool" data-ann="hl" data-color="${c}" aria-label="${label}"><i class="hl" style="background:${c}"></i></button>`).join("")}
    <button type="button" class="ab tool" data-ann="eraser" aria-label="지우개">⌫</button>
    <button type="button" class="ab" data-ann="size" aria-label="굵기"></button>
    <button type="button" class="ab" data-ann="undo" aria-label="되돌리기">↶</button>
    <button type="button" class="ab" data-ann="redo" aria-label="다시 하기">↷</button>
    <button type="button" class="ab" data-ann="finger"></button>
    <button type="button" class="ab" data-ann="clear" aria-label="이 주제 본문 필기 모두 지우기">🗑</button>
    <button type="button" class="ab done" data-ann="done">완료</button>
    <div class="ann-toast" hidden></div>`;
  document.body.append(bar);
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ann]");
    if (!b || !data) return;
    const act = b.dataset.ann;
    if (act === "pen" || act === "hl") tool = { kind: act, color: b.dataset.color };
    else if (act === "eraser") tool = { kind: "eraser" };
    else if (act === "size") sizeIndex = (sizeIndex + 1) % SIZES.length;
    else if (act === "undo" && undo.length) {
      redo.push(data.strokes);
      data.strokes = undo.pop();
      changed();
    } else if (act === "redo" && redo.length) {
      undo.push(data.strokes);
      data.strokes = redo.pop();
      changed();
    } else if (act === "finger") setFinger(!fingerAllowed());
    else if (act === "clear" && data.strokes.length) {
      if (!confirm("이 주제 본문에 쓴 필기를 모두 지울까요?")) return;
      snapshot();
      data.strokes = [];
      changed();
    } else if (act === "done") return setOn(false);
    updateBar();
  });
}

function updateBar() {
  if (!bar) return;
  for (const b of bar.querySelectorAll(".tool")) {
    const sel = b.dataset.ann === tool.kind && (tool.kind === "eraser" || b.dataset.color === tool.color);
    b.classList.toggle("on", sel);
    b.setAttribute("aria-pressed", sel);
  }
  bar.querySelector('[data-ann="size"]').textContent = SIZES[sizeIndex].label;
  bar.querySelector('[data-ann="undo"]').disabled = !undo.length;
  bar.querySelector('[data-ann="redo"]').disabled = !redo.length;
  const finger = fingerAllowed();
  const fb = bar.querySelector('[data-ann="finger"]');
  fb.textContent = finger ? "✋ 손가락 필기" : "✋ 손가락=스크롤";
  fb.setAttribute("aria-label", finger ? "손가락으로도 필기 (누르면 손가락은 스크롤)" : "손가락은 스크롤 (누르면 손가락으로도 필기)");
}

function toast(text) {
  const t = bar && bar.querySelector(".ann-toast");
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}
