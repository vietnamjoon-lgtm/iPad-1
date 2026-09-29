import {
  FilesetResolver,
  FaceLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { recordContinuously } from "./recording.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const ctx = overlay.getContext("2d");

// ---------- 설정 ----------

const DEFAULTS = { eyeSec: 2, headDeg: 25, noFaceSec: 6, volume: 0.7 };
const settings = { ...DEFAULTS };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("study-settings") || "{}"));
} catch {}

const EYE_CLOSED = 0.5; // 눈 감김 기준 (0=뜸, 1=감음)
const EYE_CLOSED_LOOKING_DOWN = 0.7; // 아래를 보면 눈꺼풀이 내려가 보여서 기준을 올림
const HEAD_DOWN_SEC = 2; // 고개가 이 시간 이상 떨어져 있으면 알람
const DROWSY_WINDOW_MS = 60_000; // 졸음 지수: 최근 1분 중 눈 감은 비율
const DROWSY_WARN = 0.2;
const SOFT_WARN_COOLDOWN_MS = 120_000;
const CALIB_MS = 3000;

function saveSettings() {
  try {
    localStorage.setItem("study-settings", JSON.stringify(settings));
  } catch {}
}

for (const key of Object.keys(DEFAULTS)) {
  const input = $(key);
  const label = $(`${key}-v`);
  const show = () => {
    label.textContent = key === "volume" ? `${Math.round(settings.volume * 100)}%` : settings[key];
  };
  input.value = settings[key];
  show();
  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    show();
    saveSettings();
    updateMarks();
  });
}

// ---------- 소리 ----------

let audio = null;
let alarmTimer = null;

