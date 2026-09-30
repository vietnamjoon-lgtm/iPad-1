import * as THREE from "three";
import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { recordContinuously } from "./recording.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// ---------- 녹화 설정 ----------
// 카메라를 켠 순간부터 페이지를 닫을 때까지 3분마다 드라이브로 보낸다 (recording.js).

const REC = {
  BITRATE: 300_000, // 영상 비트레이트 (bps). 낮출수록 파일이 작아짐.
  WIDTH: 480, // 녹화용 카메라 해상도 (낮게)
  HEIGHT: 360,
  FPS: 15,
};

// ---------- 규격 (단위: 미터, 초) ----------
// 탁구대 가운데가 원점. 내 쪽은 +z, AI 쪽은 -z.

const TABLE_LENGTH = 2.74;
const TABLE_WIDTH = 1.525;
const TABLE_HEIGHT = 0.76;
const NET_HEIGHT = 0.1525;
const HALF_L = TABLE_LENGTH / 2;
const HALF_W = TABLE_WIDTH / 2;
const NET_TOP = TABLE_HEIGHT + NET_HEIGHT;
const NET_HALF_WIDTH = 0.915;

const BALL_R = 0.02;
const GRAVITY = 9.81;
const DRAG = 0.08;
const TABLE_BOUNCE = 0.88;

const PLAYER_HIT_HEIGHT = 0.34; // 공과 라켓 높이 차이가 이 안이면 맞음 (넉넉하게)
const AI_Z = -HALF_L - 0.25;
const AI_SPEED = 1.3; // AI 라켓 좌우 이동 속도 (m/s)
const AI_REACH = 0.18;

const WIN_SCORE = 11;
const SWING_WINDOW_MS = 120;
const SWING_MEMORY_MS = 380;
const MIN_SWING_SPEED = 0.7; // 손목 속도(m/s). 이보다 느리면 휘두른 게 아님 → 공이 라켓을 지나감

const $ = (id) => document.getElementById(id);
const video = $("video");
const clamp = THREE.MathUtils.clamp;

// ---------- 장면 ----------

const renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f1fb);
scene.fog = new THREE.Fog(0xf3f1fb, 6, 16);

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 50);
const CAMERA_BASE = new THREE.Vector3(0, 1.45, 2.4);
const CAMERA_LOOK = new THREE.Vector3(0, 0.78, -0.4);
camera.position.copy(CAMERA_BASE);
camera.lookAt(CAMERA_LOOK);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1a28, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 5, 2);
scene.add(sun);

function box(w, h, d, color, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

// 바닥
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x1b2036, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// 탁구대
box(TABLE_WIDTH, 0.03, TABLE_LENGTH, 0x1c5aa6, 0, TABLE_HEIGHT - 0.015, 0, { roughness: 0.45 });
const LINE = 0.02;
const lineY = TABLE_HEIGHT + 0.0005;
box(LINE, 0.001, TABLE_LENGTH, 0xffffff, -HALF_W + LINE / 2, lineY, 0);
box(LINE, 0.001, TABLE_LENGTH, 0xffffff, HALF_W - LINE / 2, lineY, 0);
box(TABLE_WIDTH, 0.001, LINE, 0xffffff, 0, lineY, -HALF_L + LINE / 2);
box(TABLE_WIDTH, 0.001, LINE, 0xffffff, 0, lineY, HALF_L - LINE / 2);
box(0.003, 0.001, TABLE_LENGTH, 0xffffff, 0, lineY, 0);
for (const x of [-HALF_W + 0.1, HALF_W - 0.1]) {
  for (const z of [-HALF_L + 0.15, HALF_L - 0.15]) {
    box(0.05, TABLE_HEIGHT - 0.03, 0.05, 0x222633, x, (TABLE_HEIGHT - 0.03) / 2, z);
  }
}

// 네트
const net = new THREE.Mesh(
  new THREE.PlaneGeometry(NET_HALF_WIDTH * 2, NET_HEIGHT),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
);
net.position.set(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0);
scene.add(net);
box(NET_HALF_WIDTH * 2, 0.012, 0.006, 0xffffff, 0, NET_TOP - 0.006, 0);

// 공
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 20, 14),
  new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0x552200, roughness: 0.4 })
);
scene.add(ballMesh);

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(BALL_R * 1.4, 20),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

