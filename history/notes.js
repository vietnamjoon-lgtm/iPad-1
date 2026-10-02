// 필기 노트: 주제마다 애플펜슬(또는 손가락)로 쓰는 노트.
// 획은 벡터(점 목록)로 이 기기의 IndexedDB에 저장해서, 화면 크기가 바뀌어도 선명하게 다시 그린다.

const PAGE_W = 1000; // 종이의 논리 크기 (화면에 맞춰 늘이거나 줄여서 보여 준다)
const PAGE_H = 1300;
const LINE_GAP = 50; // 줄 간격
const ERASER_R = 14;
const PENS = [
  { key: "black", color: "#1d1d1f", label: "검정 펜" },
  { key: "blue", color: "#0071e3", label: "파랑 펜" },
  { key: "red", color: "#e30000", label: "빨강 펜" },
];
const HIGHLIGHT = "#ffd60a";
const SIZES = [
  { w: 2.2, label: "가늘게" },
  { w: 3.6, label: "보통" },
  { w: 6, label: "굵게" },
];
const FINGER_KEY = "history2-note-finger"; // "on" | "off" (펜슬을 한 번 쓰면 자동으로 off)

// ---------- 저장소 (IndexedDB, 안 되면 메모리) ----------

const memory = new Map();
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("history2-notes", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("notes");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function request(mode, run) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const req = run(d.transaction("notes", mode).objectStore("notes"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

async function loadNote(id) {
  try {
    return (await request("readonly", (s) => s.get(id))) || memory.get(id) || null;
  } catch {
    return memory.get(id) || null;
  }
}

async function saveNote(note) {
  memory.set(note.topic, note);
  try {
    if (hasInk(note)) await request("readwrite", (s) => s.put(note, note.topic));
    else await request("readwrite", (s) => s.delete(note.topic));
  } catch {}
}

// 본문 필기 등 다른 기능도 같은 저장소를 쓴다
export async function storeGet(key) {
  try {
    return (await request("readonly", (s) => s.get(key))) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function storePut(key, value) {
  memory.set(key, value);
  try {
    if (value) await request("readwrite", (s) => s.put(value, key));
    else await request("readwrite", (s) => s.delete(key));
  } catch {}
}

export async function listNotes() {
  try {
    const all = await request("readonly", (s) => s.getAll());
    return all.filter(hasInk);
  } catch {
    return [...memory.values()].filter(hasInk);
  }
}

const hasInk = (note) => !!note && Array.isArray(note.pages) && note.pages.some((p) => p.length);

// ---------- 그리기 ----------

export function drawStroke(ctx, s) {
  const p = s.p;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  if (s.t === "hl") {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    if (p.length === 3) ctx.lineTo(p[0] + 0.1, p[1]);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  } else if (p.length === 3) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], (s.w * widthFactor(p[2])) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 점 사이를 중간점 기준 곡선으로 이어서 부드럽게, 굵기는 필압에 따라
    let mx = p[0];
    let my = p[1];
    for (let i = 3; i < p.length; i += 3) {
      const nx = (p[i - 3] + p[i]) / 2;
      const ny = (p[i - 2] + p[i + 1]) / 2;
      ctx.lineWidth = s.w * widthFactor(p[i + 2]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo(p[i - 3], p[i - 2], nx, ny);
      ctx.stroke();
      mx = nx;
      my = ny;
    }
    const last = p.length - 3;
    ctx.lineWidth = s.w * widthFactor(p[last + 2]);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(p[last], p[last + 1]);
    ctx.stroke();
  }
  ctx.restore();
}

const widthFactor = (pressure) => 0.35 + pressure * 1.1;

function drawLines(ctx) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = "#e5e5ea";
  ctx.lineWidth = 1.2;
  for (let y = LINE_GAP * 2; y < PAGE_H - 20; y += LINE_GAP) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(PAGE_W - 40, y);
    ctx.stroke();
  }
}

// 쪽 하나를 이미지로 (목록 미리보기, 저장용)
function renderPage(strokes, width, lines) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((width * PAGE_H) / PAGE_W);
  const ctx = c.getContext("2d");
  ctx.scale(width / PAGE_W, width / PAGE_W);
  if (lines) drawLines(ctx);
  else {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  }
  for (const s of strokes) drawStroke(ctx, s);
  return c;
}

export function thumbnail(note, width = 240) {
  return renderPage(note.pages[0] || [], width, false);
}

// 점 (x, y)와 선분 사이 거리
function segDist(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function hits(s, x, y) {
  const p = s.p;
  const r = ERASER_R + s.w / 2;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= r;
  for (let i = 3; i < p.length; i += 3) {
    if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= r) return true;
  }
  return false;
}

// ---------- 화면 ----------

let el = null; // 노트 화면 요소들
let note = null; // { topic, pages: [[stroke]], updated }
let pageIndex = 0;
let tool = "pen"; // "pen" | "hl" | "eraser"
let penColor = PENS[0].color;
let sizeIndex = 1;
let undo = [];
let redo = [];
let current = null; // 그리는 중인 획
let activePointer = null;
let activeType = "";
let zoom = 1; // 종이 확대 배율 (1 = 메모장에 꼭 맞게)
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const touches = new Map(); // 화면에 닿아 있는 손가락들 (두 손가락 확대·이동용)
let gesture = null;
let saveTimer = null;
let scale = 1;
let onClose = null;

export function fingerAllowed() {
  try {
    return localStorage.getItem(FINGER_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setFinger(on) {
  try {
    localStorage.setItem(FINGER_KEY, on ? "on" : "off");
  } catch {}
  if (el && note) updateBar();
}

function build() {
  el = document.createElement("div");
  el.className = "note";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "필기 노트");
  el.innerHTML = `
    <div class="note-grip" title="끌어서 옮기기" aria-label="메모장 옮기기"></div>
    <div class="note-bar">
      <button type="button" class="nb" data-note="close" aria-label="노트 닫기">✕</button>
      <span class="note-title"></span>
      <button type="button" class="nb" data-note="side" aria-pressed="false" aria-label="핵심 정리 같이 보기">📖 정리</button>
      <span class="nb-sep"></span>
      ${PENS.map((p) => `<button type="button" class="nb tool" data-note="pen" data-color="${p.color}" aria-label="${p.label}"><i style="background:${p.color}"></i></button>`).join("")}
      <button type="button" class="nb tool" data-note="hl" aria-label="형광펜"><i class="hl" style="background:${HIGHLIGHT}"></i></button>
      <button type="button" class="nb tool" data-note="eraser" aria-label="지우개">⌫</button>
      <button type="button" class="nb" data-note="size" aria-label="굵기"></button>
      <span class="nb-sep"></span>
      <button type="button" class="nb" data-note="undo" aria-label="되돌리기">↶</button>
      <button type="button" class="nb" data-note="redo" aria-label="다시 하기">↷</button>
      <span class="nb-sep"></span>
      <button type="button" class="nb" data-note="prev" aria-label="이전 쪽">‹</button>
      <span class="note-page"></span>
      <button type="button" class="nb" data-note="next" aria-label="다음 쪽">›</button>
      <button type="button" class="nb" data-note="add" aria-label="새 쪽 추가">＋쪽</button>
      <span class="nb-sep"></span>
      <button type="button" class="nb" data-note="zoom-out" aria-label="축소">－</button>
      <button type="button" class="nb zoom-label" data-note="zoom-reset" aria-label="원래 크기로">100%</button>
      <button type="button" class="nb" data-note="zoom-in" aria-label="확대">＋</button>
      <span class="nb-sep"></span>
      <button type="button" class="nb" data-note="finger" aria-pressed="true"></button>
      <button type="button" class="nb" data-note="clear" aria-label="이 쪽 모두 지우기">🗑</button>
      <button type="button" class="nb" data-note="export" aria-label="이미지로 저장">저장</button>
      <button type="button" class="nb" data-note="reset" aria-label="메모장을 원래 자리·크기로">↺ 제자리</button>
      <button type="button" class="nb" data-note="mode"></button>
    </div>
    <div class="note-main">
      <aside class="note-side" hidden></aside>
      <div class="note-stage">
        <div class="note-paper">
          <canvas class="nc-bg"></canvas>
          <canvas class="nc-ink"></canvas>
          <canvas class="nc-live"></canvas>
        </div>
      </div>
    </div>
    <div class="note-toast" hidden></div>
    <div class="note-resize" title="끌어서 크기 조절" aria-label="메모장 크기 조절"></div>`;
  document.body.append(el);

  el.querySelector(".note-bar").addEventListener("click", onBar);
  const live = el.querySelector(".nc-live");
  live.addEventListener("pointerdown", onDown);
  live.addEventListener("pointermove", onMove);
  live.addEventListener("pointerup", onUp);
  live.addEventListener("pointercancel", onUp);
  // 아이패드에서 길게 누를 때 확대경·메뉴가 뜨지 않게
  live.addEventListener("contextmenu", (e) => e.preventDefault());
  el.querySelector(".note-stage").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY / 200), { x: e.clientX, y: e.clientY });
    },
    { passive: false },
  );
  el.querySelector(".note-grip").addEventListener("pointerdown", (e) => startDrag(e, "move"));
  el.querySelector(".note-resize").addEventListener("pointerdown", (e) => startDrag(e, "size"));
  window.addEventListener("resize", () => {
    if (float) applyFloat();
  });
  // 창 크기·노트 크기가 바뀌면 종이를 다시 맞춘다
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => !el.hidden && layout());
  }).observe(el.querySelector(".note-stage"));
}

