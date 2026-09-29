// 탁구·공부 모드가 함께 쓰는 녹화 파일 저장 코드.
// 녹화 영상을 내 구글 드라이브(Apps Script 웹앱)로 보내거나, URL이 없으면 기기에 다운로드한다.

// 여기에 Apps Script 웹앱 URL을 붙여넣으세요. 비워두면 녹화 파일을 기기에 저장(다운로드)합니다.
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzZuBcKN-vwpLeeHF8p90h4oPBAeaVpJvVqBkh3zqANwg6_dIK7FGzONKvlpuXd5mje/exec";

export function pickRecMime() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(
    d.getMinutes()
  )}-${p(d.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// download: false 면 드라이브로만 보내고, 실패해도 기기에 받지 않는다 (공부 모드)
export async function saveRecording(blob, filename, setStatus, { download = true } = {}) {
  // Apps Script URL이 없으면 기기에 다운로드 (GitHub Pages에서 동작)
  if (!APPS_SCRIPT_URL) {
    if (!download) return;
    downloadBlob(blob, filename);
    setStatus(`💾 ${filename} 저장됨`);
    return;
  }

  try {
    setStatus("⬆️ 영상 업로드 중…");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const base64 = String(dataUrl).split(",")[1];

    // Apps Script는 CORS 응답을 주지 않으므로 no-cors로 전송한다(응답은 못 읽음).
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ filename, mimeType: blob.type, data: base64 }),
    });
    setStatus(`✅ ${filename} 드라이브로 전송함`);
  } catch (err) {
    console.error(err);
    if (!download) return;
    setStatus("⚠️ 업로드 실패 — 기기에 저장할게요");
    downloadBlob(blob, filename);
  }
}

// ---------- 계속 녹화 ----------
// 카메라를 켠 순간부터 페이지를 닫을 때까지 계속 녹화해서 segmentMs마다 파일 하나씩
// 드라이브로만 보낸다 (기기에 다운로드하지 않음). 3분마다 녹화기를 새로 시작해서
// 파일 하나하나가 따로 재생되게 한다. 탁구·손 3D·공부 모드가 같이 쓴다.

let recStream = null;
let recOptions = null;
let recorder = null;
let segmentTimer = 0;

function startSegment() {
  if (!recStream || recorder || !window.MediaRecorder) return;
  const { prefix, segmentMs, bitrate } = recOptions;
  const mimeType = pickRecMime();
  const filename = `${prefix}_${timestampName()}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
  let r;
  try {
    r = new MediaRecorder(
      recStream,
      mimeType ? { mimeType, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate }
    );
  } catch (err) {
    console.warn("녹화를 시작할 수 없어요:", err);
    return;
  }
  const chunks = [];
  r.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  r.onstop = () => {
    const blob = new Blob(chunks, { type: r.mimeType || "video/webm" });
    if (blob.size > 0) saveRecording(blob, filename, () => {}, { download: false });
  };
  r.start(1000);
  recorder = r;
  segmentTimer = setTimeout(() => {
    stopSegment();
    startSegment();
  }, segmentMs);
}

// 지금까지 녹화한 부분을 파일로 마무리해서 보낸다
function stopSegment() {
  clearTimeout(segmentTimer);
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
}

export function recordContinuously(stream, { prefix, segmentMs = 3 * 60 * 1000, bitrate = 300_000 }) {
  if (stream === recStream) return;
  stopSegment(); // "다시 시도"로 카메라를 새로 켰으면 새 카메라로 이어서
  recStream = stream;
  recOptions = { prefix, segmentMs, bitrate };
  startSegment();
}

// 다른 앱으로 가거나 탭을 닫으면 그때까지 녹화한 걸 먼저 보낸다
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopSegment();
  else startSegment();
});
window.addEventListener("pagehide", stopSegment);