const TRAIL_LENGTH = 14;
const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
const trail = new THREE.Line(
  trailGeometry,
  new THREE.LineBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.35 })
);
trail.frustumCulled = false;
scene.add(trail);

// 라켓: 면의 법선이 로컬 +Z, 손잡이는 로컬 -Y
function createPaddle(rubberColor) {
  const group = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: rubberColor, roughness: 0.5, emissive: 0x000000 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.012, 36), rubber);
  blade.rotation.x = Math.PI / 2;
  group.add(blade);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.1, 0.022),
    new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.7 })
  );
  handle.position.y = -0.12;
  group.add(handle);
  scene.add(group);
  return { group, rubber };
}

const playerPaddle = createPaddle(0xe0463a);
const aiPaddle = createPaddle(0x2d7be0);
aiPaddle.group.position.set(0, 1.0, AI_Z);

// 1인칭 팔: 어깨-팔꿈치-손목을 원기둥과 구로 잇는다
function createArm() {
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4d8f, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c4a0, roughness: 0.6 });
  const limb = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  const joint = new THREE.SphereGeometry(1, 18, 12);
  const make = (geo, mat, r) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(r);
    scene.add(m);
    return m;
  };
  return {
    shoulder: make(joint, sleeve, 0.055),
    upper: make(limb, sleeve, 0.05),
    elbow: make(joint, skin, 0.042),
    fore: make(limb, skin, 0.038),
    fist: make(joint, skin, 0.045),
  };
}
const armMesh = createArm();

const UP = new THREE.Vector3(0, 1, 0);
const limbDir = new THREE.Vector3();
function placeLimb(mesh, a, b) {
  limbDir.subVectors(b, a);
  const len = limbDir.length();
  if (len < 1e-6) return;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, limbDir.divideScalar(len));
  mesh.scale.y = len;
}

// ---------- 소리 ----------

let audio = null;
function blip(freq, duration = 0.06, volume = 0.25, type = "triangle") {
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration);
}

// ---------- 팔 → 라켓 ----------
// 좌우는 자동으로 공을 따라가고(몸이 옆으로 이동), 높이·앞뒤·휘두르기는 내 팔이 움직인다.

// MediaPipe Pose 관절 번호: 어깨, 팔꿈치, 손목
const ARM_JOINTS = { right: [12, 14, 16], left: [11, 13, 15] };
let side = "right";
try {
  side = localStorage.getItem("pingpong-side") === "left" ? "left" : "right";
} catch {}

const ARM_SCALE = 1.15; // 팔 움직임을 조금 키워서 닿는 범위를 넓힘

const arm = {
  elbow: new THREE.Vector3(0, -0.28, -0.05), // 어깨 기준 상대 위치 (게임 좌표)
  wrist: new THREE.Vector3(0, -0.3, -0.3),
  target: { elbow: new THREE.Vector3(0, -0.28, -0.05), wrist: new THREE.Vector3(0, -0.3, -0.3) },
  history: [], // 최근 손목 위치 (휘두르는 속도 계산용)
  speeds: [], // 최근 휘두르는 속도 기록
  lastSeen: 0,
  bodyX: 0, // 몸 좌우 위치 (자동)
};

const paddle = {
  pos: new THREE.Vector3(0, 1.05, 1.6),
  prevPos: new THREE.Vector3(0, 1.05, 1.6),
  hitAt: -1e9,
};

// 웹캠은 나를 마주 보고, 게임 카메라는 나와 같은 방향을 본다.
// 그래서 웹캠 좌표를 z축으로 180° 돌리면 게임 좌표가 된다.
const toGame = (p) => new THREE.Vector3(-p.x, -p.y, p.z);

function onPose(landmarks, world, now) {
  const [s, e, w] = ARM_JOINTS[side];
  const vis = (i) => landmarks[i].visibility ?? 1;
  if (vis(s) < 0.5 || vis(e) < 0.3 || vis(w) < 0.3) return; // 팔이 화면에 안 보임

  const S = toGame(world[s]);
  const W = toGame(world[w]);
  arm.target.elbow.copy(toGame(world[e])).sub(S).multiplyScalar(ARM_SCALE);
  arm.target.wrist.copy(W).sub(S).multiplyScalar(ARM_SCALE);

  arm.history.push({ t: now, p: W });
  while (arm.history.length > 2 && now - arm.history[0].t > SWING_WINDOW_MS) {
    arm.history.shift();
  }
  arm.lastSeen = now;

  arm.speeds.push({ t: now, s: swingSpeed(now) });
  while (arm.speeds.length > 0 && now - arm.speeds[0].t > SWING_MEMORY_MS) {
    arm.speeds.shift();
  }
}

