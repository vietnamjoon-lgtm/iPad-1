import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// MediaPipe 손 관절 21개를 잇는 뼈대
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// 손바닥 면 (0=손목, 1=엄지 뿌리, 5/9/13/17=손가락 뿌리)
const PALM_POINTS = [0, 1, 5, 9, 13, 17];
const PALM_TRIANGLES = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

// 관절 굵기: 손목·뿌리는 두껍고 손끝으로 갈수록 가늘게
const JOINT_RADIUS = [
  0.13,
  0.11, 0.1, 0.09, 0.08,
  0.1, 0.085, 0.075, 0.065,
  0.1, 0.085, 0.075, 0.065,
  0.095, 0.08, 0.07, 0.06,
  0.09, 0.07, 0.06, 0.055,
];

const HAND_SCALE = 10; // 미터 → 장면 단위 (손 길이 약 2 단위)
const SMOOTHING = 0.55; // 0~1, 클수록 빠르게 따라감

const HAND_COLORS = { left: 0x4fc3ff, right: 0xff8a5c };

const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const overlayCtx = overlay.getContext("2d");
const statusEl = $("status");
const fpsEl = $("fps");

// ---------- 3D 장면 ----------

const renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
const CAMERA_HOME = new THREE.Vector3(0, 0, 8);
camera.position.copy(CAMERA_HOME);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202030, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(3, 5, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8899ff, 0.8);
rimLight.position.set(-4, -2, -5);
scene.add(rimLight);

const grid = new THREE.GridHelper(20, 20, 0x3a4270, 0x222844);
grid.position.y = -4;
scene.add(grid);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- 3D 손 모델 ----------

const UP = new THREE.Vector3(0, 1, 0);
const jointGeometry = new THREE.SphereGeometry(1, 20, 14);
const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);

function createHand(color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.15,
    transparent: true,
  });
  const palmMaterial = material.clone();
  palmMaterial.side = THREE.DoubleSide;

  const group = new THREE.Group();
  group.visible = false;

  const joints = JOINT_RADIUS.map((r) => {
    const mesh = new THREE.Mesh(jointGeometry, material);
    mesh.scale.setScalar(r);
    group.add(mesh);
    return mesh;
  });

  const bones = CONNECTIONS.map(([a, b]) => {
    const mesh = new THREE.Mesh(boneGeometry, material);
    mesh.userData.radius = Math.min(JOINT_RADIUS[a], JOINT_RADIUS[b]);
    group.add(mesh);
    return mesh;
  });

  const palmGeometry = new THREE.BufferGeometry();
  palmGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(PALM_POINTS.length * 3), 3)
  );
  palmGeometry.setIndex(PALM_TRIANGLES);
  const palm = new THREE.Mesh(palmGeometry, palmMaterial);
  group.add(palm);

  scene.add(group);

  return {
    group,
    joints,
    bones,
    palm,
    materials: [material, palmMaterial],
    target: Array.from({ length: 21 }, () => new THREE.Vector3()),
    current: Array.from({ length: 21 }, () => new THREE.Vector3()),
    opacity: 0,
    seen: false, // 이번 프레임에 감지됐는지
    fresh: true, // 방금 나타났으면 보간 없이 바로 위치시킴
  };
}

const hands = {
  left: createHand(HAND_COLORS.left),
  right: createHand(HAND_COLORS.right),
};

const tmpDir = new THREE.Vector3();

function updateHandMesh(hand) {
  const { current, target } = hand;

  for (let i = 0; i < 21; i++) {
    if (hand.fresh) current[i].copy(target[i]);
    else current[i].lerp(target[i], SMOOTHING);
    hand.joints[i].position.copy(current[i]);
  }
  hand.fresh = false;

  CONNECTIONS.forEach(([a, b], k) => {
    const bone = hand.bones[k];
    tmpDir.subVectors(current[b], current[a]);
    const length = tmpDir.length();
    if (length < 1e-6) return;
    bone.position.addVectors(current[a], current[b]).multiplyScalar(0.5);
    bone.quaternion.setFromUnitVectors(UP, tmpDir.divideScalar(length));
    const r = bone.userData.radius;
    bone.scale.set(r, length, r);
  });

  const positions = hand.palm.geometry.attributes.position;
  PALM_POINTS.forEach((idx, i) => positions.setXYZ(i, current[idx].x, current[idx].y, current[idx].z));
  positions.needsUpdate = true;
  hand.palm.geometry.computeVertexNormals();
  hand.palm.geometry.computeBoundingSphere();
}

// ---------- 손 인식 결과 → 3D 좌표 ----------

// MediaPipe는 입력 영상이 좌우반전(셀카)이라고 가정하므로,
// 반전하지 않은 웹캠 영상에서는 "Left" 라벨이 실제로는 오른손이다.
function slotFor(label) {
  return label === "Left" ? "right" : "left";
}

