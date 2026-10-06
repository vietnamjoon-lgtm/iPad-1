// 과목 공부 화면: 단원 학습 · 연표 · 용어 사전 · 비교 정리 · 퀴즈 · 노트 · 자료실과 키워드 검색.
// 과목 내용은 <html data-subject="폴더">의 data.js에 있고, 이 파일은 화면만 그린다.
// (한국사2: history/data.js, 통합사회2: society/data.js)

import { openNote, closeNote, noteIsFull, noteTopic, listNotes, thumbnail, setStore } from "./notes.js";
import { mountAnnotations, unmountAnnotations, toggleAnnotate } from "./annotate.js";

const SUBJECT_DIR = document.documentElement.dataset.subject || "history";
const { UNITS, TOPICS, COMPARE, LINKS, SUGGEST, SUBJECT } = await import(`../${SUBJECT_DIR}/data.js`);
setStore(SUBJECT.store, SUBJECT.name);

const $ = (id) => document.getElementById(id);
const view = $("view");
const resultsBox = $("results");
const input = $("q");

// ---------- 데이터 준비 ----------

const pad = (n) => String(n).padStart(2, "0");
const topicById = new Map(TOPICS.map((tp) => [tp.id, tp]));
const unitOf = new Map();
for (const u of UNITS) for (const id of u.topics) unitOf.set(id, u);

// "1919.3.1" → 19190301 (정렬용). 연도만 있으면 그해 맨 앞에 온다.
function dateKey(date) {
  const [y, m = 0, d = 0] = date.split(".").map(Number);
  return y * 10000 + m * 100 + d;
}

const TERMS = [];
const EVENTS = [];
const OXS = [];
for (const tp of TOPICS) {
  // a: 같은 뜻의 다른 이름(화면에 보여 줌), s: 검색에만 쓰는 관련어
  tp.terms.forEach((x, i) => TERMS.push({ ...x, a: x.a || [], s: x.s || [], topic: tp.id, key: `t${tp.id}-${i}` }));
  tp.events.forEach(([date, text], i) =>
    EVENTS.push({ date, text, topic: tp.id, key: `e${tp.id}-${i}`, sort: dateKey(date), year: Number(date.slice(0, 4)) }),
  );
  tp.ox.forEach((o, i) => OXS.push({ ...o, topic: tp.id, key: `o${tp.id}-${i}` }));
}
EVENTS.sort((a, b) => a.sort - b.sort || a.topic - b.topic);
const termByKey = new Map(TERMS.map((x) => [x.key, x]));

// 용어 종류(k) → 용어 사전의 묶음
const { KIND_GROUP, GROUPS } = SUBJECT;

// ---------- 검색용 정규화 ----------
// n: 띄어쓰기·문장 부호를 지우고 가운뎃점·마침표는 "·"로 통일 (3.1 = 3·1)
// n2: 가운뎃점까지 지운 것 (31운동 = 3·1 운동)

