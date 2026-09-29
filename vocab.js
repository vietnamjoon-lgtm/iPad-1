// 단어 모으기: 기기에서 고른 단어장 PDF의 Day 범위 쪽을 이미지로 바꿔
// Apps Script 웹앱(vocab-script.gs)으로 보내고, Gemini가 뽑은 표제어|뜻을 Day별 표로 보여준다.
// PDF는 기기 안에서만 열리고, 서버로는 해당 쪽 이미지만 간다.

import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/pdf.worker.min.mjs";

// 여기에 vocab-script.gs 웹앱 URL(.../exec)을 붙여넣으세요.
const VOCAB_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz7NQ3GXER29kr0WWJm4SjAjHrWggDHkggStY-qWmQdSIicSFREdPMMsDKVp4IUxg_E/exec";

// Day별 시작 쪽 (PDF 쪽 번호). Day N은 Day N+1 시작 전 쪽까지, Day 60은 LAST_PAGE까지.
const DAY_START = [
  16, 24, 33, 42, 48, 56, 62, 69, 77, 86,
  94, 103, 111, 121, 130, 140, 146, 155, 161, 169,
  178, 187, 196, 205, 212, 219, 227, 236, 245, 254,
  264, 273, 282, 288, 296, 303, 310, 318, 324, 331,
  341, 351, 359, 368, 375, 384, 392, 399, 406, 413,
  421, 430, 439, 448, 456, 463, 470, 477, 483, 490,
];
const LAST_PAGE = 497;
const DAYS = DAY_START.length;

const IMAGE_WIDTH = 1400; // 쪽 이미지 가로 픽셀 (글자가 읽힐 만큼, 전송이 무겁지 않게)
const JPEG_QUALITY = 0.75;
const PARALLEL = 4; // 한 번에 동시에 Gemini로 보내는 쪽 수
const REQUEST_TIMEOUT_MS = 90_000; // 한 쪽 응답을 이만큼 기다려도 안 오면 끊고 다시 시도
const BUSY_RETRIES = 3; // Gemini가 붐비거나(503/429) 응답이 없을 때 자동으로 다시 시도하는 횟수
const BUSY_WAIT_MS = 5_000; // 다시 시도 전 기다리는 시간 (5초, 10초, 15초…)

const $ = (id) => document.getElementById(id);

function dayPages(day) {
  const from = DAY_START[day - 1];
  const to = day < DAYS ? DAY_START[day] - 1 : LAST_PAGE;
  return [from, to];
}

// ---------- 화면 ----------

for (const id of ["vocab-from", "vocab-to"]) {
  const select = $(id);
  for (let d = 1; d <= DAYS; d++) select.add(new Option(`Day ${d}`, d));
}

// day → { pages, status: "pending" | "done" | "error", words, error }
const results = new Map();
let pdfDoc = null;
let running = false;

function setStatus(text) {
  $("vocab-status").textContent = text;
}

function updateRunButton() {
  $("vocab-run").disabled = !pdfDoc || running;
}

function toTsv(words) {
  return words.map((w) => `${w.word}\t${w.meaning}`).join("\n");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 클립보드 API가 막힌 환경용
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const label = button.textContent;
  button.textContent = "✅ 복사됨";
  setTimeout(() => (button.textContent = label), 1500);
}

function render() {
  const box = $("vocab-results");
  box.replaceChildren();
  const days = [...results.keys()].sort((a, b) => a - b);

  for (const day of days) {
    const r = results.get(day);
    const block = document.createElement("div");
    block.className = "vocab-day";

    const head = document.createElement("div");
    head.className = "vocab-day-head";
    const title = document.createElement("b");
    title.textContent = `Day ${day}`;
    const info = document.createElement("small");
    const pages = `${r.pages[0]}–${r.pages[1]}쪽`;
    info.textContent =
      r.status === "done" ? `${pages} · ${r.words.length}단어` : r.status === "error" ? pages : `${pages} · 읽는 중…`;
    head.append(title, info);

    if (r.status === "done") {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "📋 복사";
      copy.addEventListener("click", () => copyText(toTsv(r.words), copy));
      head.append(copy);
    } else if (r.status === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "🔁 다시";
      retry.disabled = running;
      retry.addEventListener("click", () => run([day]));
      head.append(retry);
    }
    block.append(head);

    if (r.status === "error") {
      const err = document.createElement("p");
      err.className = "vocab-error";
      err.textContent = `⚠️ ${r.error}`;
      block.append(err);
    } else if (r.status === "done") {
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>단어</th><th>뜻</th></tr></thead>";
      const tbody = document.createElement("tbody");
      for (const w of r.words) {
        const tr = tbody.insertRow();
        tr.insertCell().textContent = w.word;
        tr.insertCell().textContent = w.meaning;
      }
      table.append(tbody);
      block.append(table);
    }
    box.append(block);
  }

  $("vocab-copy-all").hidden = !days.some((d) => results.get(d).status === "done");
}