const swingVel = new THREE.Vector3();
function swingSpeed(now) {
  const h = arm.history;
  if (h.length < 2 || now - arm.lastSeen > 200) return 0;
  const a = h[0];
  const b = h[h.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt < 0.02) return 0;
  return swingVel.subVectors(b.p, a.p).divideScalar(dt).length();
}

// 방금(SWING_MEMORY_MS 안에) 휘두른 가장 빠른 속도. 인식이 조금 늦어도 타이밍이 맞게.
function swingPeak(now) {
  if (now - arm.lastSeen > 200) return 0;
  let peak = 0;
  for (const { t, s } of arm.speeds) {
    if (now - t <= SWING_MEMORY_MS) peak = Math.max(peak, s);
  }
  return peak;
}

// 손목 속도(m/s) → 세기 0~1.35 (1을 넘으면 아웃 위험)
const powerFrom = (speed) => clamp((speed - 0.8) / 3.4, 0, 1.35);

// ---------- 게임 상태 ----------

const ball = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  prev: new THREE.Vector3(),
};

const game = {
  state: "menu", // menu | serve | play | point | over
  score: { player: 0, ai: 0 },
  server: "player",
  lastHitter: null,
  bounces: { player: 0, ai: 0 },
  netHit: false,
  rally: 0,
  aiServeAt: 0,
};

const trailPoints = [];

// 출발점에서 목표 지점(탁구대 위)으로 떨어지는 속도 계산. 네트는 넘도록 보정.
function solveShot(from, target, hspeed) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const dist = Math.hypot(dx, dz);
  const t = dist / hspeed;
  let vy = (target.y - from.y + 0.5 * GRAVITY * t * t) / t;

  if (from.z * target.z < 0) {
    const f = from.z / (from.z - target.z);
    const tn = t * f;
    const yAtNet = from.y + vy * tn - 0.5 * GRAVITY * tn * tn;
    const need = NET_TOP + BALL_R + 0.04;
    if (yAtNet < need) {
      // 네트 위 지점과 목표 지점을 모두 지나는 포물선으로 다시 계산
      const d1 = dist * f;
      const d2 = dist;
      const e1 = need - from.y;
      const e2 = target.y - from.y;
      const w = (e2 - (e1 * d2) / d1) / (d2 * (d1 - d2));
      if (w > 0) {
        const a = Math.sqrt((2 * w) / GRAVITY);
        const u = (e1 + w * d1 * d1) / d1;
        hspeed = 1 / a;
        vy = u / a;
      }
    }
  }
  return new THREE.Vector3((dx / dist) * hspeed, vy, (dz / dist) * hspeed);
}

function startRallyShot(hitter) {
  game.lastHitter = hitter;
  game.bounces.player = 0;
  game.bounces.ai = 0;
  game.netHit = false;
  game.state = "play";
}

function playerHit(now) {
  const power = powerFrom(swingPeak(now));

  const hspeed = 3.2 + power * 7.5;
  const tz = -0.35 - power * 0.9;
  // 방향은 신경 쓰지 않아도 되게, 좌우는 항상 탁구대 안쪽으로 보낸다
  const tx = clamp(ball.pos.x * 0.3, -0.5, 0.5);

  ball.vel.copy(solveShot(ball.pos, new THREE.Vector3(tx, TABLE_HEIGHT + BALL_R, tz), hspeed));
  startRallyShot("player");
  game.rally++;

  $("speed").textContent = `${Math.round(ball.vel.length() * 3.6)} km/h`;
  $("power-last").style.bottom = `${Math.min(power / 1.35, 1) * 100}%`;
  $("power-last").style.opacity = 1;
  updateRally();

  paddle.hitAt = performance.now();
  blip(420 + power * 300, 0.07, 0.35);
}

function aiHit() {
  const target = new THREE.Vector3(
    (Math.random() * 2 - 1) * 0.55,
    TABLE_HEIGHT + BALL_R,
    0.45 + Math.random() * 0.75
  );
  const hspeed = 3.4 + Math.min(game.rally * 0.08, 1.6) + Math.random() * 0.6;
  ball.vel.copy(solveShot(ball.pos, target, hspeed));
  startRallyShot("ai");
  game.rally++;
  updateRally();
  blip(380, 0.07, 0.3);
}