function tone(freq, duration, volume, type = "square") {
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

// 삐-삐-삐 반복 알람
function startAlarmSound() {
  if (alarmTimer) return;
  let n = 0;
  const beep = () => {
    tone(n % 2 ? 660 : 990, 0.22, settings.volume * 0.5);
    n++;
  };
  beep();
  alarmTimer = setInterval(beep, 280);
}

function stopAlarmSound() {
  clearInterval(alarmTimer);
  alarmTimer = null;
}

// 부드러운 알림음 (졸음 예고)
function chime() {
  tone(660, 0.35, settings.volume * 0.3, "sine");
  setTimeout(() => tone(880, 0.5, settings.volume * 0.3, "sine"), 180);
}

$("test-sound").addEventListener("click", () => {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  tone(990, 0.2, settings.volume * 0.5);
  setTimeout(() => tone(660, 0.2, settings.volume * 0.5), 280);
});

// ---------- 상태 ----------

const state = {
  running: false,
  paused: false,
  calibUntil: 0,
  calibSamples: [],
  baselinePitch: null,
  pitch: null,
  eyeClosedSince: null,
  headDownSince: null,
  noFaceSince: null,
  yawnSince: null,
  yawnCounted: false,
  eyeWasClosedAt: null,
  alarm: null, // { reason }
  alarmClearSince: null,
  snoozeUntil: 0,
  lastSoftWarn: 0,
  closedSamples: [], // { t, closed }
  studyMs: 0,
  focusMs: 0,
  lastTick: 0,
  stats: { alarms: 0, blinks: 0, yawns: 0 },
};

const REASONS = {
  eyes: "눈을 오래 감고 있어요",
  head: "고개가 떨어졌어요",
  noface: "엎드렸거나 얼굴이 안 보여요",
};

// ---------- 얼굴 분석 ----------

// 고개 숙인 각도: 양쪽 볼 가운데 → 코끝 방향이 아래로 얼마나 기울었는지 (도)
function headPitch(lm) {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const nose = lm[1];
  const l = lm[234];
  const r = lm[454];
  const fy = (nose.y - (l.y + r.y) / 2) * h;
  const fz = (nose.z - (l.z + r.z) / 2) * w;
  return (Math.atan2(fy, -fz) * 180) / Math.PI;
}

function blendshapes(result) {
  const map = {};
  for (const c of result.faceBlendshapes?.[0]?.categories ?? []) map[c.categoryName] = c.score;
  return map;
}

function analyze(result, now) {
  const lm = result.faceLandmarks?.[0];
  const active = state.running && !state.paused;

  if (!lm) {
    state.eyeClosedSince = null;
    state.headDownSince = null;
    state.noFaceSince ??= now;
    if (active && !state.calibUntil && now - state.noFaceSince > settings.noFaceSec * 1000) {
      triggerAlarm("noface", now);
    }
    render({ face: false, now });
    return;
  }
  state.noFaceSince = null;

  const bs = blendshapes(result);
  const eye = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2;
  const jaw = bs.jawOpen ?? 0;

  const rawPitch = headPitch(lm);
  state.pitch = state.pitch == null ? rawPitch : state.pitch * 0.7 + rawPitch * 0.3;

  // 자세 맞추기: 평소 공부 자세의 고개 각도를 기준으로 삼는다
  if (state.calibUntil) {
    state.calibSamples.push(rawPitch);
    if (now >= state.calibUntil) finishCalibration();
  }

  const down = state.baselinePitch == null ? 0 : state.pitch - state.baselinePitch;
  const eyeLimit = down > 12 ? EYE_CLOSED_LOOKING_DOWN : EYE_CLOSED;
  const closed = eye > eyeLimit;
  const headDown = down > settings.headDeg;

  // 눈 감김
  if (closed) {
    state.eyeClosedSince ??= now;
  } else {
    // 0.4초 넘게 감았다 뜬 건 "긴 눈 감김" (졸음 신호)
    if (state.eyeClosedSince && now - state.eyeClosedSince > 400 && active) {
      state.stats.blinks++;
    }
    state.eyeClosedSince = null;
  }

  // 고개 떨어짐
  if (headDown) state.headDownSince ??= now;
  else state.headDownSince = null;

  // 하품
  if (jaw > 0.55) {
    state.yawnSince ??= now;
    if (!state.yawnCounted && now - state.yawnSince > 800 && active) {
      state.stats.yawns++;
      state.yawnCounted = true;
    }
  } else {
    state.yawnSince = null;
    state.yawnCounted = false;
  }

  // 졸음 지수 (최근 1분 중 눈 감고 있던 비율)
  if (active) {
    state.closedSamples.push({ t: now, closed });
    while (state.closedSamples.length && now - state.closedSamples[0].t > DROWSY_WINDOW_MS) {
      state.closedSamples.shift();
    }
  }
  const drowsy = drowsiness(now);

  if (active && !state.calibUntil) {
    if (state.eyeClosedSince && now - state.eyeClosedSince > settings.eyeSec * 1000) {
      triggerAlarm("eyes", now);
    } else if (state.headDownSince && now - state.headDownSince > HEAD_DOWN_SEC * 1000) {
      triggerAlarm("head", now);
    } else if (drowsy > DROWSY_WARN && now - state.lastSoftWarn > SOFT_WARN_COOLDOWN_MS) {
      state.lastSoftWarn = now;
      chime();
      toast("🥱 졸려 보여요. 잠깐 일어나서 스트레칭 어때요?");
    }
  }

  render({ face: true, lm, eye, eyeLimit, closed, down, headDown, drowsy, now });
}

function drowsiness(now) {
  const s = state.closedSamples;
  if (s.length < 30 || now - s[0].t < 20_000) return 0; // 데이터가 충분히 쌓인 뒤부터
  return s.filter((x) => x.closed).length / s.length;
}

// ---------- 알람 ----------

function triggerAlarm(reason, now) {
  if (state.alarm || now < state.snoozeUntil) return;
  state.alarm = { reason };
  state.alarmClearSince = null;
  state.stats.alarms++;
  addLog(REASONS[reason]);
  $("alarm-reason").textContent = REASONS[reason];
  $("alarm").hidden = false;
  startAlarmSound();
}

function stopAlarm(now) {
  state.alarm = null;
  state.eyeClosedSince = null;
  state.headDownSince = null;
  state.noFaceSince = null;
  state.snoozeUntil = now + 5000; // 깬 직후 5초는 다시 울리지 않음
  $("alarm").hidden = true;
  stopAlarmSound();
}

// 깨어난 상태가 1.5초 이어지면 알람이 저절로 꺼짐
function checkAlarmClear(awake, now) {
  if (!state.alarm) return;
  if (!awake) {
    state.alarmClearSince = null;
    return;
  }
  state.alarmClearSince ??= now;
  if (now - state.alarmClearSince > 1500) stopAlarm(now);
}

$("alarm-stop").addEventListener("click", () => stopAlarm(performance.now()));

function addLog(text) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  li.append(time, text);
  log.prepend(li);
  while (log.children.length > 20) log.lastChild.remove();
}

let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

// ---------- 화면 ----------

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

function setMeter(id, ratio, over) {
  const el = $(`${id}-fill`);
  el.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  el.classList.toggle("over", over);
}

const HEAD_METER_MAX = 60;
function updateMarks() {
  $("eye-mark").style.left = `${EYE_CLOSED * 100}%`;
  $("head-mark").style.left = `${(settings.headDeg / HEAD_METER_MAX) * 100}%`;
  $("drowsy-mark").style.left = `${(DROWSY_WARN / 0.5) * 100}%`;
}
updateMarks();

