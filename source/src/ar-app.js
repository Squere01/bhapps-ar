// BHAPPS Health Band — Web AR wrist try-on (Performance Edition)
// Kamera HP → MediaPipe Hand Landmarker (di perangkat) → pose pergelangan → gelang 3D (three.js).
// Gelang hanya dirender saat tangan terdeteksi dengan yakin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { makeEnv } from './viewer.js';

const V3 = THREE.Vector3;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEBUG = params.has('debug');

const HAND_MODEL_LOCAL = './models/hand_landmarker.task';
const HAND_MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const BAND_URL = './models/bhapps_performance_ar.glb';
const CAM_HFOV = 66;            // perkiraan FOV kamera HP (sisi panjang), derajat
const FOREARM_OFFSET = 0.017;   // jarak pusat gelang dari titik pergelangan ke arah siku (m)
const PALM_OFFSET = 0.004;      // geser sedikit ke sisi telapak agar pod menempel di punggung pergelangan (m)
const MIN_SCORE = 0.7;
const ACQUIRE_FRAMES = 3;
const LOSE_MS = 300;

const ui = {
  stage: $('#stage'), video: $('#video'), gl: $('#gl'), under: $('#under'), dbg: $('#dbg'),
  start: $('#start'), startBtn: $('#startBtn'), startMsg: $('#startMsg'),
  status: $('#status'), statusText: $('#statusText'), guide: $('#guide'),
  shutter: $('#shutter'), switchCam: $('#switchCam'), flip: $('#flip'),
  sizeDown: $('#sizeDown'), sizeUp: $('#sizeUp'), sizeVal: $('#sizeVal'),
  sheet: $('#sheet'), photo: $('#photo'), save: $('#save'), share: $('#share'), close: $('#close'),
};

const state = {
  facing: 'environment', flip: false, sizeAdj: 1, W: 1280, H: 720, f: 1000,
  landmarker: null, stream: null, running: false,
  vis: 0, visTarget: 0, streak: 0, lastSeen: -1e9, target: null, hasHand: false,
  exposure: 1, photoBlob: null, photoUrl: null,
};

/* ------------------------------------------------------------------ three */
const renderer = new THREE.WebGLRenderer({ canvas: ui.gl, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.environment = makeEnv(renderer);
scene.environmentIntensity = 0.9;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 10);
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(0.3, 1, 0.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0xb9d2ff, 0.6);
rim.position.set(-0.6, 0.3, -0.8);
scene.add(rim);

const band = new THREE.Group();
band.visible = false;
scene.add(band);

// Pergelangan tak terlihat: menutup bagian strap yang berada di balik lengan.
const occGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false);
occGeo.rotateX(Math.PI / 2);
const occluder = new THREE.Mesh(occGeo, new THREE.MeshBasicMaterial({ colorWrite: false }));
occluder.scale.set(0.0228, 0.0198, 0.17);
occluder.position.z = 0.06;
occluder.renderOrder = -1;
band.add(occluder);

const fadeMats = [];
let bandReady = false;
const bandLoad = new GLTFLoader().loadAsync(BAND_URL).then((g) => {
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.renderOrder = 1;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      fadeMats.push({ m, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
    }
  });
  band.add(g.scene);
  bandReady = true;
});

function setFade(v) {
  for (const e of fadeMats) {
    const tr = v < 0.999 || e.transparent;
    if (e.m.transparent !== tr) { e.m.transparent = tr; e.m.needsUpdate = true; }
    e.m.depthWrite = v < 0.999 ? false : e.depthWrite;
    e.m.opacity = e.opacity * v;
  }
  band.visible = v > 0.01 && bandReady;
}