// mode: "dock" = 본문 옆(세로 화면에서는 아래)에 붙는 작은 메모장, "full" = 화면 가득
let mode = "dock";

export async function openNote(topicId, { label, title, sideHTML }, closeCallback) {
  if (!el) build();
  onClose = closeCallback || null;
  if (note && noteIsOpen()) flushSave();
  note = (await loadNote(topicId)) || { topic: topicId, pages: [[]], updated: 0 };
  zoom = 1;
  pageIndex = 0;
  undo = [];
  redo = [];
  el.querySelector(".note-title").textContent = `${label} · ${title}`;
  el.querySelector(".note-side").innerHTML = sideHTML || "";
  el.hidden = false;
  setMode(mode);
}

function setMode(m) {
  mode = m;
  const full = m === "full";
  el.classList.toggle("dock", !full);
  if (full) el.setAttribute("aria-modal", "true");
  else el.removeAttribute("aria-modal");
  document.body.classList.toggle("noting", full);
  if (!full) el.querySelector(".note-side").hidden = true;
  applyFloat();
  layout();
  updateBar();
}

// ---------- 작은 메모장 옮기기·크기 조절 ----------
// float: 사용자가 정한 자리와 크기 {x, y, w, h} (없으면 기본 자리: 오른쪽 또는 아래에 붙음)