function onTableBounce(side) {
  blip(side === "player" ? 950 : 800, 0.05, 0.25);
  if (game.state !== "play") return;

  const other = game.lastHitter === "player" ? "ai" : "player";
  if (side === game.lastHitter) {
    // 친 사람 쪽에 떨어짐 → 실점
    awardPoint(other, game.netHit ? "네트에 걸렸어요" : "내 코트에 떨어졌어요");
    return;
  }
  game.bounces[side]++;
  if (game.bounces[side] >= 2) {
    awardPoint(game.lastHitter, side === "ai" ? "AI가 못 받았어요" : "공을 놓쳤어요");
  }
}

function onBallOut() {
  if (game.state !== "play") return;
  const receiver = game.lastHitter === "player" ? "ai" : "player";
  if (game.bounces[receiver] >= 1) {
    awardPoint(game.lastHitter, receiver === "ai" ? "AI가 못 받았어요" : "공을 놓쳤어요");
  } else {
    awardPoint(receiver, game.netHit ? "네트에 걸렸어요" : "아웃!");
  }
}

function awardPoint(winner, reason) {
  game.state = "point";
  game.score[winner]++;
  updateScore();

  const title = winner === "player" ? "득점! 🎉" : "실점 😵";
  showMessage(`${title}<small>${reason}</small>`, 1400);

  const { player, ai } = game.score;
  const leader = player > ai ? "player" : "ai";
  if (Math.max(player, ai) >= WIN_SCORE && Math.abs(player - ai) >= 2) {
    setTimeout(() => endGame(leader), 1500);
  } else {
    setTimeout(prepareServe, 1500);
  }
}

function prepareServe() {
  const total = game.score.player + game.score.ai;
  const deuce = game.score.player >= WIN_SCORE - 1 && game.score.ai >= WIN_SCORE - 1;
  const turn = deuce ? total : Math.floor(total / 2);
  game.server = turn % 2 === 0 ? "player" : "ai";
  game.rally = 0;
  game.lastHitter = null;
  updateRally();
  trailPoints.length = 0;

  if (game.server === "player") {
    game.state = "serve";
    $("serve-info").textContent = "내 서브 — 공 높이에 맞춰 휘두르세요";
  } else {
    game.state = "serve";
    game.aiServeAt = performance.now() + 1200;
    ball.pos.set(aiPaddle.group.position.x, 1.0, AI_Z + 0.1);
    ball.vel.set(0, 0, 0);
    $("serve-info").textContent = "AI 서브";
  }
}

function endGame(winner) {
  game.state = "over";
  $("overlay-title").textContent = winner === "player" ? "🏆 승리!" : "패배… 다시 도전!";
  $("overlay-body").innerHTML = `<li>최종 점수 <b>${game.score.player} : ${game.score.ai}</b></li>`;
  $("start").textContent = "다시 하기";
  $("start").disabled = false;
  $("hint").textContent = "";
  $("overlay-screen").hidden = false;
}

function newGame() {
  game.score.player = 0;
  game.score.ai = 0;
  updateScore();
  $("speed").textContent = "- km/h";
  $("power-last").style.opacity = 0;
  prepareServe();
}

// ---------- UI ----------

let messageTimer = 0;
function showMessage(html, duration) {
  const el = $("message");
  el.innerHTML = html;
  el.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => el.classList.remove("show"), duration);
}

function updateScore() {
  $("score-player").textContent = game.score.player;
  $("score-ai").textContent = game.score.ai;
}

function updateRally() {
  $("rally").textContent = game.rally > 1 ? `랠리 ${game.rally}` : "";
}

// ---------- 물리 ----------

const paddleAt = new THREE.Vector3();
const paddlePrevAt = new THREE.Vector3();