/* ----------------------------------------------------------------- layout */
let stageW = 0, stageH = 0;
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const sc = Math.max(vw / state.W, vh / state.H);
  stageW = state.W * sc; stageH = state.H * sc;
  Object.assign(ui.stage.style, {
    width: `${stageW}px`, height: `${stageH}px`,
    left: `${(vw - stageW) / 2}px`, top: `${(vh - stageH) / 2}px`,
    transform: state.facing === 'user' && !DEMO ? 'scaleX(-1)' : 'none',
  });
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(stageW, stageH, false);
  for (const c of [ui.under, ui.dbg]) { c.width = Math.round(stageW * pr); c.height = Math.round(stageH * pr); }
  state.f = (Math.max(state.W, state.H) / 2) / Math.tan(THREE.MathUtils.degToRad(CAM_HFOV / 2));
  camera.aspect = state.W / state.H;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((state.H / 2) / state.f));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', layout);

/* ------------------------------------------------------------ hand → pose */
const PALM = [0, 1, 5, 9, 13, 17];
function solvePose(lm, wl, label) {
  const { W, H, f } = state;
  let cu = 0, cv = 0, cx = 0, cy = 0, cz = 0;
  for (const i of PALM) { cu += lm[i].x * W; cv += lm[i].y * H; cx += wl[i].x; cy += wl[i].y; cz += wl[i].z; }
  const n = PALM.length;
  cu /= n; cv /= n; cx /= n; cy /= n; cz /= n;
  let si = 0, sw = 0;
  for (const i of PALM) {
    si += (lm[i].x * W - cu) ** 2 + (lm[i].y * H - cv) ** 2;
    sw += (wl[i].x - cx) ** 2 + (wl[i].y - cy) ** 2;
  }
  if (si < 1 || sw < 1e-8) return null;
  const depth = f * Math.sqrt(sw / si) + (wl[0].z - cz);
  if (!(depth > 0.05 && depth < 2)) return null;
  const u0 = lm[0].x * W, v0 = lm[0].y * H;
  const pos = new V3(((u0 - W / 2) / f) * depth, (-(v0 - H / 2) / f) * depth, -depth);

  const P = (i) => new V3(wl[i].x, -wl[i].y, -wl[i].z);
  const p0 = P(0), p5 = P(5), p9 = P(9), p17 = P(17);
  const a = p0.clone().sub(p9).normalize();                       // arah lengan (ke siku)
  const nrm = p5.clone().sub(p0).cross(p17.clone().sub(p0)).normalize();
  // Frame kamera tidak di-mirror, sedangkan label MediaPipe mengasumsikan gambar selfie ter-mirror.
  const trueRight = label === 'Left';
  const d = trueRight ? nrm.negate() : nrm;                         // arah punggung tangan
  if (state.flip) d.negate();
  const y = d.sub(a.clone().multiplyScalar(d.dot(a))).normalize();
  const x = y.clone().cross(a).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, a));
  const s = THREE.MathUtils.clamp(p5.distanceTo(p17) / 0.078, 0.85, 1.2);
  pos.addScaledVector(a, FOREARM_OFFSET * s).addScaledVector(y, -PALM_OFFSET * s);
  return { pos, q, s };
}

class OneEuro {
  constructor(minCut, beta, dCut = 1) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; }
  static a(dt, cut) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x === null) { this.x = v; return v; }
    const rawDx = (v - this.x) / dt;
    this.dx += OneEuro.a(dt, this.dCut) * (rawDx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(dt, cut) * (v - this.x);
    return this.x;
  }
}
const pf = [new OneEuro(1.4, 6), new OneEuro(1.4, 6), new OneEuro(0.9, 3)];
const cur = { pos: new V3(), q: new THREE.Quaternion(), s: 1, init: false };

function updatePose(dt) {
  const t = state.target;
  if (!t) return;
  if (!cur.init) {
    cur.pos.copy(t.pos); cur.q.copy(t.q); cur.s = t.s; cur.init = true;
    pf.forEach((p) => p.reset());
  }
  cur.pos.set(pf[0].filter(t.pos.x, dt), pf[1].filter(t.pos.y, dt), pf[2].filter(t.pos.z, dt));
  const ang = cur.q.angleTo(t.q);
  cur.q.slerp(t.q, 1 - Math.exp(-dt * (9 + 45 * ang)));
  cur.s += (t.s - cur.s) * (1 - Math.exp(-dt * 4));
  band.position.copy(cur.pos);
  band.quaternion.copy(cur.q);
  band.scale.setScalar(cur.s * state.sizeAdj);
}