function render(info) {
  const w = (overlay.width = video.videoWidth);
  const h = (overlay.height = video.videoHeight);
  ctx.clearRect(0, 0, w, h);

  checkAlarmClear(info.face && !info.closed && !info.headDown, info.now);

  if (!info.face) {
    const sec = state.noFaceSince ? (info.now - state.noFaceSince) / 1000 : 0;
    setStatus(sec > 1 ? `😴 얼굴이 안 보여요 (${sec.toFixed(0)}초)` : "얼굴 찾는 중…", "bad");
    $("eye-value").textContent = "-";
    $("head-value").textContent = "-";
    return;
  }

  // 눈 표시
  ctx.fillStyle = info.closed ? "#ef5350" : "#3ecf8e";
  for (const i of [...LEFT_EYE, ...RIGHT_EYE]) {
    const p = info.lm[i];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(2, w / 250), 0, Math.PI * 2);
    ctx.fill();
  }

  setMeter("eye", info.eye, info.closed);
  $("eye-value").textContent = `${Math.round(info.eye * 100)}%`;
  $("eye-mark").style.left = `${info.eyeLimit * 100}%`;

  const down = Math.max(0, info.down);
  setMeter("head", down / HEAD_METER_MAX, info.headDown);
  $("head-value").textContent = state.baselinePitch == null ? "-" : `${Math.round(info.down)}°`;

  setMeter("drowsy", info.drowsy / 0.5, info.drowsy > DROWSY_WARN);
  $("drowsy-value").textContent = info.drowsy ? `${Math.round(info.drowsy * 100)}%` : "-";

  if (!state.running) setStatus("대기 중", "idle");
  else if (state.paused) setStatus("☕ 쉬는 중", "idle");
  else if (state.calibUntil) setStatus("🎯 자세 맞추는 중", "warn");
  else if (info.closed) setStatus("👁 눈 감음", "warn");
  else if (info.headDown) setStatus("🙇 고개 숙임", "warn");
  else if (info.drowsy > DROWSY_WARN) setStatus("🥱 졸려 보여요", "warn");
  else setStatus("✅ 집중 중", "focus");
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function tick(now) {
  const dt = state.lastTick ? now - state.lastTick : 0;
  state.lastTick = now;
  if (state.running && !state.paused && !state.calibUntil) {
    state.studyMs += dt;
    if ($("status").classList.contains("focus")) state.focusMs += dt;
  }
  $("timer").textContent = formatTime(state.studyMs);
  $("focus-rate").textContent = state.studyMs > 5000 ? `${Math.round((state.focusMs / state.studyMs) * 100)}%` : "-";
  $("stat-alarms").textContent = state.stats.alarms;
  $("stat-blinks").textContent = state.stats.blinks;
  $("stat-yawns").textContent = state.stats.yawns;

  if (state.calibUntil) {
    $("calib-count").textContent = Math.max(1, Math.ceil((state.calibUntil - now) / 1000));
  }
}

// ---------- 자세 맞추기 ----------

function startCalibration() {
  state.calibUntil = performance.now() + CALIB_MS;
  state.calibSamples = [];
  $("calib").hidden = false;
}

function finishCalibration() {
  const s = [...state.calibSamples].sort((a, b) => a - b);
  if (s.length < 10) {
    // 얼굴이 잘 안 잡혔으면 한 번 더
    startCalibration();
    return;
  }
  state.baselinePitch = s[Math.floor(s.length / 2)];
  state.calibUntil = 0;
  $("calib").hidden = true;
}

$("recalibrate").addEventListener("click", startCalibration);

$("pause").addEventListener("click", (e) => {
  state.paused = !state.paused;
  e.currentTarget.textContent = state.paused ? "▶️ 다시 공부" : "⏸ 쉬는 시간";
  e.currentTarget.classList.toggle("active", state.paused);
  if (state.paused && state.alarm) stopAlarm(performance.now());
  state.closedSamples = [];
});

// ---------- 메인 루프 ----------

let landmarker = null;
let lastVideoTime = -1;

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    analyze(landmarker.detectForVideo(video, now), now);
  }
  tick(now);
}

// 공부하는 동안 화면이 꺼지지 않게
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running) keepAwake();
});

$("start").addEventListener("click", async () => {
  const button = $("start");
  button.disabled = true;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 카메라를 지원하지 않아요 (https 주소로 열어 주세요)");
    }
    button.textContent = "카메라 켜는 중…";
    // "다시 시도" 때는 이미 켜진 카메라(와 녹화)를 그대로 쓴다
    video.srcObject ??= await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
    await video.play();

    // 카메라가 허용되자마자 녹화 시작 (모델 불러오는 동안도 녹화). recording.js 참고
    recordContinuously(video.srcObject, { prefix: "study" });

    button.textContent = "얼굴 인식 모델 불러오는 중…";
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    };
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      landmarker = await FaceLandmarker.createFromOptions(vision, options);
    }

    $("start-screen").hidden = true;
    $("pause").disabled = false;
    $("recalibrate").disabled = false;
    state.running = true;
    keepAwake();
    startCalibration();
  } catch (err) {
    console.error(err);
    $("start-error").textContent =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요."
        : err.message || String(err);
    button.textContent = "다시 시도";
    button.disabled = false;
  }
});

loop();