function stepBall(h, frac0, frac1, now) {
  ball.prev.copy(ball.pos);
  ball.vel.y -= GRAVITY * h;
  ball.vel.multiplyScalar(1 - DRAG * h);
  ball.pos.addScaledVector(ball.vel, h);

  // 탁구대
  if (
    ball.vel.y < 0 &&
    ball.pos.y - BALL_R <= TABLE_HEIGHT &&
    ball.prev.y - BALL_R >= TABLE_HEIGHT - 0.02 &&
    Math.abs(ball.pos.x) <= HALF_W &&
    Math.abs(ball.pos.z) <= HALF_L
  ) {
    ball.pos.y = TABLE_HEIGHT + BALL_R;
    ball.vel.y = -ball.vel.y * TABLE_BOUNCE;
    ball.vel.x *= 0.97;
    ball.vel.z *= 0.97;
    onTableBounce(ball.pos.z > 0 ? "player" : "ai");
  }

  // 네트
  if (
    ball.prev.z * ball.pos.z <= 0 &&
    ball.prev.z !== ball.pos.z &&
    ball.pos.y - BALL_R < NET_TOP &&
    ball.pos.y > TABLE_HEIGHT &&
    Math.abs(ball.pos.x) < NET_HALF_WIDTH
  ) {
    ball.pos.z = Math.sign(ball.prev.z || 1) * BALL_R;
    ball.vel.z *= -0.15;
    ball.vel.x *= 0.5;
    game.netHit = true;
    blip(180, 0.08, 0.3, "sine");
  }

  // 바닥
  if (ball.pos.y - BALL_R <= 0) {
    ball.pos.y = BALL_R;
    ball.vel.y = -ball.vel.y * 0.6;
    ball.vel.x *= 0.8;
    ball.vel.z *= 0.8;
    if (Math.abs(ball.vel.y) > 0.5) blip(300, 0.05, 0.15);
    onBallOut();
  }
  if (Math.abs(ball.pos.z) > 5 || Math.abs(ball.pos.x) > 5) onBallOut();

  if (game.state !== "play") return;

  // 내 라켓: 공이 라켓 면(z)을 지나가는 순간 높이가 맞으면 맞음
  if (game.lastHitter === "ai" && ball.vel.z > 0) {
    paddlePrevAt.lerpVectors(paddle.prevPos, paddle.pos, frac0);
    paddleAt.lerpVectors(paddle.prevPos, paddle.pos, frac1);
    const before = ball.prev.z - paddlePrevAt.z;
    const after = ball.pos.z - paddleAt.z;
    if (before < 0 && after >= 0) {
      const k = before / (before - after);
      const by = THREE.MathUtils.lerp(ball.prev.y, ball.pos.y, k);
      // 높이가 맞고, 실제로 휘두르고 있어야 맞는다 (가만히 대고 있으면 그냥 지나감)
      if (Math.abs(by - paddleAt.y) < PLAYER_HIT_HEIGHT && swingPeak(now) >= MIN_SWING_SPEED) {
        ball.pos.z = paddleAt.z - 0.01;
        playerHit(now);
      }
    }
  }

  // AI 라켓
  if (
    game.lastHitter === "player" &&
    game.bounces.ai === 1 &&
    ball.prev.z > AI_Z &&
    ball.pos.z <= AI_Z
  ) {
    const incoming = Math.hypot(ball.vel.x, ball.vel.z);
    const missChance = 0.12 + Math.max(0, incoming - 5) * 0.09;
    const reachable = Math.abs(ball.pos.x - aiPaddle.group.position.x) < AI_REACH;
    if (reachable && Math.random() > missChance) aiHit();
  }
}

function updateAI(dt) {
  const ai = aiPaddle.group.position;
  let targetX = 0;
  let targetY = 1.0;
  if (game.state === "play" && game.lastHitter === "player" && ball.vel.z < 0) {
    const t = (ball.pos.z - AI_Z) / -ball.vel.z;
    targetX = ball.pos.x + ball.vel.x * t;
    targetY = clamp(ball.pos.y, 0.85, 1.3);
  } else if (game.state === "serve" && game.server === "ai") {
    targetX = ai.x;
  }
  ai.x += clamp(targetX - ai.x, -AI_SPEED * dt, AI_SPEED * dt);
  ai.y += (targetY - ai.y) * Math.min(1, dt * 4);
  aiPaddle.group.rotation.z = -ai.x * 0.4;
}

// 어깨는 카메라(눈) 기준 옆·아래에 붙어 있다
const SHOULDER_OFFSET = new THREE.Vector3(0.2, -0.12, -0.18);
const shoulderPos = new THREE.Vector3();
const elbowPos = new THREE.Vector3();
const wristPos = new THREE.Vector3();
const paddleUp = new THREE.Vector3();
const paddleFace = new THREE.Vector3();
const paddleSide = new THREE.Vector3();
const paddleBasis = new THREE.Matrix4();
const PADDLE_REACH = 0.16; // 손목에서 라켓 중심까지