function setStatus(found) {
  if (found === state.hasHand) return;
  state.hasHand = found;
  ui.status.dataset.state = found ? 'on' : 'off';
  ui.statusText.textContent = found ? 'Pergelangan terdeteksi' : 'Mencari tangan…';
  ui.guide.hidden = found;
}

function handleResult(res, now) {
  let good = false, lm = null;
  const hands = res && res.landmarks && res.landmarks.length;
  if (hands && res.worldLandmarks && res.worldLandmarks.length) {
    lm = res.landmarks[0];
    const wl = res.worldLandmarks[0];
    const hd = ((res.handedness || res.handednesses || [])[0] || [])[0];
    const w = lm[0];
    const inFrame = w.x > 0.03 && w.x < 0.97 && w.y > 0.03 && w.y < 0.97;
    if (hd && hd.score >= MIN_SCORE && inFrame) {
      const pose = solvePose(lm, wl, hd.categoryName);
      if (pose) { state.target = pose; good = true; }
    }
  }
  if (good) {
    state.streak++;
    state.lastSeen = now;
    if (state.streak >= ACQUIRE_FRAMES) state.visTarget = 1;
  } else {
    state.streak = 0;
    if (now - state.lastSeen > LOSE_MS) state.visTarget = 0;
  }
  setStatus(state.visTarget === 1);
  if (DEBUG) drawDebug(lm);
}

function drawDebug(lm) {
  const c = ui.dbg, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!lm) return;
  g.fillStyle = '#7fd3ff';
  for (const p of lm) { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ff5a60';
  g.beginPath(); g.arc(lm[0].x * c.width, lm[0].y * c.height, 9, 0, Math.PI * 2); g.fill();
}