const FLOAT_KEY = "history2-note-float";
const MIN_W = 240;
const MIN_H = 260;
let float = loadFloat();

function loadFloat() {
  try {
    const f = JSON.parse(localStorage.getItem(FLOAT_KEY));
    return f && ["x", "y", "w", "h"].every((k) => Number.isFinite(f[k])) ? f : null;
  } catch {
    return null;
  }
}

function saveFloat() {
  try {
    if (float) localStorage.setItem(FLOAT_KEY, JSON.stringify(float));
    else localStorage.removeItem(FLOAT_KEY);
  } catch {}
}

// 화면 밖으로 나가지 않게 맞춘다
function clampFloat() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  float.w = Math.min(Math.max(float.w, MIN_W), vw - 16);
  float.h = Math.min(Math.max(float.h, MIN_H), vh - 16);
  float.x = Math.min(Math.max(float.x, 8), vw - float.w - 8);
  float.y = Math.min(Math.max(float.y, 8), vh - float.h - 8);
}

function applyFloat() {
  const floating = mode === "dock" && !!float;
  el.classList.toggle("floating", floating);
  // 기본 자리일 때만 본문이 메모장 자리를 비켜 준다
  document.body.classList.toggle("note-docked", mode === "dock" && !float);
  if (floating) {
    clampFloat();
    Object.assign(el.style, { left: `${float.x}px`, top: `${float.y}px`, width: `${float.w}px`, height: `${float.h}px`, right: "auto", bottom: "auto" });
  } else {
    for (const k of ["left", "top", "width", "height", "right", "bottom"]) el.style[k] = "";
  }
  if (el.querySelector('[data-note="reset"]')) el.querySelector('[data-note="reset"]').hidden = !floating;
}