function updatePaddle() {
  paddle.prevPos.copy(paddle.pos);

  arm.elbow.lerp(arm.target.elbow, 0.6);
  arm.wrist.lerp(arm.target.wrist, 0.6);
  paddleUp.subVectors(arm.wrist, arm.elbow).normalize(); // 팔뚝 방향 = 라켓 손잡이 방향

  // 좌우(x)만 자동: 공이 오면 라켓이 공 앞에 오도록 몸이 옆으로 이동
  const sideSign = side === "right" ? 1 : -1;
  const paddleRelX = sideSign * SHOULDER_OFFSET.x + arm.wrist.x + paddleUp.x * PADDLE_REACH;
  const coming = (game.state === "play" && game.lastHitter === "ai") || game.state === "serve";
  const goalX = coming ? ball.pos.x - paddleRelX : 0;
  arm.bodyX += (clamp(goalX, -1.3, 1.3) - arm.bodyX) * 0.25;

  shoulderPos.set(
    arm.bodyX + sideSign * SHOULDER_OFFSET.x,
    CAMERA_BASE.y + SHOULDER_OFFSET.y,
    CAMERA_BASE.z + SHOULDER_OFFSET.z
  );
  elbowPos.addVectors(shoulderPos, arm.elbow);
  wristPos.addVectors(shoulderPos, arm.wrist);
  paddle.pos.copy(wristPos).addScaledVector(paddleUp, PADDLE_REACH);

  // 팔 그리기
  armMesh.shoulder.position.copy(shoulderPos);
  armMesh.elbow.position.copy(elbowPos);
  armMesh.fist.position.copy(wristPos);
  placeLimb(armMesh.upper, shoulderPos, elbowPos);
  placeLimb(armMesh.fore, elbowPos, wristPos);

  // 라켓: 손잡이는 팔뚝 방향, 면은 최대한 앞을 보게
  paddleFace.set(0, 0, 1).addScaledVector(paddleUp, -paddleUp.z);
  if (paddleFace.lengthSq() < 1e-4) paddleFace.set(1, 0, 0);
  paddleFace.normalize();
  paddleSide.crossVectors(paddleUp, paddleFace);
  paddleBasis.makeBasis(paddleSide, paddleUp, paddleFace);
  playerPaddle.group.quaternion.setFromRotationMatrix(paddleBasis);
  playerPaddle.group.position.copy(paddle.pos);
  playerPaddle.rubber.emissive.setHex(performance.now() - paddle.hitAt < 150 ? 0x773322 : 0x000000);
}

// ---------- 팔 인식 ----------

let landmarker = null;
let lastVideoTime = -1;

function detect(now) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, now);
  if (result.landmarks.length > 0) {
    onPose(result.landmarks[0], result.worldLandmarks[0], now);
    drawPreview(result.landmarks[0]);
  } else {
    drawPreview(null);
  }
}

// 카메라 미리보기 위에 인식된 팔 표시
const previewCanvas = $("preview-overlay");
const previewCtx = previewCanvas.getContext("2d");
function drawPreview(landmarks) {
  const w = (previewCanvas.width = video.videoWidth);
  const h = (previewCanvas.height = video.videoHeight);
  previewCtx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  const pts = ARM_JOINTS[side].map((i) => landmarks[i]);
  previewCtx.strokeStyle = "#ff8a5c";
  previewCtx.fillStyle = "#fff";
  previewCtx.lineWidth = Math.max(3, w / 120);
  previewCtx.beginPath();
  pts.forEach((p, i) => (i === 0 ? previewCtx.moveTo(p.x * w, p.y * h) : previewCtx.lineTo(p.x * w, p.y * h)));
  previewCtx.stroke();
  for (const p of pts) {
    previewCtx.beginPath();
    previewCtx.arc(p.x * w, p.y * h, Math.max(5, w / 90), 0, Math.PI * 2);
    previewCtx.fill();
  }
}

// ---------- 메인 루프 ----------