const DOTS = "·・‧∙ㆍ.";
const PUNCT_RE = /[\s,'"‘’“”「」『』()\[\]<>~\-–—:;!?…\/]/g;
const DOTS_RE = new RegExp(`[${DOTS}]`, "g");
const norm = (s) => String(s).toLowerCase().replace(PUNCT_RE, "").replace(DOTS_RE, "·");
const norm2 = (s) => norm(s).replace(/·/g, "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 원문에서 글자 사이에 끼어 있을 수 있는 띄어쓰기·문장 부호
const GAP = `[\\s${DOTS},'"‘’“”「」『』()\\[\\]<>~\\-–—:;!?…/]*`;

function looseRe(normalized) {
  return [...normalized].map((ch) => (ch === "·" ? `[${DOTS}]` : escapeRe(ch))).join(GAP);
}

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function choseong(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
    else if (/[0-9a-zㄱ-ㅎ]/i.test(ch)) out += ch.toLowerCase();
  }
  return out;
}
const isCho = (s) => /^[ㄱ-ㅎ]+$/.test(s);

// 굵게 쓴 말 → 용어 (이름, 괄호를 뺀 이름, 다른 이름, 관련어로 찾는다)
const termByName = new Map();
for (const x of TERMS) {
  for (const name of [x.t, x.t.replace(/\(.*?\)/g, ""), ...x.a, ...x.s]) {
    const k = norm2(name);
    if (k && !termByName.has(k)) termByName.set(k, x);
  }
}
const findTerm = (s) => termByName.get(norm2(s)) || termByName.get(norm2(s.replace(/\(.*?\)/g, "")));

// ---------- 검색 색인 ----------

const INDEX = [];
for (const x of TERMS) {
  const names = [x.t, ...x.a, ...x.s];
  const text = `${names.join(" ")} ${x.d}`;
  INDEX.push({ type: "term", key: x.key, topic: x.topic, term: x, n: norm(text), n2: norm2(text), names: names.map(norm2), cho: names.map(choseong) });
}
for (const tp of TOPICS) {
  const text = `${tp.title} ${tp.period} ${tp.intro}`;
  INDEX.push({ type: "topic", key: `p${tp.id}`, topic: tp.id, n: norm(text), n2: norm2(text), names: [norm2(tp.title)], cho: [choseong(tp.title)] });
  tp.sections.forEach((s, si) =>
    s.items.forEach((it, ii) => {
      const plain = it.replace(/\*\*/g, "");
      INDEX.push({ type: "note", key: `n${tp.id}-${si}-${ii}`, topic: tp.id, head: s.h, text: plain, n: norm(plain), n2: norm2(plain) });
    }),
  );
}
for (const e of EVENTS) {
  const text = `${e.date} ${e.text}`;
  INDEX.push({ type: "event", key: e.key, topic: e.topic, ev: e, n: norm(text), n2: norm2(text) });
}
COMPARE.forEach((c, ci) =>
  c.rows.forEach((row, ri) => {
    const text = row.join(" ");
    INDEX.push({ type: "compare", key: `c${ci}-${ri}`, ci, row, n: norm(text), n2: norm2(text) });
  }),
);
for (const o of OXS) {
  const text = `${o.q} ${o.e}`;
  INDEX.push({ type: "ox", key: o.key, topic: o.topic, ox: o, n: norm(text), n2: norm2(text) });
}

const tokensOf = (q) => q.trim().split(/\s+/).filter((t) => norm2(t));

// 결과: { term: [...], topic: [...], ... } 또는 검색어가 없으면 null
function search(q) {
  const raw = tokensOf(q);
  if (raw.length === 0) return null;
  const joined = raw.join("");
  const cho = isCho(joined) ? joined : null;
  // 가운뎃점이 들어간 말(3·1)은 그대로, 아니면 가운뎃점을 무시하고 비교한다
  const toks = raw.map((t) => (norm(t).includes("·") ? { s: norm(t), f: "n" } : { s: norm2(t), f: "n2" }));
  const whole = norm2(joined);
  const hits = { term: [], topic: [], note: [], event: [], compare: [], ox: [] };
  for (const it of INDEX) {
    let score;
    if (cho) {
      if (!it.cho) continue;
      score = Math.max(...it.cho.map((c) => (c === cho ? 3 : c.startsWith(cho) ? 2 : c.includes(cho) ? 1 : 0)));
      if (!score) continue;
    } else {
      if (!toks.every((t) => it[t.f].includes(t.s))) continue;
      score = 1;
      if (it.names) {
        if (it.names.includes(whole)) score = 4;
        else if (it.names.some((n) => n.startsWith(whole))) score = 3;
        else if (it.names.some((n) => toks.every((t) => n.includes(norm2(t.s))))) score = 2;
      }
    }
    hits[it.type].push({ it, score });
  }
  for (const list of Object.values(hits)) list.sort((a, b) => b.score - a.score);
  return hits;
}

// 검색어를 원문에서 찾는 정규식 (띄어쓰기·가운뎃점 차이를 허용)
function hlRegex(q) {
  if (!q) return null;
  const parts = tokensOf(q).map(norm);
  if (parts.length === 0 || isCho(parts.join(""))) return null;
  const pats = parts.map(looseRe).sort((a, b) => b.length - a.length);
  return new RegExp(pats.join("|"), "gi");
}

// ---------- HTML 도우미 ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function mark(text, re) {
  if (!re) return esc(text);
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out += `${esc(text.slice(last, m.index))}<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// **굵게** → 용어 사전에 있으면 누를 수 있는 단어, 없으면 굵은 글씨
function rich(text, re) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => {
      if (i % 2 === 0) return mark(part, re);
      const x = findTerm(part);
      return x
        ? `<button type="button" class="kw" data-term="${x.key}">${mark(part, re)}</button>`
        : `<strong>${mark(part, re)}</strong>`;
    })
    .join("");
}

// 주제 이름표: 한국사2는 "주제 05", 통합사회2는 "Ⅲ-2"처럼 데이터에 label이 있으면 그것을 쓴다
const topicLabel = (id) => topicById.get(id).label || `주제 ${pad(id)}`;
const topicShort = (id) => topicById.get(id).short || pad(id);
const unitBadge = (u) => u.badge || `${SUBJECT.unitWord} ${u.id}`;
const topicChip = (id) => `<a class="chip u${unitOf.get(id).id}" href="#study/${id}">${topicLabel(id)}</a>`;

// "1919.3.1" → "3월 1일"
function monthDay(date) {
  const [, m, d] = date.split(".");
  if (!m) return "";
  return d ? `${m}월 ${d}일` : `${m}월`;
}

// "1919.3.1" → "1919년 3월 1일"
const fullDate = (date) => `${date.slice(0, 4)}년 ${monthDay(date)}`.trim();

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 저장 (이 기기에서만) ----------

const DONE_KEY = `${SUBJECT.store}-done`;
const LAST_KEY = `${SUBJECT.store}-last`;

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const done = new Set(load(DONE_KEY, []));
function toggleDone(id) {
  if (done.has(id)) done.delete(id);
  else done.add(id);
  save(DONE_KEY, [...done]);
  updateProgress();
}

function updateProgress() {
  const n = TOPICS.filter((tp) => done.has(tp.id)).length;
  $("progress").innerHTML = `<span>완료 <b>${n}</b>/${TOPICS.length}</span><i style="--p:${(n / TOPICS.length) * 100}%"></i>`;
}

// ---------- 화면 전환 ----------

const TABS = ["study", "timeline", "terms", "compare", "quiz", "notes", "links"];
let pending = null; // 검색 결과·용어 카드에서 넘어왔을 때 { focus: 보여 줄 data-key, hl: 색칠할 검색어 }

function route() {
  const [tab, arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { tab: TABS.includes(tab) ? tab : "study", arg };
}

function go(hash, focus) {
  pending = { focus, hl: input.value };
  closeSearch();
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  const { tab, arg } = route();
  for (const a of document.querySelectorAll("#tabs a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const hl = pending ? hlRegex(pending.hl) : null;
  unmountAnnotations();
  if (tab === "study") {
    if (arg && topicById.has(Number(arg))) renderTopic(Number(arg), hl);
    else renderOverview();
  } else if (tab === "timeline") renderTimeline();
  else if (tab === "terms") renderTerms();
  else if (tab === "compare") renderCompare(hl);
  else if (tab === "quiz") renderQuiz();
  else if (tab === "notes") renderNotes();
  else renderLinks();

  const target = pending?.focus && view.querySelector(`[data-key="${pending.focus}"]`);
  pending = null;
  if (target) {
    target.scrollIntoView({ block: "center" });
    target.classList.add("flash");
  } else {
    window.scrollTo(0, 0);
  }
}

// ---------- 단원 학습: 전체 목록 ----------

function renderOverview() {
  document.title = `${SUBJECT.name} 공부`;
  const last = topicById.get(load(LAST_KEY, 0));
  const stat = (n, label) => `<span><b>${n}</b>${label}</span>`;
  view.innerHTML = `
    <section class="welcome">
      <div>
        <h2>${esc(SUBJECT.headline)}</h2>
        <p>${esc(SUBJECT.blurb)}</p>
        <div class="stats">${stat(TOPICS.length, SUBJECT.topicWord)}${stat(TERMS.length, "용어")}${stat(EVENTS.length, "연표")}${stat(OXS.length, "O/X")}</div>
      </div>
      ${last ? `<a class="btn primary" href="#study/${last.id}">이어서 공부하기<small>${topicLabel(last.id)} · ${esc(last.title)}</small></a>` : `<a class="btn primary" href="#study/1">처음부터 공부하기<small>${topicLabel(1)} · ${esc(TOPICS[0].title)}</small></a>`}
    </section>
    ${UNITS.map((u) => {
      const n = u.topics.filter((id) => done.has(id)).length;
      return `
      <section class="unit-card u${u.id}">
        <header>
          <span class="badge">${esc(unitBadge(u))}</span>
          <h3>${esc(u.title)}</h3>
          <p>${esc(u.period)} · 완료 ${n}/${u.topics.length}</p>
        </header>
        <ol class="topic-list">
          ${u.topics
            .map((id) => {
              const tp = topicById.get(id);
              return `<li><a href="#study/${id}"><span class="n">${esc(topicShort(id))}</span><span class="t">${esc(tp.title)}<small>${esc(tp.period)}</small></span>${done.has(id) ? '<span class="ck" aria-label="완료">✓</span>' : ""}</a></li>`;
            })
            .join("")}
        </ol>
      </section>`;
    }).join("")}`;
}

// ---------- 단원 학습: 주제 ----------

function tocHTML(current) {
  return `
    <aside class="toc" id="toc" aria-label="${SUBJECT.topicWord} 목록">
      <div class="toc-head">
        <a href="#study">전체 목록</a>
        <button type="button" class="toc-close" data-action="toc-close">닫기</button>
      </div>
      ${UNITS.map(
        (u) => `
        <div class="toc-unit u${u.id}">
          <p>${esc(unitBadge(u))} · ${esc(u.title)}</p>
          <ol>
            ${u.topics
              .map((id) => {
                const cur = id === current ? ' aria-current="page"' : "";
                const ck = done.has(id) ? '<span class="ck">✓</span>' : "";
                return `<li><a href="#study/${id}"${cur}><span class="n">${esc(topicShort(id))}</span><span class="t">${esc(topicById.get(id).title)}</span>${ck}</a></li>`;
              })
              .join("")}
          </ol>
        </div>`,
      ).join("")}
    </aside>`;
}

function termCard(x, hl) {
  const meta = [x.k, x.y].filter(Boolean).join(" · ");
  return `<button type="button" class="term-card" data-term="${x.key}" data-key="${x.key}">
    <span class="tc-name">${mark(x.t, hl)}</span>
    <span class="tc-meta">${esc(meta)}</span>
    <span class="tc-def">${mark(x.d, hl)}</span>
  </button>`;
}

function oxCard(o, hl) {
  return `<div class="ox" data-key="${o.key}" data-answer="${o.a}">
    <p class="ox-q">${mark(o.q, hl)}</p>
    <div class="ox-btns">
      <button type="button" data-action="ox" data-pick="true" aria-label="맞다(O)">O</button>
      <button type="button" data-action="ox" data-pick="false" aria-label="틀리다(X)">X</button>
    </div>
    <p class="ox-e" hidden>${mark(o.e, hl)}</p>
  </div>`;
}

function renderTopic(id, hl) {
  const tp = topicById.get(id);
  const u = unitOf.get(id);
  const i = TOPICS.indexOf(tp);
  const prev = TOPICS[i - 1];
  const next = TOPICS[i + 1];
  save(LAST_KEY, id);
  if (noteTopic() !== null && noteTopic() !== id) openTopicNote(id);
  document.title = `${topicLabel(id)} ${tp.title} · ${SUBJECT.name}`;
  const terms = TERMS.filter((x) => x.topic === id);
  const events = EVENTS.filter((e) => e.topic === id);
  const oxs = OXS.filter((o) => o.topic === id);

  view.innerHTML = `
    <div class="study" id="study">
      ${tocHTML(id)}
      <article class="topic u${u.id}">
        <header class="topic-head">
          <div class="topic-tools">
            <button type="button" class="toc-open" data-action="toc-open">☰ ${SUBJECT.topicWord} 목록</button>
            <button type="button" class="note-btn" data-action="note" data-id="${id}">✏️ 필기 노트</button>
            <button type="button" class="ann-btn" data-action="annotate" aria-pressed="false">✍️ 본문에 필기</button>
          </div>
          <p class="crumb"><span class="badge">${esc(unitBadge(u))}</span>${esc(u.title)}</p>
          <h2><span class="num">${topicLabel(id)}</span>${esc(tp.title)}</h2>
          <p class="period">${esc(tp.period)}</p>
          <p class="intro">${mark(tp.intro, hl)}</p>
        </header>

        <section class="block">
          <h3>핵심 정리</h3>
          ${tp.sections
            .map(
              (s, si) => `
            ${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ""}
            <div class="sec">
              <h4>${esc(s.h)}</h4>
              <ul>${s.items.map((it, ii) => `<li data-key="n${id}-${si}-${ii}">${rich(it, hl)}</li>`).join("")}</ul>
            </div>`,
            )
            .join("")}
        </section>

        <section class="block"${terms.length ? "" : " hidden"}>
          <h3>핵심 용어 <small>${terms.length}개 · 누르면 자세히</small></h3>
          <div class="term-grid">${terms.map((x) => termCard(x, hl)).join("")}</div>
        </section>

        <section class="block"${events.length ? "" : " hidden"}>
          <h3>연표</h3>
          <ol class="mini-tl">
            ${events
              .map(
                (e) => `<li data-key="${e.key}"><span class="d">${e.year}${monthDay(e.date) ? `<small>${monthDay(e.date)}</small>` : ""}</span><span class="tx">${mark(e.text, hl)}</span></li>`,
              )
              .join("")}
          </ol>
        </section>

        <section class="block"${oxs.length ? "" : " hidden"}>
          <h3>헷갈리는 개념 O/X <small>먼저 골라 보고 해설을 확인하세요</small></h3>
          <div class="ox-list">${oxs.map((o) => oxCard(o, hl)).join("")}</div>
        </section>

        <footer class="pager">
          ${prev ? `<a class="prev" href="#study/${prev.id}"><small>← 이전</small>${topicLabel(prev.id)} ${esc(prev.title)}</a>` : "<span></span>"}
          <button type="button" class="done-btn" data-action="done" data-id="${id}" aria-pressed="${done.has(id)}">${done.has(id) ? "✓ 공부 완료" : "공부 완료로 표시"}</button>
          ${next ? `<a class="next" href="#study/${next.id}"><small>다음 →</small>${topicLabel(next.id)} ${esc(next.title)}</a>` : "<span></span>"}
        </footer>
      </article>
    </div>`;
  mountAnnotations(view.querySelector(".topic"), id);
}

// ---------- 연표 ----------

let tlUnit = 0; // 0이면 전체

function renderTimeline() {
  document.title = `연표 · ${SUBJECT.name}`;
  const list = EVENTS.filter((e) => !tlUnit || unitOf.get(e.topic).id === tlUnit);
  const years = new Map();
  for (const e of list) {
    if (!years.has(e.year)) years.set(e.year, []);
    years.get(e.year).push(e);
  }
  // 이동 단추: 10년 단위(기본) 또는 100년 단위(세기)
  const step = SUBJECT.timelineStep || 10;
  const decades = [...new Set([...years.keys()].map((y) => Math.floor(y / step) * step))];
  const decadeName = (d) => (step === 100 ? `${d / 100 + 1}세기` : `${d}년대`);
  const firstOfDecade = new Set();
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>연표 <small>${list.length}개</small></h2>
        <div class="chips" role="group" aria-label="${SUBJECT.unitWord}">
          ${[0, ...UNITS.map((u) => u.id)]
            .map((id) => `<button type="button" class="chipbtn${tlUnit === id ? " on" : ""}" data-action="tl-unit" data-unit="${id}">${id ? esc(unitBadge(UNITS.find((u) => u.id === id))) : "전체"}</button>`)
            .join("")}
        </div>
        <div class="chips small" role="group" aria-label="연대로 이동">
          ${decades.map((d) => `<button type="button" class="chipbtn" data-action="jump" data-target="dec-${d}">${decadeName(d)}</button>`).join("")}
        </div>
      </div>
      <ol class="tl">
        ${[...years]
          .map(([y, evs]) => {
            const dec = Math.floor(y / step) * step;
            const anchor = firstOfDecade.has(dec) ? "" : ` id="dec-${dec}"`;
            firstOfDecade.add(dec);
            return `<li class="tl-year"${anchor}>
              <h3>${y}</h3>
              <ul>${evs
                .map(
                  (e) => `<li class="u${unitOf.get(e.topic).id}" data-key="${e.key}"><span class="d">${monthDay(e.date)}</span><span class="tx">${esc(e.text)}</span>${topicChip(e.topic)}</li>`,
                )
                .join("")}</ul>
            </li>`;
          })
          .join("")}
      </ol>
    </section>`;
}