function applyDetection(landmarks, worldLandmarks, hand) {
  // 화면상 손 위치 (거울처럼 좌우 반전)
  let cx = 0;
  let cy = 0;
  for (const p of landmarks) {
    cx += p.x;
    cy += p.y;
  }
  cx /= landmarks.length;
  cy /= landmarks.length;

  const viewHeight = 2 * CAMERA_HOME.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const videoAspect = video.videoWidth / video.videoHeight || 4 / 3;
  const offsetX = (0.5 - cx) * viewHeight * videoAspect * 0.8;
  const offsetY = (0.5 - cy) * viewHeight * 0.8;

  // 화면에서 손이 크게 보일수록 카메라에 가까움 → 앞으로 당김
  const dx = (landmarks[9].x - landmarks[0].x) * videoAspect;
  const dy = landmarks[9].y - landmarks[0].y;
  const apparentSize = Math.hypot(dx, dy);
  const offsetZ = THREE.MathUtils.clamp((apparentSize / 0.22 - 1) * 2.5, -3, 3);

  // 월드 좌표(미터, 손 중심 기준)로 실제 손 모양을 만든다.
  // x·y·z를 모두 뒤집으면 거울에 비친 손과 같아진다.
  worldLandmarks.forEach((p, i) => {
    hand.target[i].set(
      -p.x * HAND_SCALE + offsetX,
      -p.y * HAND_SCALE + offsetY,
      -p.z * HAND_SCALE + offsetZ
    );
  });

  if (!hand.group.visible) {
    hand.group.visible = true;
    hand.fresh = true;
  }
  hand.seen = true;
}

function drawOverlay(result) {
  const w = (overlay.width = video.videoWidth);
  const h = (overlay.height = video.videoHeight);
  overlayCtx.clearRect(0, 0, w, h);

  result.landmarks.forEach((landmarks, i) => {
    const label = result.handedness[i]?.[0]?.categoryName;
    const color = "#" + HAND_COLORS[slotFor(label)].toString(16).padStart(6, "0");
    overlayCtx.strokeStyle = color;
    overlayCtx.fillStyle = "#fff";
    overlayCtx.lineWidth = Math.max(2, w / 200);

    overlayCtx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      overlayCtx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
      overlayCtx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    }
    overlayCtx.stroke();

    for (const p of landmarks) {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x * w, p.y * h, Math.max(3, w / 160), 0, Math.PI * 2);
      overlayCtx.fill();
    }
  });
}

// ---------- 메인 루프 ----------

let landmarker = null;
let lastVideoTime = -1;
let frameCount = 0;
let fpsTimer = performance.now();

function detect() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const result = landmarker.detectForVideo(video, performance.now());
  hands.left.seen = false;
  hands.right.seen = false;

  result.landmarks.forEach((landmarks, i) => {
    let slot = slotFor(result.handedness[i]?.[0]?.categoryName);
    // 두 손이 같은 쪽으로 인식되면 남은 쪽에 넣는다
    if (hands[slot].seen) slot = slot === "left" ? "right" : "left";
    applyDetection(landmarks, result.worldLandmarks[i], hands[slot]);
  });

  drawOverlay(result);

  const count = result.landmarks.length;
  statusEl.textContent = count === 0 ? "손을 카메라에 보여 주세요" : `손 ${count}개 인식 중`;

  frameCount++;
  const now = performance.now();
  if (now - fpsTimer >= 1000) {
    fpsEl.textContent = `${frameCount} FPS`;
    frameCount = 0;
    fpsTimer = now;
  }
}

function animate() {
  requestAnimationFrame(animate);
  detect();

  for (const hand of Object.values(hands)) {
    // 손이 사라지면 서서히 투명해짐
    hand.opacity += ((hand.seen ? 1 : 0) - hand.opacity) * 0.2;
    if (hand.opacity < 0.02 && !hand.seen) {
      hand.group.visible = false;
      continue;
    }
    for (const m of hand.materials) m.opacity = hand.opacity;
    if (hand.group.visible) updateHandMesh(hand);
  }

  controls.update();
  renderer.render(scene, camera);
}

// ---------- 시작 ----------

async function start() {
  const startButton = $("start");
  startButton.disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 카메라를 지원하지 않아요 (https 또는 localhost에서 열어 주세요)");
    }

    startButton.textContent = "카메라 켜는 중…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    startButton.textContent = "손 인식 모델 불러오는 중…";
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, options);
    } catch {
      // GPU를 못 쓰는 기기에서는 CPU로 재시도
      options.baseOptions.delegate = "CPU";
      landmarker = await HandLandmarker.createFromOptions(vision, options);
    }

    $("start-screen").classList.add("hidden");
    statusEl.textContent = "손을 카메라에 보여 주세요";
  } catch (err) {
    console.error(err);
    const message =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요."
        : err.message || String(err);
    startButton.textContent = "다시 시도";
    startButton.disabled = false;
    statusEl.textContent = message;
    document.querySelector("#start-screen .hint").textContent = message;
  }
}

$("start").addEventListener("click", start);

$("togglePreview").addEventListener("click", (e) => {
  const preview = $("preview");
  preview.hidden = !preview.hidden;
  e.target.textContent = preview.hidden ? "카메라 화면 보기" : "카메라 화면 숨기기";
});

$("resetView").addEventListener("click", () => {
  camera.position.copy(CAMERA_HOME);
  controls.target.set(0, 0, 0);
});

animate();