let lastFrame = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  detect(now);

  updatePaddle();

  const armLost = game.state !== "menu" && game.state !== "over" && now - arm.lastSeen > 400;
  $("tracking-warning").hidden = !armLost;

  // 세기 게이지 (지금 휘두르는 속도)
  const livePower = powerFrom(swingSpeed(now));
  $("power-fill").style.height = `${(1 - Math.min(livePower / 1.35, 1)) * 100}%`;

  if (game.state === "serve") {
    if (game.server === "player") {
      // 공이 내 앞에 둥실 떠 있음
      ball.prev.copy(ball.pos);
      ball.pos.set(paddle.pos.x, 1.05 + Math.sin(now / 300) * 0.05, 1.55);
      ball.vel.set(0, 0, 0);
      // 라켓 높이를 맞추고 휘두르면 서브
      const aligned = Math.abs(ball.pos.y - paddle.pos.y) < PLAYER_HIT_HEIGHT;
      if (aligned && swingPeak(now) >= MIN_SWING_SPEED) {
        playerHit(now);
        $("serve-info").textContent = "";
      }
    } else if (now >= game.aiServeAt) {
      ball.pos.set(aiPaddle.group.position.x, 1.0, AI_Z + 0.1);
      aiHit();
      game.rally = 0;
      updateRally();
      $("serve-info").textContent = "";
    }
  } else if (game.state === "play" || game.state === "point") {
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      stepBall(dt / steps, i / steps, (i + 1) / steps, now);
    }
  }

  updateAI(dt);

  // 공, 그림자, 궤적
  ballMesh.position.copy(ball.pos);
  const overTable = Math.abs(ball.pos.x) < HALF_W && Math.abs(ball.pos.z) < HALF_L;
  const groundY = overTable ? TABLE_HEIGHT + 0.001 : 0.001;
  const height = Math.max(0, ball.pos.y - groundY);
  shadow.position.set(ball.pos.x, groundY, ball.pos.z);
  shadow.scale.setScalar(1 + height * 1.5);
  shadow.material.opacity = clamp(0.5 - height * 0.4, 0.1, 0.5);

  if (game.state === "play") {
    trailPoints.unshift(ball.pos.clone());
    if (trailPoints.length > TRAIL_LENGTH) trailPoints.pop();
  }
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const p = trailPoints[Math.min(i, trailPoints.length - 1)] || ball.pos;
    trailPositions.set([p.x, p.y, p.z], i * 3);
  }
  trailGeometry.attributes.position.needsUpdate = true;

  // 몸이 옆으로 움직이면 시점도 같이 (탁구대 가운데를 계속 봄)
  camera.position.x = CAMERA_BASE.x + arm.bodyX;
  camera.lookAt(CAMERA_LOOK.x + arm.bodyX * 0.4, CAMERA_LOOK.y, CAMERA_LOOK.z);

  renderer.render(scene, camera);
}

// ---------- 시작 ----------

async function setupTracking() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("이 브라우저는 카메라를 지원하지 않아요 (https 또는 localhost에서 열어 주세요)");
  }
  $("start").textContent = "카메라 켜는 중…";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: REC.WIDTH },
      height: { ideal: REC.HEIGHT },
      frameRate: { ideal: REC.FPS },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  recordContinuously(stream, { prefix: "pingpong", bitrate: REC.BITRATE });

  $("start").textContent = "팔 인식 모델 불러오는 중…";
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  };
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    landmarker = await PoseLandmarker.createFromOptions(vision, options);
  }
}

$("start").addEventListener("click", async () => {
  const button = $("start");
  button.disabled = true;
  try {
    // 소리는 사용자가 버튼을 눌렀을 때만 켤 수 있음
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (!landmarker) await setupTracking();
    $("overlay-screen").hidden = true;
    newGame();
  } catch (err) {
    console.error(err);
    const message =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요."
        : err.message || String(err);
    button.textContent = "다시 시도";
    button.disabled = false;
    $("hint").textContent = message;
  }
});

// 오른손잡이 / 왼손잡이 선택
function renderSidePick() {
  for (const b of document.querySelectorAll("#side-pick button")) {
    b.classList.toggle("active", b.dataset.side === side);
  }
}
for (const b of document.querySelectorAll("#side-pick button")) {
  b.addEventListener("click", () => {
    side = b.dataset.side;
    try {
      localStorage.setItem("pingpong-side", side);
    } catch {}
    renderSidePick();
  });
}
renderSidePick();

ball.pos.set(0, 1.05, 1.55);
animate();