$("vocab-copy-all").addEventListener("click", (e) => {
  const text = [...results.keys()]
    .sort((a, b) => a - b)
    .filter((d) => results.get(d).status === "done")
    .map((d) => `Day ${d}\n${toTsv(results.get(d).words)}`)
    .join("\n\n");
  copyText(text, e.currentTarget);
});

// ---------- PDF ----------

$("vocab-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  pdfDoc?.destroy();
  pdfDoc = null;
  updateRunButton();
  $("vocab-file-name").textContent = file.name;
  setStatus("PDF 여는 중…");
  try {
    pdfDoc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    setStatus(`${pdfDoc.numPages}쪽짜리 PDF를 열었어요. Day 범위를 고르고 "단어 뽑기"를 누르세요.`);
  } catch (err) {
    console.error(err);
    setStatus(`⚠️ PDF를 열 수 없어요: ${err.message || err}`);
  }
  updateRunButton();
});

const canvas = document.createElement("canvas");

async function pageToJpegBase64(pageNo) {
  const page = await pdfDoc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: IMAGE_WIDTH / base.width });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // 투명 배경이 JPEG에서 검게 나오지 않게
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

// ---------- 추출 ----------

// 쪽 이미지 한 장을 웹앱으로 보내 단어를 받는다. 붐빔(503/429)·무응답이면 잠시 뒤 다시 시도.
async function extractPage(day, image) {
  const body = JSON.stringify({ day, images: [image] });
  for (let attempt = 1; ; attempt++) {
    let error;
    try {
      // text/plain으로 보내면 Apps Script가 CORS 사전 요청 없이 받고, 응답도 읽을 수 있다
      const res = await fetch(VOCAB_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await res.json();
      if (data.ok) return data.words;
      error = data.error || "알 수 없는 오류";
      if (!/오류 (503|429)/.test(error)) throw new Error(error);
    } catch (err) {
      if (err.name !== "TimeoutError") throw err;
      error = "Gemini 응답이 너무 늦어요";
    }
    if (attempt > BUSY_RETRIES) throw new Error(error);
    await new Promise((r) => setTimeout(r, BUSY_WAIT_MS * attempt));
  }
}

async function extractDay(day) {
  const [from, to] = dayPages(day);
  if (to > pdfDoc.numPages) {
    throw new Error(`PDF가 ${pdfDoc.numPages}쪽까지라서 ${from}–${to}쪽을 읽을 수 없어요`);
  }
  const total = to - from + 1;
  const perPage = new Array(total);
  let next = 0;
  let done = 0;
  const show = () => setStatus(`Day ${day}: Gemini가 읽는 중… (${done}/${total}쪽)`);
  show();

  // 쪽마다 따로, PARALLEL 개씩 동시에 보낸다 (이미지 변환은 한 번에 한 쪽씩)
  let rendering = Promise.resolve();
  const worker = async () => {
    while (next < total) {
      const i = next++;
      const image = await (rendering = rendering.then(() => pageToJpegBase64(from + i)));
      perPage[i] = await extractPage(day, image);
      done++;
      show();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, total) }, worker));

  // 쪽 순서대로 합치고, 두 쪽에 걸쳐 같은 표제어가 나오면 한 번만
  const seen = new Set();
  return perPage.flat().filter((w) => {
    const key = w.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function run(days) {
  if (!VOCAB_SCRIPT_URL) {
    setStatus("⚠️ vocab.js 의 VOCAB_SCRIPT_URL 이 비어 있어요. DEPLOY.md 의 '단어 모으기' 설정을 먼저 해 주세요.");
    return;
  }
  running = true;
  updateRunButton();
  for (const day of days) results.set(day, { pages: dayPages(day), status: "pending" });
  render();

  let failed = 0;
  for (const day of days) {
    const r = results.get(day);
    try {
      r.words = await extractDay(day);
      r.status = "done";
    } catch (err) {
      console.error(err);
      r.status = "error";
      r.error = err.message || String(err);
      failed++;
    }
    render();
  }

  running = false;
  updateRunButton();
  render();
  setStatus(failed ? `끝났어요. ${failed}개 Day는 실패했어요 (🔁 다시 버튼으로 재시도).` : "✅ 다 모았어요!");
}

$("vocab-run").addEventListener("click", () => {
  let from = Number($("vocab-from").value);
  let to = Number($("vocab-to").value);
  if (from > to) [from, to] = [to, from];
  const days = [];
  for (let d = from; d <= to; d++) days.push(d);
  run(days);
});
