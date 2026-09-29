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

export async function saveRecording(blob, filename, setStatus) {
  // Apps Script URL이 없으면 기기에 다운로드 (GitHub Pages에서 동작)
  if (!APPS_SCRIPT_URL) {
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
    setStatus("⚠️ 업로드 실패 — 기기에 저장할게요");
    downloadBlob(blob, filename);
  }
}