function startDrag(e, kind) {
  if (mode !== "dock") return;
  e.preventDefault();
  const handle = e.currentTarget;
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {}
  const r = el.getBoundingClientRect();
  float = { x: r.left, y: r.top, w: r.width, h: r.height };
  const start = { px: e.clientX, py: e.clientY, ...float };
  el.classList.add("dragging");
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const dx = ev.clientX - start.px;
    const dy = ev.clientY - start.py;
    if (kind === "move") {
      float.x = start.x + dx;
      float.y = start.y + dy;
    } else {
      float.w = start.w + dx;
      float.h = start.h + dy;
    }
    applyFloat();
  };
  const end = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    el.classList.remove("dragging");
    saveFloat();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  applyFloat();
}

export const noteIsOpen = () => !!el && !el.hidden;
export const noteIsFull = () => noteIsOpen() && mode === "full";
export const noteTopic = () => (noteIsOpen() && note ? note.topic : null);

export function closeNote() {
  if (!noteIsOpen()) return;
  flushSave();
  el.hidden = true;
  document.body.classList.remove("noting", "note-docked");
  if (onClose) onClose();
}

const strokes = () => note.pages[pageIndex];

function layout() {
  const stage = el.querySelector(".note-stage");
  const paper = el.querySelector(".note-paper");
  const availW = stage.clientWidth - 24;
  const availH = stage.clientHeight - 24;
  const fit = Math.max(200, Math.min(availW, (availH * PAGE_W) / PAGE_H));
  const w = fit * zoom;
  const h = (w * PAGE_H) / PAGE_W;
  paper.style.width = `${w}px`;
  paper.style.height = `${h}px`;
  scale = w / PAGE_W;
  // 아이패드 사파리는 캔버스가 너무 크면 그리지 못하므로 픽셀 수를 제한한다
  const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(8e6 / (w * h)));
  for (const c of paper.querySelectorAll("canvas")) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext("2d").setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  drawLines(paper.querySelector(".nc-bg").getContext("2d"));
  redraw();
}

// focus(화면 좌표) 아래의 종이 위치가 그대로 있도록 확대·축소한다
function setZoom(z, focus) {
  z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  if (Math.abs(z - zoom) < 0.001) return;
  const stage = el.querySelector(".note-stage");
  const paper = el.querySelector(".note-paper");
  const sr = stage.getBoundingClientRect();
  const fx = focus ? focus.x : sr.left + sr.width / 2;
  const fy = focus ? focus.y : sr.top + sr.height / 2;
  const before = paper.getBoundingClientRect();
  const lx = (fx - before.left) / scale;
  const ly = (fy - before.top) / scale;
  zoom = z;
  layout();
  const after = paper.getBoundingClientRect();
  stage.scrollLeft += after.left + lx * scale - fx;
  stage.scrollTop += after.top + ly * scale - fy;
  updateBar();
}

function ctxOf(cls) {
  return el.querySelector(cls).getContext("2d");
}