/* ------------------------------------------------------------------- demo */
// Tangan sintetis (punggung tangan kanan menghadap kamera) untuk menguji di laptop tanpa kamera: ?demo
const TEMPLATE = [
  [0, 0], [-0.025, 0.02], [-0.045, 0.04], [-0.06, 0.06], [-0.07, 0.08],
  [-0.025, 0.085], [-0.03, 0.12], [-0.032, 0.145], [-0.034, 0.165],
  [-0.005, 0.09], [-0.006, 0.13], [-0.006, 0.155], [-0.006, 0.178],
  [0.015, 0.085], [0.017, 0.12], [0.018, 0.143], [0.019, 0.162],
  [0.032, 0.075], [0.038, 0.1], [0.041, 0.117], [0.043, 0.132],
];
function demoResult(t) {
  const { W, H, f } = state;
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    -0.35 + 0.25 * Math.sin(t * 0.5), 0.45 * Math.sin(t * 0.37), 0.55 + 0.18 * Math.sin(t * 0.43), 'YXZ'));
  const T = new V3(0.02 * Math.sin(t * 0.3), -0.035, -0.36);
  const cam = TEMPLATE.map(([x, y]) => new V3(x, y, 0).applyMatrix4(R).add(T));
  const c = cam.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / cam.length);
  const lm = cam.map((p) => ({ x: (W / 2 + (f * p.x) / -p.z) / W, y: (H / 2 - (f * p.y) / -p.z) / H, z: 0 }));
  const wl = cam.map((p) => ({ x: p.x - c.x, y: -(p.y - c.y), z: -(p.z - c.z) }));
  demoDraw(cam, lm);
  return { landmarks: [lm], worldLandmarks: [wl], handedness: [[{ categoryName: 'Left', score: 0.97 }]] };
}
function demoDraw(cam, lm) {
  const c = ui.under, g = c.getContext('2d'), k = c.width / state.W;
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, '#3a4252'); grd.addColorStop(1, '#151a24');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  const proj = (p) => [(state.W / 2 + (state.f * p.x) / -p.z) * k, (state.H / 2 - (state.f * p.y) / -p.z) * k];
  const elbow = cam[0].clone().add(cam[0].clone().sub(cam[9]).normalize().multiplyScalar(0.3));
  const [x0, y0] = proj(cam[0]), [x1, y1] = proj(elbow);
  const wPx = (state.f * 0.056 * k) / -cam[0].z;
  g.lineCap = 'round'; g.strokeStyle = '#c99a7c'; g.lineWidth = wPx;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.fillStyle = '#d2a486';
  g.beginPath();
  [0, 1, 2, 5, 9, 13, 17].forEach((i, j) => { const x = lm[i].x * c.width, y = lm[i].y * c.height; j ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.fill();
  g.lineWidth = (state.f * 0.017 * k) / -cam[0].z; g.strokeStyle = '#d2a486';
  for (const ch of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    g.beginPath();
    ch.forEach((i, j) => { const x = lm[i].x * c.width, y = lm[i].y * c.height; j ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
}

/* --------------------------------------------------------------- exposure */
const lumC = document.createElement('canvas');
lumC.width = lumC.height = 24;
const lumG = lumC.getContext('2d', { willReadFrequently: true });
let lumT = 0;
function adaptExposure(now) {
  if (DEMO || now - lumT < 400 || ui.video.readyState < 2) return;
  lumT = now;
  lumG.drawImage(ui.video, 0, 0, 24, 24);
  const d = lumG.getImageData(0, 0, 24, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const L = s / (d.length / 4) / 255;
  state.exposure = THREE.MathUtils.clamp(0.62 + L * 0.95, 0.7, 1.25);
}

/* ------------------------------------------------------------------- loop */
let lastVideoTime = -1, lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - lastT) / 1000, 1 / 120), 0.1);
  lastT = now;
  if (DEMO) {
    handleResult(demoResult(now / 1000), now);
  } else if (state.landmarker && ui.video.readyState >= 2 && ui.video.currentTime !== lastVideoTime) {
    lastVideoTime = ui.video.currentTime;
    try { handleResult(state.landmarker.detectForVideo(ui.video, now), now); } catch (e) { console.warn(e); }
  }
  adaptExposure(now);
  renderer.toneMappingExposure += (state.exposure - renderer.toneMappingExposure) * 0.05;
  updatePose(dt);
  const prev = state.vis;
  const rate = state.visTarget > state.vis ? 6 : 8;
  state.vis += (state.visTarget - state.vis) * (1 - Math.exp(-dt * rate));
  if (Math.abs(state.vis - state.visTarget) < 0.005) state.vis = state.visTarget;
  if (state.vis === 0 && prev !== 0) cur.init = false;
  setFade(state.vis);
  renderer.render(scene, camera);
}

/* ----------------------------------------------------------------- camera */
async function startCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  });
  state.stream = stream;
  ui.video.srcObject = stream;
  await ui.video.play();
  if (!ui.video.videoWidth) await new Promise((r) => ui.video.addEventListener('loadedmetadata', r, { once: true }));
  state.W = ui.video.videoWidth; state.H = ui.video.videoHeight;
  layout();
}

async function loadLandmarker() {
  const vision = await FilesetResolver.forVisionTasks('./wasm');
  let modelPath = HAND_MODEL_REMOTE;
  try {
    const r = await fetch(HAND_MODEL_LOCAL, { method: 'HEAD' });
    if (r.ok) modelPath = HAND_MODEL_LOCAL;
  } catch (e) { /* pakai model online */ }
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
  });
  try { return await HandLandmarker.createFromOptions(vision, opts('GPU')); } catch (e) { return HandLandmarker.createFromOptions(vision, opts('CPU')); }
}