// ---------- 용어 사전 ----------

let termGroup = "";
let termUnit = 0;
const BASE_CHO = { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" };
const NUM_GROUP = "숫자·영문";

function initialOf(name) {
  const c = choseong(name[0])[0];
  if (c && /[ㄱ-ㅎ]/.test(c)) return BASE_CHO[c] || c;
  return NUM_GROUP;
}

function renderTerms() {
  document.title = `용어 사전 · ${SUBJECT.name}`;
  const list = TERMS.filter((x) => (!termGroup || KIND_GROUP[x.k] === termGroup) && (!termUnit || unitOf.get(x.topic).id === termUnit)).sort(
    (a, b) => a.t.localeCompare(b.t, "ko"),
  );
  const groups = new Map();
  for (const x of list) {
    const g = initialOf(x.t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  }
  const order = [...groups.keys()].sort((a, b) => (a === NUM_GROUP) - (b === NUM_GROUP) || a.localeCompare(b, "ko"));
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>용어 사전 <small>${list.length}개</small></h2>
        <div class="chips" role="group" aria-label="종류">
          ${["", ...GROUPS]
            .map((g) => `<button type="button" class="chipbtn${termGroup === g ? " on" : ""}" data-action="term-group" data-group="${g}">${g || "전체"}</button>`)
            .join("")}
        </div>
        <div class="chips" role="group" aria-label="${SUBJECT.unitWord}">
          ${[0, ...UNITS.map((u) => u.id)]
            .map((id) => `<button type="button" class="chipbtn${termUnit === id ? " on" : ""}" data-action="term-unit" data-unit="${id}">${id ? esc(unitBadge(UNITS.find((u) => u.id === id))) : `모든 ${SUBJECT.unitWord}`}</button>`)
            .join("")}
        </div>
        <div class="chips small" role="group" aria-label="첫 글자로 이동">
          ${order.map((g) => `<button type="button" class="chipbtn" data-action="jump" data-target="g-${g}">${g}</button>`).join("")}
        </div>
      </div>
      ${order
        .map(
          (g) => `
        <section class="term-sec" id="g-${g}">
          <h3>${g}</h3>
          <ul class="term-list">
            ${groups
              .get(g)
              .map(
                (x) => `<li class="u${unitOf.get(x.topic).id}">
                  <button type="button" class="tl-name" data-term="${x.key}">${esc(x.t)}</button>
                  <span class="meta">${esc([x.k, x.y].filter(Boolean).join(" · "))}</span>${topicChip(x.topic)}
                  <p>${esc(x.d)}</p>
                </li>`,
              )
              .join("")}
          </ul>
        </section>`,
        )
        .join("")}
    </section>`;
}

// ---------- 비교 정리 ----------

function renderCompare(hl) {
  document.title = `비교 정리 · ${SUBJECT.name}`;
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>비교 정리 <small>헷갈리는 것끼리 한눈에</small></h2>
        <div class="chips small" role="group" aria-label="표로 이동">
          ${COMPARE.map((c, ci) => `<button type="button" class="chipbtn" data-action="jump" data-target="cmp-${ci}">${esc(c.title)}</button>`).join("")}
        </div>
      </div>
      ${COMPARE.map(
        (c, ci) => `
        <section class="cmp" id="cmp-${ci}">
          <h3>${esc(c.title)}</h3>
          <div class="table-wrap">
            <table>
              <thead><tr>${c.cols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
              <tbody>
                ${c.rows
                  .map((r, ri) => `<tr data-key="c${ci}-${ri}">${r.map((cell, k) => (k === 0 ? `<th scope="row">${mark(cell, hl)}</th>` : `<td>${mark(cell, hl)}</td>`)).join("")}</tr>`)
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>`,
      ).join("")}
    </section>`;
}

// ---------- 필기 노트 ----------

// 노트 옆에 띄워 볼 주제 핵심 정리
function noteSideHTML(tp) {
  const plain = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return `<h3>${topicLabel(tp.id)} ${esc(tp.title)}</h3>
    ${tp.sections.map((s) => `${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ""}<h4>${esc(s.h)}</h4><ul>${s.items.map((it) => `<li>${plain(it)}</li>`).join("")}</ul>`).join("")}`;
}

function openTopicNote(id) {
  const tp = topicById.get(id);
  openNote(id, { label: topicLabel(id), title: tp.title, sideHTML: noteSideHTML(tp) }, () => {
    if (route().tab === "notes") renderNotes();
  });
}

async function renderNotes() {
  document.title = `필기 노트 · ${SUBJECT.name}`;
  const notes = (await listNotes()).sort((a, b) => b.updated - a.updated);
  if (route().tab !== "notes") return;
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>필기 노트 <small>${notes.length}개 주제</small></h2>
        <p class="hint">주제 화면의 ‘✏️ 필기 노트’를 누르면 애플펜슬로 쓸 수 있어요. 노트는 이 기기에만 저장돼요.</p>
        <div class="chips small">${TOPICS.map((tp) => `<button type="button" class="chipbtn" data-action="note" data-id="${tp.id}">${esc(topicShort(tp.id))}</button>`).join("")}</div>
      </div>
      ${notes.length ? `<ul class="note-list">${notes
        .map((n) => {
          const tp = topicById.get(n.topic);
          const pages = n.pages.filter((p) => p.length).length;
          const date = new Date(n.updated).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
          return `<li class="u${unitOf.get(n.topic).id}"><button type="button" data-action="note" data-id="${n.topic}">
            <span class="nl-thumb" data-thumb="${n.topic}"></span>
            <span class="nl-text"><b>${topicLabel(n.topic)} ${esc(tp.title)}</b><small>${pages}쪽 · ${date}</small></span>
          </button></li>`;
        })
        .join("")}</ul>` : `<p class="empty">아직 쓴 노트가 없어요. 위 번호를 누르거나 주제 화면에서 ‘✏️ 필기 노트’를 눌러 시작해 보세요.</p>`}
    </section>`;
  for (const n of notes) view.querySelector(`[data-thumb="${n.topic}"]`)?.append(thumbnail(n, 240));
}

// ---------- 자료실 ----------

function renderLinks() {
  document.title = `자료실 · ${SUBJECT.name}`;
  view.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>자료실 <small>더 깊이 공부할 때</small></h2>
        <p class="hint">${esc(SUBJECT.linksHint)}</p>
      </div>
      <ul class="links">
        ${LINKS.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.name)} ↗</b><span>${esc(l.d)}</span></a></li>`).join("")}
      </ul>
    </section>`;
}

// ---------- 퀴즈 ----------

const QUIZ_MODES = {
  term: { name: "용어 맞히기", desc: "설명을 읽고 알맞은 용어를 4개 중에서 골라요" },
  ox: { name: "O/X 오개념 체크", desc: "헷갈리기 쉬운 문장이 맞는지 틀리는지 골라요" },
  order: { name: "시대 순서 맞히기", desc: "사건 4개를 일어난 순서대로 눌러요" },
};
const quiz = { mode: "term", scope: "all", count: 10, items: [], i: 0, score: 0, wrong: [], state: "setup", picked: [] };

function scopeTopics(scope) {
  if (scope === "all") return null;
  if (scope.startsWith("u")) return new Set(UNITS.find((u) => `u${u.id}` === scope).topics);
  return new Set([Number(scope.slice(1))]);
}

// 시대 순서 문제: 연도가 모두 다른 사건 4개씩 묶는다
function orderSets(pool, n) {
  const sets = [];
  for (let k = 0; k < n; k++) {
    const used = new Set();
    const set = [];
    for (const e of shuffle(pool)) {
      if (used.has(e.year)) continue;
      used.add(e.year);
      set.push(e);
      if (set.length === 4) break;
    }
    if (set.length < 4) break;
    sets.push({ events: set, shown: shuffle(set) });
  }
  return sets;
}

// 용어 문제: 정답 1개 + 같은 종류의 오답 3개
function termQuestion(x, pool) {
  const group = KIND_GROUP[x.k];
  const names = new Set([norm2(x.t)]);
  const wrong = [];
  for (const cand of [...shuffle(pool.filter((y) => KIND_GROUP[y.k] === group)), ...shuffle(TERMS.filter((y) => KIND_GROUP[y.k] === group)), ...shuffle(TERMS)]) {
    if (wrong.length === 3) break;
    const k = norm2(cand.t);
    if (names.has(k)) continue;
    names.add(k);
    wrong.push(cand);
  }
  return { term: x, options: shuffle([x, ...wrong]) };
}

// 설명 안에 정답 용어가 나오면 가린다
function maskTerm(text, x) {
  let out = text;
  for (const name of [x.t, x.t.replace(/\(.*?\)/g, ""), ...x.a]) {
    if (norm2(name).length < 2) continue;
    out = out.replace(new RegExp(looseRe(norm(name)), "gi"), "○○");
  }
  return out;
}

function quizPool() {
  const only = scopeTopics(quiz.scope);
  const inScope = (id) => !only || only.has(id);
  if (quiz.mode === "term") return TERMS.filter((x) => inScope(x.topic));
  if (quiz.mode === "ox") return OXS.filter((o) => inScope(o.topic));
  return EVENTS.filter((e) => inScope(e.topic));
}

function startQuiz(retryWrong) {
  const pool = quizPool();
  if (retryWrong && quiz.wrong.length && quiz.mode !== "order") {
    quiz.items = shuffle(quiz.wrong.map((w) => w.item));
  } else if (quiz.mode === "term") {
    quiz.items = shuffle(pool).slice(0, quiz.count).map((x) => termQuestion(x, pool));
  } else if (quiz.mode === "ox") {
    quiz.items = shuffle(pool).slice(0, quiz.count);
  } else {
    quiz.items = orderSets(pool, quiz.count);
  }
  if (quiz.mode === "term" && retryWrong) quiz.items = quiz.items.map((q) => termQuestion(q.term, pool));
  quiz.i = 0;
  quiz.score = 0;
  quiz.wrong = [];
  quiz.picked = [];
  quiz.state = quiz.items.length ? "play" : "setup";
  renderQuiz();
  window.scrollTo(0, 0);
}

function renderQuiz() {
  document.title = `퀴즈 · ${SUBJECT.name}`;
  if (quiz.state === "play") return renderQuizQuestion();
  if (quiz.state === "result") return renderQuizResult();

  const pool = quizPool();
  const available = quiz.mode === "order" ? orderSets(pool, quiz.count).length : Math.min(pool.length, quiz.count);
  view.innerHTML = `
    <section class="panel quiz-setup">
      <div class="panel-head"><h2>퀴즈 <small>한 번에 ${quiz.count}문제</small></h2></div>
      <div class="mode-grid" role="radiogroup" aria-label="퀴즈 종류">
        ${Object.entries(QUIZ_MODES)
          .map(
            ([k, m]) => `<button type="button" role="radio" aria-checked="${quiz.mode === k}" class="mode${quiz.mode === k ? " on" : ""}" data-action="quiz-mode" data-mode="${k}">
              <b>${m.name}</b><span>${m.desc}</span></button>`,
          )
          .join("")}
      </div>
      <div class="quiz-opts">
        <label>범위
          <select data-action="quiz-scope">
            <option value="all"${quiz.scope === "all" ? " selected" : ""}>전체 (${topicLabel(TOPICS[0].id)}~${topicShort(TOPICS[TOPICS.length - 1].id)})</option>
            ${UNITS.map((u) => `<option value="u${u.id}"${quiz.scope === `u${u.id}` ? " selected" : ""}>${esc(unitBadge(u))} · ${esc(u.title)}</option>`).join("")}
            ${TOPICS.map((tp) => `<option value="t${tp.id}"${quiz.scope === `t${tp.id}` ? " selected" : ""}>${topicLabel(tp.id)} · ${esc(tp.title)}</option>`).join("")}
          </select>
        </label>
        <label>문제 수
          <select data-action="quiz-count">
            ${[5, 10, 20, 30].map((n) => `<option value="${n}"${quiz.count === n ? " selected" : ""}>${n}문제</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="hint">${available ? `이 범위에서 ${available}문제를 낼 수 있어요.` : "이 범위로는 문제를 만들 수 없어요. 범위를 넓혀 주세요."}</p>
      <button type="button" class="btn primary big" data-action="quiz-start"${available ? "" : " disabled"}>시작하기</button>
    </section>`;
}

function renderQuizQuestion() {
  const q = quiz.items[quiz.i];
  const head = `<div class="quiz-top"><span>${QUIZ_MODES[quiz.mode].name}</span><span>${quiz.i + 1} / ${quiz.items.length} · 맞힌 개수 ${quiz.score}</span><button type="button" class="link" data-action="quiz-quit">그만하기</button></div>`;
  let body = "";
  if (quiz.mode === "term") {
    body = `<p class="qlead">다음 설명에 알맞은 것은?</p>
      <blockquote class="qtext">${esc(maskTerm(q.term.d, q.term))}</blockquote>
      <div class="opts">${q.options.map((x) => `<button type="button" class="opt" data-action="quiz-pick" data-key="${x.key}">${esc(x.t)}</button>`).join("")}</div>`;
  } else if (quiz.mode === "ox") {
    body = `<p class="qlead">맞으면 O, 틀리면 X</p>
      <blockquote class="qtext">${esc(q.q)}</blockquote>
      <div class="opts ox-opts">
        <button type="button" class="opt" data-action="quiz-pick" data-key="true">O</button>
        <button type="button" class="opt" data-action="quiz-pick" data-key="false">X</button>
      </div>`;
  } else {
    body = `<p class="qlead">먼저 일어난 일부터 차례로 누르세요</p>
      <div class="order">${q.shown
        .map((e) => {
          const n = quiz.picked.indexOf(e.key);
          return `<button type="button" class="ord${n >= 0 ? " on" : ""}" data-action="quiz-order" data-key="${e.key}"><span class="no">${n >= 0 ? n + 1 : ""}</span>${esc(e.text)}</button>`;
        })
        .join("")}</div>
      <div class="order-btns">
        <button type="button" class="btn" data-action="quiz-order-reset"${quiz.picked.length ? "" : " disabled"}>다시 고르기</button>
        <button type="button" class="btn primary" data-action="quiz-order-check"${quiz.picked.length === 4 ? "" : " disabled"}>확인</button>
      </div>`;
  }
  view.innerHTML = `<section class="panel quiz-play">${head}${body}<div id="quiz-feedback" class="feedback" hidden></div></section>`;
}

function answerQuiz(correct, detailHTML, item) {
  if (correct) quiz.score++;
  else quiz.wrong.push({ item, detailHTML });
  const fb = $("quiz-feedback");
  const last = quiz.i === quiz.items.length - 1;
  fb.className = `feedback ${correct ? "right" : "wrong"}`;
  fb.innerHTML = `<p class="verdict">${correct ? "정답!" : "아쉬워요"}</p>${detailHTML}
    <button type="button" class="btn primary" data-action="quiz-next">${last ? "결과 보기" : "다음 문제 →"}</button>`;
  fb.hidden = false;
  for (const b of view.querySelectorAll(".opt, .ord, [data-action^='quiz-order']")) b.disabled = true;
  fb.querySelector("[data-action='quiz-next']").focus({ preventScroll: true });
  fb.scrollIntoView({ block: "nearest" });
}

function pickQuiz(key, button) {
  const q = quiz.items[quiz.i];
  if (quiz.mode === "term") {
    const correct = key === q.term.key;
    for (const b of view.querySelectorAll(".opt")) {
      if (b.dataset.key === q.term.key) b.classList.add("right");
      else if (b === button) b.classList.add("wrong");
    }
    answerQuiz(
      correct,
      `<p><b>${esc(q.term.t)}</b> — ${esc(q.term.d)}</p><p>${topicChip(q.term.topic)} ${esc(topicById.get(q.term.topic).title)}</p>`,
      q,
    );
  } else {
    const correct = String(q.a) === key;
    for (const b of view.querySelectorAll(".opt")) {
      if (b.dataset.key === String(q.a)) b.classList.add("right");
      else if (b === button) b.classList.add("wrong");
    }
    answerQuiz(correct, `<p>정답은 <b>${q.a ? "O" : "X"}</b> — ${esc(q.e)}</p><p>${topicChip(q.topic)} ${esc(topicById.get(q.topic).title)}</p>`, q);
  }
}

function checkOrder() {
  const q = quiz.items[quiz.i];
  const right = [...q.events].sort((a, b) => a.sort - b.sort);
  const correct = right.every((e, k) => quiz.picked[k] === e.key);
  answerQuiz(
    correct,
    `<ol class="order-answer">${right.map((e) => `<li><b>${fullDate(e.date)}</b> ${esc(e.text)} ${topicChip(e.topic)}</li>`).join("")}</ol>`,
    q,
  );
}

function renderQuizResult() {
  const total = quiz.items.length;
  const pct = Math.round((quiz.score / total) * 100);
  view.innerHTML = `
    <section class="panel quiz-result">
      <h2>${quiz.score} / ${total} <small>${pct}점</small></h2>
      <p>${pct === 100 ? "완벽해요! 다른 범위도 도전해 보세요." : pct >= 70 ? "잘했어요. 틀린 것만 다시 확인해 봐요." : "틀린 문제의 주제를 다시 읽고 도전해 봐요."}</p>
      ${quiz.wrong.length ? `<h3>틀린 문제</h3><ul class="wrong-list">${quiz.wrong.map((w) => `<li>${w.detailHTML}</li>`).join("")}</ul>` : ""}
      <div class="result-btns">
        ${quiz.wrong.length && quiz.mode !== "order" ? '<button type="button" class="btn primary" data-action="quiz-retry">틀린 것만 다시</button>' : ""}
        <button type="button" class="btn${quiz.wrong.length && quiz.mode !== "order" ? "" : " primary"}" data-action="quiz-start">새 문제로 다시</button>
        <button type="button" class="btn" data-action="quiz-quit">설정 바꾸기</button>
      </div>
    </section>`;
}

// ---------- 키워드 검색 ----------

const TYPE_LABEL = { term: "용어", topic: "주제", note: "핵심 정리", event: "연표", compare: "비교 정리", ox: "O/X" };
const SHOW = 6;
let expanded = new Set();
let searchOpen = false;

function hitHTML(h, re) {
  const it = h.it;
  if (it.type === "term") {
    const x = it.term;
    return `<button type="button" class="hit" data-term="${x.key}">
      <span class="hit-title">${mark(x.t, re)}</span>
      <span class="hit-meta">${esc([x.k, x.y].filter(Boolean).join(" · "))} · ${topicLabel(x.topic)}</span>
      <span class="hit-body">${mark(x.d, re)}${x.a.length ? ` <em>(다른 이름: ${mark(x.a.join(", "), re)})</em>` : ""}</span>
    </button>`;
  }
  if (it.type === "topic") {
    const tp = topicById.get(it.topic);
    return `<button type="button" class="hit" data-href="#study/${tp.id}">
      <span class="hit-title">${topicLabel(tp.id)} · ${mark(tp.title, re)}</span>
      <span class="hit-meta">${esc(unitBadge(unitOf.get(tp.id)))} · ${esc(tp.period)}</span>
      <span class="hit-body">${mark(tp.intro, re)}</span>
    </button>`;
  }
  if (it.type === "note") {
    return `<button type="button" class="hit" data-href="#study/${it.topic}" data-focus="${it.key}">
      <span class="hit-meta">${topicLabel(it.topic)} · ${esc(it.head)}</span>
      <span class="hit-body">${mark(it.text, re)}</span>
    </button>`;
  }
  if (it.type === "event") {
    return `<button type="button" class="hit" data-href="#study/${it.topic}" data-focus="${it.key}">
      <span class="hit-title">${fullDate(it.ev.date)}</span>
      <span class="hit-body">${mark(it.ev.text, re)}</span>
      <span class="hit-meta">${topicLabel(it.topic)}</span>
    </button>`;
  }
  if (it.type === "compare") {
    return `<button type="button" class="hit" data-href="#compare" data-focus="${it.key}">
      <span class="hit-meta">비교 정리 · ${esc(COMPARE[it.ci].title)}</span>
      <span class="hit-body">${mark(it.row.join(" · "), re)}</span>
    </button>`;
  }
  return `<button type="button" class="hit" data-href="#study/${it.topic}" data-focus="${it.key}">
    <span class="hit-meta">${topicLabel(it.topic)} · 정답 ${it.ox.a ? "O" : "X"}</span>
    <span class="hit-body">${mark(it.ox.q, re)}</span>
  </button>`;
}

function suggestHTML() {
  return `<div class="res-head"><p>이런 키워드로 찾아보세요</p><button type="button" class="link" data-action="close-search">닫기</button></div>
    <div class="chips">${SUGGEST.map((s) => `<button type="button" class="chipbtn" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    <p class="hint">${esc(SUBJECT.searchHint)}</p>`;
}

function renderResults() {
  const q = input.value;
  const hits = search(q);
  if (!hits) {
    resultsBox.innerHTML = suggestHTML();
    return;
  }
  const re = hlRegex(q);
  const total = Object.values(hits).reduce((n, l) => n + l.length, 0);
  const groups = Object.entries(hits).filter(([, list]) => list.length);
  resultsBox.innerHTML = `
    <div class="res-head">
      <p><b>‘${esc(q.trim())}’</b> 검색 결과 ${total}개</p>
      <button type="button" class="link" data-action="close-search">닫기</button>
    </div>
    ${groups.length ? `<nav class="chips small" aria-label="결과 종류">${groups.map(([t, l]) => `<button type="button" class="chipbtn" data-action="jump" data-target="res-${t}">${TYPE_LABEL[t]} ${l.length}</button>`).join("")}</nav>` : ""}
    ${groups.length
      ? groups
          .map(([type, list]) => {
            const all = expanded.has(type);
            const shown = all ? list : list.slice(0, SHOW);
            return `<section class="res-group" id="res-${type}">
              <h3>${TYPE_LABEL[type]} <small>${list.length}</small></h3>
              <div class="hits">${shown.map((h) => hitHTML(h, re)).join("")}</div>
              ${list.length > SHOW && !all ? `<button type="button" class="more" data-action="more" data-type="${type}">${TYPE_LABEL[type]} ${list.length - SHOW}개 더 보기</button>` : ""}
            </section>`;
          })
          .join("")
      : `<p class="empty">찾는 내용이 없어요. 다른 말이나 더 짧은 말로 찾아보세요.</p>`}`;
}

function openSearch() {
  if (!searchOpen) {
    searchOpen = true;
    view.hidden = true;
    resultsBox.hidden = false;
    window.scrollTo(0, 0);
  }
  renderResults();
}

function closeSearch() {
  searchOpen = false;
  resultsBox.hidden = true;
  view.hidden = false;
}

input.addEventListener("input", () => {
  $("q-clear").hidden = !input.value;
  expanded = new Set();
  openSearch();
});
input.addEventListener("focus", () => openSearch());
input.addEventListener("click", () => openSearch());
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  input.blur(); // 아이패드 키보드 내리기
});
$("q-clear").addEventListener("click", () => {
  input.value = "";
  $("q-clear").hidden = true;
  closeSearch();
  input.focus();
});

// ---------- 용어 카드 ----------

const sheet = $("sheet");
let sheetReturn = null;

function openSheet(key) {
  const x = termByKey.get(key);
  if (!x) return;
  const tp = topicById.get(x.topic);
  sheetReturn = document.activeElement;
  $("sheet-meta").textContent = [x.k, x.y].filter(Boolean).join(" · ");
  $("sheet-title").textContent = x.t;
  $("sheet-def").textContent = x.d;
  $("sheet-alias").textContent = x.a.length ? `다른 이름: ${x.a.join(", ")}` : "";
  $("sheet-alias").hidden = !x.a.length;
  const topicLink = $("sheet-topic");
  topicLink.href = `#study/${tp.id}`;
  topicLink.dataset.focus = x.key;
  topicLink.textContent = `${topicLabel(tp.id)} · ${tp.title}에서 보기`;
  $("sheet-web").href = SUBJECT.webSearch(x.t.replace(/\(.*?\)/g, "").trim());
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  $("sheet-close").focus();
}

function closeSheet() {
  if (sheet.hidden) return;
  sheet.hidden = true;
  document.body.classList.remove("sheet-open");
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
}

sheet.addEventListener("click", (e) => {
  if (e.target === sheet || e.target.closest("#sheet-close")) closeSheet();
  const link = e.target.closest("#sheet-topic");
  if (link) {
    e.preventDefault();
    closeSheet();
    go(link.getAttribute("href"), link.dataset.focus);
  }
});

// ---------- 클릭 처리 ----------

document.addEventListener("click", (e) => {
  // 검색 결과가 열려 있을 때 탭을 누르면 결과를 닫고 그 탭을 보여 준다
  const tab = e.target.closest("#tabs a");
  if (tab) {
    input.value = "";
    $("q-clear").hidden = true;
    closeSearch();
    if (tab.getAttribute("href") === location.hash) {
      e.preventDefault();
      render();
    }
    return;
  }

  const t = e.target.closest("[data-term], [data-href], [data-action]");
  if (!t || sheet.contains(t)) return;

  if (t.dataset.term) return openSheet(t.dataset.term);
  if (t.dataset.href) return go(t.dataset.href, t.dataset.focus);

  const action = t.dataset.action;
  if (action === "toc-open") $("study").classList.add("toc-shown");
  else if (action === "toc-close") $("study").classList.remove("toc-shown");
  else if (action === "note") {
    // 같은 주제 노트가 열려 있으면 닫고, 아니면 연다
    const id = Number(t.dataset.id);
    if (noteTopic() === id && t.classList.contains("note-btn")) closeNote();
    else openTopicNote(id);
  }
  else if (action === "annotate") toggleAnnotate();
  else if (action === "done") {
    toggleDone(Number(t.dataset.id));
    const on = done.has(Number(t.dataset.id));
    t.setAttribute("aria-pressed", on);
    t.textContent = on ? "✓ 공부 완료" : "공부 완료로 표시";
    const link = view.querySelector('.toc a[aria-current="page"]');
    link?.querySelector(".ck")?.remove();
    if (link && on) link.insertAdjacentHTML("beforeend", '<span class="ck">✓</span>');
  } else if (action === "ox") {
    const card = t.closest(".ox");
    const right = card.dataset.answer === t.dataset.pick;
    card.classList.remove("right", "wrong");
    card.classList.add(right ? "right" : "wrong");
    const e2 = card.querySelector(".ox-e");
    e2.hidden = false;
    e2.dataset.verdict = `${right ? "정답" : "오답"} · 정답은 ${card.dataset.answer === "true" ? "O" : "X"}`;
  } else if (action === "tl-unit") {
    tlUnit = Number(t.dataset.unit);
    renderTimeline();
  } else if (action === "term-group") {
    termGroup = t.dataset.group;
    renderTerms();
  } else if (action === "term-unit") {
    termUnit = Number(t.dataset.unit);
    renderTerms();
  } else if (action === "jump") {
    document.getElementById(t.dataset.target)?.scrollIntoView({ block: "start" });
  } else if (action === "close-search") {
    closeSearch();
    window.scrollTo(0, 0);
  } else if (action === "suggest") {
    input.value = t.dataset.q;
    $("q-clear").hidden = false;
    renderResults();
  } else if (action === "more") {
    expanded.add(t.dataset.type);
    renderResults();
  } else if (action === "quiz-mode") {
    quiz.mode = t.dataset.mode;
    renderQuiz();
  } else if (action === "quiz-start") startQuiz(false);
  else if (action === "quiz-retry") startQuiz(true);
  else if (action === "quiz-quit") {
    quiz.state = "setup";
    renderQuiz();
  } else if (action === "quiz-pick") pickQuiz(t.dataset.key, t);
  else if (action === "quiz-order") {
    const k = t.dataset.key;
    const n = quiz.picked.indexOf(k);
    if (n >= 0) quiz.picked = quiz.picked.slice(0, n);
    else if (quiz.picked.length < 4) quiz.picked.push(k);
    renderQuizQuestion();
  } else if (action === "quiz-order-reset") {
    quiz.picked = [];
    renderQuizQuestion();
  } else if (action === "quiz-order-check") checkOrder();
  else if (action === "quiz-next") {
    quiz.i++;
    quiz.picked = [];
    if (quiz.i >= quiz.items.length) quiz.state = "result";
    renderQuiz();
    window.scrollTo(0, 0);
  }
});

document.addEventListener("change", (e) => {
  const action = e.target.dataset.action;
  if (action === "quiz-scope") quiz.scope = e.target.value;
  else if (action === "quiz-count") quiz.count = Number(e.target.value);
  else return;
  renderQuiz();
});

document.addEventListener("keydown", (e) => {
  if (noteIsFull()) {
    if (e.key === "Escape") closeNote();
    return;
  }
  // 용어 카드가 열려 있으면 Tab 키 이동을 카드 안에서만 돌게 한다
  if (e.key === "Tab" && !sheet.hidden) {
    const items = [...sheet.querySelectorAll("button, a[href]")];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  if (e.key === "Escape") {
    if (!sheet.hidden) closeSheet();
    else if (searchOpen) {
      closeSearch();
      input.blur();
    }
    return;
  }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && sheet.hidden) {
    e.preventDefault();
    input.focus();
  }
});

// 위쪽 검색·탭 막대 높이 (주제 목록이 그 아래에 붙도록)
const bar = $("bar");
const setBarHeight = () => document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
new ResizeObserver(setBarHeight).observe(bar);
setBarHeight();

window.addEventListener("hashchange", () => {
  if (searchOpen) closeSearch();
  render();
});
updateProgress();
render();