function clearCtx(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function redraw() {
  const ctx = ctxOf(".nc-ink");
  clearCtx(ctx);
  for (const s of strokes()) drawStroke(ctx, s);
  clearCtx(ctxOf(".nc-live"));
}

function updateBar() {
  const bar = el.querySelector(".note-bar");
  for (const b of bar.querySelectorAll(".tool")) {
    const on = b.dataset.note === tool && (tool !== "pen" || b.dataset.color === penColor);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  }
  bar.querySelector('[data-note="size"]').textContent = SIZES[sizeIndex].label;
  bar.querySelector(".note-page").textContent = `${pageIndex + 1} / ${note.pages.length}`;
  bar.querySelector('[data-note="prev"]').disabled = pageIndex === 0;
  bar.querySelector('[data-note="next"]').disabled = pageIndex === note.pages.length - 1;
  bar.querySelector('[data-note="undo"]').disabled = undo.length === 0;
  bar.querySelector('[data-note="redo"]').disabled = redo.length === 0;
  const finger = fingerAllowed();
  const fb = bar.querySelector('[data-note="finger"]');
  fb.textContent = finger ? "✋ 손가락 켬" : "✏️ 펜슬만";
  fb.setAttribute("aria-label", finger ? "손가락으로도 쓰기 (누르면 펜슬로만)" : "펜슬로만 쓰기 (누르면 손가락도)");
  fb.setAttribute("aria-pressed", finger);
  bar.querySelector(".zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  bar.querySelector('[data-note="zoom-out"]').disabled = zoom <= ZOOM_MIN;
  bar.querySelector('[data-note="zoom-in"]').disabled = zoom >= ZOOM_MAX;
  const mb = bar.querySelector('[data-note="mode"]');
  mb.textContent = mode === "full" ? "⤡ 작게" : "⤢ 크게";
  mb.setAttribute("aria-label", mode === "full" ? "작은 메모장으로" : "크게 펼치기");
  const side = !el.querySelector(".note-side").hidden;
  bar.querySelector('[data-note="side"]').setAttribute("aria-pressed", side);
}

function toast(text) {
  const t = el.querySelector(".note-toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function onBar(e) {
  const b = e.target.closest("[data-note]");
  if (!b) return;
  const act = b.dataset.note;
  if (act === "close") return closeNote();
  if (act === "mode") return setMode(mode === "full" ? "dock" : "full");
  if (act === "zoom-in") return setZoom(zoom * 1.25);
  if (act === "zoom-out") return setZoom(zoom / 1.25);
  if (act === "zoom-reset") return setZoom(1);
  if (act === "reset") {
    float = null;
    saveFloat();
    applyFloat();
    return;
  }
  if (act === "side") {
    const side = el.querySelector(".note-side");
    side.hidden = !side.hidden;
    layout();
  } else if (act === "pen") {
    tool = "pen";
    penColor = b.dataset.color;
  } else if (act === "hl" || act === "eraser") {
    tool = act;
  } else if (act === "size") {
    sizeIndex = (sizeIndex + 1) % SIZES.length;
  } else if (act === "undo" && undo.length) {
    redo.push(strokes());
    note.pages[pageIndex] = undo.pop();
    changed();
  } else if (act === "redo" && redo.length) {
    undo.push(strokes());
    note.pages[pageIndex] = redo.pop();
    changed();
  } else if (act === "prev" && pageIndex > 0) {
    goPage(pageIndex - 1);
  } else if (act === "next" && pageIndex < note.pages.length - 1) {
    goPage(pageIndex + 1);
  } else if (act === "add") {
    note.pages.splice(pageIndex + 1, 0, []);
    goPage(pageIndex + 1);
    scheduleSave();
  } else if (act === "finger") {
    setFinger(!fingerAllowed());
  } else if (act === "clear" && strokes().length) {
    snapshot();
    note.pages[pageIndex] = [];
    changed();
  } else if (act === "export") {
    exportPage();
  }
  updateBar();
}

function goPage(i) {
  pageIndex = i;
  undo = [];
  redo = [];
  redraw();
}

// 바꾸기 전 상태를 되돌리기 목록에 넣는다 (획 배열은 바꾸지 않고 새로 만들기 때문에 얕은 복사로 충분)
function snapshot() {
  undo.push(strokes().slice());
  if (undo.length > 80) undo.shift();
  redo = [];
}

function changed() {
  redraw();
  scheduleSave();
  updateBar();
}

function scheduleSave() {
  note.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNote(note);
  }, 400);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNote(note);
  }
}

// ---------- 펜 입력 ----------

function point(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / scale;
  const y = (e.clientY - r.top) / scale;
  const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100];
}

// ---------- 손가락: 두 손가락 = 확대·이동, 펜슬만 쓰기일 때는 한 손가락 = 이동 ----------

function touchPoints() {
  return [...touches.values()];
}

function startGesture() {
  const pts = touchPoints();
  const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  gesture = { mid, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, zoom };
}