async function begin() {
  ui.startBtn.disabled = true;
  ui.startMsg.textContent = 'Menyiapkan kamera dan model…';
  try {
    if (DEMO) {
      const land = window.innerWidth >= window.innerHeight;
      state.W = land ? 1280 : 720; state.H = land ? 720 : 1280;
      layout();
      await bandLoad;
    } else {
      if (!window.isSecureContext || !navigator.mediaDevices) throw Object.assign(new Error('insecure'), { code: 'insecure' });
      await Promise.all([startCamera(), bandLoad, loadLandmarker().then((l) => { state.landmarker = l; })]);
    }
    ui.start.hidden = true;
    document.body.dataset.running = '1';
    if (!state.running) { state.running = true; requestAnimationFrame(frame); }
  } catch (e) {
    console.error(e);
    ui.startBtn.disabled = false;
    ui.startMsg.textContent = e.code === 'insecure'
      ? 'Kamera hanya bisa dipakai lewat alamat https://. Buka halaman ini dari link https.'
      : e.name === 'NotAllowedError'
        ? 'Izin kamera ditolak. Izinkan kamera di pengaturan situs browser, lalu coba lagi.'
        : 'Gagal memulai AR. Periksa koneksi internet, lalu coba lagi.';
  }
}

/* -------------------------------------------------------------- controls */
ui.startBtn.addEventListener('click', begin);
ui.switchCam.addEventListener('click', async () => {
  if (DEMO) return;
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  state.visTarget = 0; state.vis = 0; cur.init = false;
  try { await startCamera(); } catch (e) { console.error(e); }
});
ui.flip.addEventListener('click', () => {
  state.flip = !state.flip;
  ui.flip.setAttribute('aria-pressed', String(state.flip));
});
const setSize = (v) => {
  state.sizeAdj = THREE.MathUtils.clamp(Math.round(v * 100) / 100, 0.8, 1.25);
  ui.sizeVal.textContent = `${Math.round(state.sizeAdj * 100)}%`;
};
ui.sizeDown.addEventListener('click', () => setSize(state.sizeAdj - 0.05));
ui.sizeUp.addEventListener('click', () => setSize(state.sizeAdj + 0.05));

/* ---------------------------------------------------------------- capture */
async function capture() {
  const { W, H } = state;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  g.save();
  if (state.facing === 'user' && !DEMO) { g.translate(W, 0); g.scale(-1, 1); }
  if (DEMO) g.drawImage(ui.under, 0, 0, W, H); else g.drawImage(ui.video, 0, 0, W, H);
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.render(scene, camera);
  g.drawImage(renderer.domElement, 0, 0, W, H);
  renderer.setPixelRatio(pr);
  renderer.setSize(stageW, stageH, false);
  g.restore();
  const pad = Math.round(Math.min(W, H) * 0.035), fs = Math.round(Math.min(W, H) * 0.024);
  g.font = `600 ${fs}px "Plus Jakarta Sans", system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = fs * 0.4;
  g.fillText('BHAPPS · Performance Edition', pad, H - pad);
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) return;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoBlob = blob;
  state.photoUrl = URL.createObjectURL(blob);
  ui.photo.src = state.photoUrl;
  ui.photo.alt = `Foto AR gelang BHAPPS, ${W}×${H} piksel`;
  ui.sheet.hidden = false;
  const file = new File([blob], 'bhapps-ar.jpg', { type: 'image/jpeg' });
  ui.share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
}
ui.shutter.addEventListener('click', () => { capture().catch((e) => console.error(e)); });
ui.close.addEventListener('click', () => { ui.sheet.hidden = true; });
ui.save.addEventListener('click', () => {
  if (!state.photoUrl) return;
  const a = document.createElement('a');
  a.href = state.photoUrl;
  a.download = `bhapps-ar-${Date.now()}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
});
ui.share.addEventListener('click', async () => {
  try {
    await navigator.share({ files: [new File([state.photoBlob], 'bhapps-ar.jpg', { type: 'image/jpeg' })], title: 'BHAPPS Health Band' });
  } catch (e) { /* dibatalkan */ }
});

if (DEMO) { ui.startMsg.textContent = 'Mode demo: tangan sintetis, tanpa kamera.'; ui.switchCam.hidden = true; }
window.__bhappsAR = { state, begin, capture };