// 한 손가락으로 쓰던 획은 두 번째 손가락이 닿으면 취소한다 (확대하려던 것)
function cancelTouchStroke() {
  if (activePointer !== null && activeType === "touch") {
    activePointer = null;
    current = null;
    clearCtx(ctxOf(".nc-live"));
  }
}

let gestureFrame = 0;
function moveGesture() {
  const stage = el.querySelector(".note-stage");
  const pts = touchPoints();
  const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  stage.scrollLeft -= mid.x - gesture.mid.x;
  stage.scrollTop -= mid.y - gesture.mid.y;
  gesture.mid = mid;
  if (pts.length > 1 && gesture.dist) {
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const z = gesture.zoom * (d / gesture.dist);
    cancelAnimationFrame(gestureFrame);
    gestureFrame = requestAnimationFrame(() => setZoom(z, mid));
  }
}

function onDown(e) {
  if (e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (touches.size >= 2 || !fingerAllowed()) {
      e.preventDefault();
      cancelTouchStroke();
      startGesture();
      return;
    }
  }
  if (activePointer !== null) return;
  if (e.pointerType === "pen" && fingerAllowed() && !onDown.penNoticed) {
    // 펜슬을 처음 쓰면 손바닥이 닿아도 선이 그어지지 않게 손가락 필기를 끈다
    onDown.penNoticed = true;
    setFinger(false);
    toast("펜슬이 감지돼서 손바닥이 닿아도 안 그려지게 했어요. 위 ✏️ 버튼으로 바꿀 수 있어요.");
  }
  e.preventDefault();
  activePointer = e.pointerId;
  activeType = e.pointerType;
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {}
  const eraser = tool === "eraser" || (e.pointerType === "pen" && e.buttons & 32);
  if (eraser) {
    current = { erase: true, removed: false };
    eraseAt(point(e));
    return;
  }
  current = tool === "hl" ? { t: "hl", c: HIGHLIGHT, w: 22, p: [] } : { t: "pen", c: penColor, w: SIZES[sizeIndex].w, p: [] };
  current.p.push(...point(e));
  drawLive();
}

function onMove(e) {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && touches.has(e.pointerId)) return moveGesture();
  if (e.pointerId !== activePointer || !current) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    const pt = point({ ...pick(ev), currentTarget: e.currentTarget, pointerType: e.pointerType });
    if (current.erase) eraseAt(pt);
    else {
      const p = current.p;
      const n = p.length;
      // 거의 같은 자리의 점은 건너뛴다
      if (Math.hypot(pt[0] - p[n - 3], pt[1] - p[n - 2]) >= 1.2) p.push(...pt);
    }
  }
  if (!current.erase) drawLive();
}

const pick = (ev) => ({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure });

function onUp(e) {
  if (touches.delete(e.pointerId) && gesture) {
    // 손가락이 남아 있으면 그 손가락으로 계속 이동, 다 떼면 끝
    if (touches.size) startGesture();
    else gesture = null;
    return;
  }
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  const s = current;
  current = null;
  if (!s) return;
  if (s.erase) {
    if (s.removed) changed();
    return;
  }
  snapshot();
  note.pages[pageIndex] = [...strokes(), s];
  drawStroke(ctxOf(".nc-ink"), s);
  clearCtx(ctxOf(".nc-live"));
  scheduleSave();
  updateBar();
}

function drawLive() {
  const ctx = ctxOf(".nc-live");
  clearCtx(ctx);
  drawStroke(ctx, current);
}

function eraseAt([x, y]) {
  const keep = strokes().filter((s) => !hits(s, x, y));
  if (keep.length === strokes().length) return;
  if (!current.removed) snapshot();
  current.removed = true;
  note.pages[pageIndex] = keep;
  redraw();
}

// ---------- 내보내기 ----------

function exportPage() {
  const canvas = renderPage(strokes(), 2000, true);
  const name = `한국사2_${el.querySelector(".note-title").textContent.split(" · ")[0].replace(/\s/g, "")}_${pageIndex + 1}쪽.png`;
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], name, { type: "image/png" });
    // 아이패드는 공유 시트로 사진·파일에 저장할 수 있다
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, "image/png");
}
