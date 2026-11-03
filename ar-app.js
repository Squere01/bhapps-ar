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
const CAM_HFOV = 66;            // perkiraan FOV kamera utama HP (sisi panjang), derajat
const ULTRA_HFOV = 106;         // perkiraan FOV lensa ultra wide 0,5× (sisi panjang), derajat
const FOREARM_OFFSET = 0.017;   // jarak pusat gelang dari titik pergelangan ke arah siku (m)
const PALM_OFFSET = 0.004;      // geser sedikit ke sisi telapak agar pod menempel di punggung pergelangan (m)
const MIN_SCORE = 0.7;
const ACQUIRE_FRAMES = 3;
const LOSE_MS = 300;

const ui = {
  stage: $('#stage'), video: $('#video'), gl: $('#gl'), under: $('#under'), dbg: $('#lmDebug'),
  start: $('#start'), startBtn: $('#startBtn'), startMsg: $('#startMsg'),
  status: $('#status'), statusText: $('#statusText'), guide: $('#guide'),
  shutter: $('#shutter'), switchCam: $('#switchCam'), flip: $('#flip'),
  sizeDown: $('#sizeDown'), sizeUp: $('#sizeUp'), sizeVal: $('#sizeVal'),
  saveHint: $('#saveHint'), lensRow: $('#lensRow'), lens05: $('#lens05'), lens1: $('#lens1'),
  sheet: $('#sheet'), photo: $('#photo'), save: $('#save'), share: $('#share'), close: $('#close'),
};

const state = {
  facing: 'environment', flip: false, sizeAdj: 1, W: 1280, H: 720, f: 1000,
  lens: 'wide', hfov: CAM_HFOV, ultraId: null, ultraZoom: null, lensProbed: false,
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

// Latar video digambar di WebGL dari frame yang SAMA dengan frame yang dianalisis,
// jadi gelang dan lengan selalu sinkron (tidak tertinggal saat bergerak).
const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const videoTex = new THREE.VideoTexture(ui.video);
videoTex.colorSpace = THREE.SRGBColorSpace;
videoTex.minFilter = THREE.LinearFilter;
videoTex.magFilter = THREE.LinearFilter;
videoTex.generateMipmaps = false;
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: videoTex, toneMapped: false, depthTest: false, depthWrite: false })));
let bgReady = false;
renderer.autoClear = false;

const band = new THREE.Group();
band.visible = false;
scene.add(band);

// Pergelangan tak terlihat: menutup bagian strap yang berada di balik lengan.
const occGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false);
occGeo.rotateX(Math.PI / 2);
const occluder = new THREE.Mesh(occGeo, new THREE.MeshBasicMaterial({ colorWrite: false }));
const RING_R = 0.0250;           // sedikit di dalam permukaan dalam strap (25,5 mm)
occluder.scale.set(RING_R, RING_R, 0.22);
occluder.position.z = 0.08;
occluder.renderOrder = -1;
band.add(occluder);

function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(4, 256);
  for (let y = 0; y < 256; y++) {
    const z = (y / 255 - 0.5) * 44;                // mm sepanjang lengan
    const edge = Math.abs(z) - 12;                 // 0 tepat di tepi strap
    const a = edge < 0 ? 0.85 : Math.exp(-((edge / 4.2) ** 2)) * 0.85;
    for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255); img.data[i + 3] = 255; }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const shadowGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
shadowGeo.rotateX(Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a0604, alphaMap: contactShadowTexture(), transparent: true, opacity: 0.5, depthWrite: false });
const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
contactShadow.scale.set(RING_R + 0.0003, RING_R + 0.0003, 0.044);
contactShadow.renderOrder = 0;
band.add(contactShadow);

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
  shadowMat.opacity = 0.5 * v;
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
  state.f = (Math.max(state.W, state.H) / 2) / Math.tan(THREE.MathUtils.degToRad(state.hfov / 2));
  camera.aspect = state.W / state.H;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((state.H / 2) / state.f));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', layout);

/* ------------------------------------------------------------ hand → pose */
const PALM = [0, 1, 5, 9, 13, 17];
// Pose dihitung di ruang gambar (u, v dalam piksel + kedalaman) supaya penghalusan bekerja
// pada hal yang benar-benar terlihat di layar.
const PALM_LOOP = [0, 1, 5, 9, 13, 17];           // keliling telapak, urut
function solvePose(lm, wl) {
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

  const P = (i) => new V3(wl[i].x, -wl[i].y, -wl[i].z);
  const p0 = P(0);
  // Arah lengan: dari pusat keempat pangkal jari ke pergelangan (lebih stabil daripada satu titik).
  const knuckles = P(5).add(P(9)).add(P(13)).add(P(17)).multiplyScalar(0.25);
  const a = p0.clone().sub(knuckles).normalize();
  // Normal telapak dengan metode Newell atas seluruh keliling telapak (tahan noise).
  const nrm = new V3();
  for (let k = 0; k < PALM_LOOP.length; k++) {
    const c = P(PALM_LOOP[k]), d = P(PALM_LOOP[(k + 1) % PALM_LOOP.length]);
    nrm.x += (c.y - d.y) * (c.z + d.z);
    nrm.y += (c.z - d.z) * (c.x + d.x);
    nrm.z += (c.x - d.x) * (c.y + d.y);
  }
  nrm.normalize();
  const palmW = P(5).distanceTo(P(17));
  return { u: lm[0].x * W, v: lm[0].y * H, depth, a, nrm, palmW };
}

// Label kiri/kanan dari MediaPipe bisa berganti-ganti antar frame; pakai voting berbobot.
const handVote = { v: 0 };
function trueRightHand(label, score) {
  // Diuji di iPhone: label MediaPipe untuk frame kamera mentah (tidak di-mirror) sesuai tangan sebenarnya.
  const sgn = label === 'Right' ? 1 : -1;
  handVote.v = THREE.MathUtils.clamp(handVote.v * 0.92 + sgn * score, -6, 6);
  return handVote.v > 0;
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
// u, v dalam piksel video; kedalaman dalam meter.
const fU = new OneEuro(1.6, 0.012), fV = new OneEuro(1.6, 0.012), fZ = new OneEuro(0.7, 0.4);
const rotF = { speed: 0 };
const cur = { pos: new V3(), q: new THREE.Quaternion(), s: 1, init: false };
const _x = new V3(), _y = new V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function applyPose(t, right, dt) {
  // Orientasi target
  const d = (right ? t.nrm.clone().negate() : t.nrm.clone());   // arah punggung tangan
  if (state.flip) d.negate();
  _y.copy(d).addScaledVector(t.a, -d.dot(t.a)).normalize();
  _x.copy(_y).cross(t.a).normalize();
  _q.setFromRotationMatrix(_m.makeBasis(_x, _y, t.a));
  const s = THREE.MathUtils.clamp((0.8 * t.palmW) / 0.051, 0.9, 1.35);
  if (!cur.init) {
    fU.reset(); fV.reset(); fZ.reset(); rotF.speed = 0;
    cur.q.copy(_q); cur.s = s; cur.init = true;
  }
  // Rotasi: One Euro versi sudut (halus saat diam, cepat saat bergerak)
  const ang = cur.q.angleTo(_q);
  rotF.speed += OneEuro.a(dt, 1) * (ang / dt - rotF.speed);
  const cut = 1.3 + 1.6 * rotF.speed;
  cur.q.slerp(_q, OneEuro.a(dt, cut));
  cur.s += (s - cur.s) * (1 - Math.exp(-dt * 2));
  // Posisi dari u, v, kedalaman yang sudah dihaluskan
  const u = fU.filter(t.u, dt), v = fV.filter(t.v, dt), z = fZ.filter(t.depth, dt);
  const { W, H, f } = state;
  cur.pos.set(((u - W / 2) / f) * z, (-(v - H / 2) / f) * z, -z);
  const sc = cur.s * state.sizeAdj;
  _y.set(0, 1, 0).applyQuaternion(cur.q);
  const a = new V3(0, 0, 1).applyQuaternion(cur.q);
  cur.pos.addScaledVector(a, FOREARM_OFFSET * sc).addScaledVector(_y, -PALM_OFFSET * sc);
  band.position.copy(cur.pos);
  band.quaternion.copy(cur.q);
  band.scale.setScalar(sc);
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
      const pose = solvePose(lm, wl);
      if (pose) {
        const dt = THREE.MathUtils.clamp((now - (state.lastDetect || now - 33)) / 1000, 1 / 120, 0.2);
        state.lastDetect = now;
        applyPose(pose, trueRightHand(hd.categoryName, hd.score), dt);
        good = true;
      }
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
  return { landmarks: [lm], worldLandmarks: [wl], handedness: [[{ categoryName: 'Right', score: 0.97 }]] };
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

/* ------------------------------------------------------- live environment */
const envCanvas = document.createElement('canvas');
envCanvas.width = 256; envCanvas.height = 128;
const envCtx = envCanvas.getContext('2d');
const envTex = new THREE.CanvasTexture(envCanvas);
envTex.colorSpace = THREE.SRGBColorSpace;
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })));
const softbox = new THREE.Mesh(new THREE.PlaneGeometry(30, 22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.2), side: THREE.DoubleSide }));
softbox.position.set(6, 34, 10); softbox.lookAt(0, 0, 0);
envScene.add(softbox);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envT = -1e9;
const avgCol = new THREE.Color(1, 1, 1);
function updateEnv(now) {
  if (DEMO || now - envT < 1000 || ui.video.readyState < 2) return;
  envT = now;
  const v = ui.video;
  envCtx.filter = 'blur(5px) saturate(1.1)';
  envCtx.drawImage(v, 0, 0, 128, 128);
  envCtx.save(); envCtx.translate(256, 0); envCtx.scale(-1, 1); envCtx.drawImage(v, 0, 0, 128, 128); envCtx.restore();
  envCtx.filter = 'none';
  envTex.needsUpdate = true;
  const rt = pmrem.fromScene(envScene, 0.02);
  scene.environment = rt.texture;
  if (envRT) envRT.dispose();
  envRT = rt;
  const d = envCtx.getImageData(0, 0, 128, 128).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const m = Math.max(r, g, b) || 1;
  avgCol.setRGB(r / m, g / m, b / m, THREE.SRGBColorSpace);
  key.color.copy(new THREE.Color(1, 1, 1).lerp(avgCol, 0.35));
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
    videoTex.needsUpdate = true;   // unggah frame yang barusan dianalisis
    bgReady = true;
  }
  adaptExposure(now);
  updateEnv(now);
  renderer.toneMappingExposure += (state.exposure - renderer.toneMappingExposure) * 0.05;
  const prev = state.vis;
  const rate = state.visTarget > state.vis ? 6 : 8;
  state.vis += (state.visTarget - state.vis) * (1 - Math.exp(-dt * rate));
  if (Math.abs(state.vis - state.visTarget) < 0.005) state.vis = state.visTarget;
  if (state.vis === 0 && prev !== 0) { cur.init = false; handVote.v = 0; state.lastDetect = 0; }
  setFade(state.vis);
  renderer.clear();
  if (bgReady && !DEMO) renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
}

/* ----------------------------------------------------------------- camera */
async function startCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const ultra = state.facing === 'environment' && state.lens === 'ultra';
  const base = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  const video = ultra && state.ultraId
    ? { ...base, deviceId: { exact: state.ultraId } }
    : { ...base, facingMode: { ideal: state.facing } };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  state.stream = stream;
  state.hfov = CAM_HFOV;
  if (ultra && state.ultraId) state.hfov = ULTRA_HFOV;
  else if (ultra && state.ultraZoom) {
    try {
      await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: state.ultraZoom }] });
      state.hfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAM_HFOV / 2)) / state.ultraZoom));
    } catch (e) { /* zoom tidak didukung */ }
  }
  if (!state.lensProbed) { state.lensProbed = true; await probeLenses(stream); }
  updateLensUI();
  ui.video.srcObject = stream;
  await ui.video.play();
  if (!ui.video.videoWidth) await new Promise((r) => ui.video.addEventListener('loadedmetadata', r, { once: true }));
  state.W = ui.video.videoWidth; state.H = ui.video.videoHeight;
  layout();
}

// Cari lensa 0,5×: di iPhone muncul sebagai kamera terpisah ("Back Ultra Wide Camera"),
// di sebagian Android sebagai zoom < 1 pada kamera belakang.
async function probeLenses(stream) {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const ultra = devs.find((d) => /ultra/i.test(d.label) && !/front|depan|depth/i.test(d.label));
    if (ultra) state.ultraId = ultra.deviceId;
    else {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.zoom && caps.zoom.min < 1) state.ultraZoom = Math.max(caps.zoom.min, 0.5);
    }
  } catch (e) { /* biarkan tanpa opsi 0,5× */ }
}
function updateLensUI() {
  const available = !!(state.ultraId || state.ultraZoom) && state.facing === 'environment';
  ui.lensRow.hidden = !available;
  ui.lens05.setAttribute('aria-pressed', String(state.lens === 'ultra'));
  ui.lens1.setAttribute('aria-pressed', String(state.lens !== 'ultra'));
}
async function setLens(l) {
  if (DEMO || l === state.lens) return;
  const prev = state.lens;
  state.lens = l;
  state.visTarget = 0; state.vis = 0; cur.init = false;
  try { await startCamera(); } catch (e) { console.error(e); state.lens = prev; await startCamera().catch(() => {}); }
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
      const step = (name, pr) => pr.catch((e) => { e.step = name; throw e; });
      await Promise.all([
        step('kamera', startCamera()),
        step('model gelang', bandLoad),
        step('model deteksi tangan', loadLandmarker().then((l) => { state.landmarker = l; })),
      ]);
    }
    ui.start.hidden = true;
    document.body.dataset.running = '1';
    if (!state.running) { state.running = true; requestAnimationFrame(frame); }
  } catch (e) {
    console.error(e);
    ui.startBtn.disabled = false;
    const detail = `${e && e.name ? e.name + ': ' : ''}${(e && e.message) || e}`.slice(0, 160);
    let msg;
    if (e.code === 'insecure') msg = 'Kamera hanya bisa dipakai lewat alamat https://. Buka halaman ini dari link https.';
    else if (e.name === 'NotAllowedError') msg = 'Izin kamera ditolak. Izinkan kamera di pengaturan situs browser, lalu coba lagi.';
    else if (e.name === 'NotReadableError') msg = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu coba lagi.';
    else if (e.step === 'model deteksi tangan') msg = 'Model deteksi tangan gagal dimuat. Taruh file hand_landmarker.task di folder models/ (lihat README), lalu coba lagi.';
    else msg = `Gagal memuat ${e.step || 'AR'}.`;
    ui.startMsg.textContent = `${msg} (${e.step || 'umum'} → ${detail})`;
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
ui.lens05.addEventListener('click', () => { setLens('ultra'); });
ui.lens1.addEventListener('click', () => { setLens('wide'); });
// Pilihan "balik" diingat di browser ini, jadi cukup diatur sekali.
try { state.flip = localStorage.getItem('bhapps-ar-flip') === '1'; } catch (e) { /* tanpa penyimpanan */ }
ui.flip.setAttribute('aria-pressed', String(state.flip));
ui.flip.addEventListener('click', () => {
  state.flip = !state.flip;
  ui.flip.setAttribute('aria-pressed', String(state.flip));
  try { localStorage.setItem('bhapps-ar-flip', state.flip ? '1' : '0'); } catch (e) { /* abaikan */ }
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
  renderer.clear();
  renderer.render(scene, camera);
  g.drawImage(renderer.domElement, 0, 0, W, H);
  renderer.setPixelRatio(pr);
  renderer.setSize(stageW, stageH, false);
  g.restore();
  const pad = Math.round(Math.min(W, H) * 0.035), fs = Math.round(Math.min(W, H) * 0.024);
  // cap foto: logo BHAPPS (Montserrat, huruf renggang, titik merah) + nama edisi
  const y1 = H - pad - fs * 1.05;
  g.font = `500 ${fs}px Montserrat, system-ui, sans-serif`; g.letterSpacing = `${(fs * 0.14).toFixed(1)}px`;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = fs * 0.5; g.textBaseline = 'alphabetic';
  g.fillText('BHAPPS', pad, y1);
  { const w = g.measureText('BHAPPS').width; g.shadowBlur = 0; g.fillStyle = '#C6242A'; g.beginPath(); g.arc(pad + w + fs * 0.12, y1 - fs * 0.72, fs * 0.11, 0, 7); g.fill(); }
  g.shadowBlur = fs * 0.5; g.letterSpacing = '0px';
  g.font = `400 ${Math.round(fs * 0.62)}px Montserrat, system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('Performance Edition', pad, H - pad);
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) return;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoBlob = blob;
  state.photoUrl = URL.createObjectURL(blob);
  ui.photo.src = state.photoUrl;
  ui.photo.alt = `Foto AR gelang BHAPPS, ${W}×${H} piksel`;
  ui.sheet.hidden = false;
  state.photoFile = new File([blob], `bhapps-ar-${Date.now()}.jpg`, { type: 'image/jpeg' });
  state.canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [state.photoFile] }));
  // Dengan menu Bagikan: tombol utama = galeri, tombol kedua = unduh file. Tanpa itu: unduh saja.
  ui.save.textContent = state.canShareFiles ? 'Simpan ke Galeri' : 'Simpan foto';
  ui.share.hidden = !state.canShareFiles;
  ui.saveHint.hidden = !state.canShareFiles;
}
function downloadPhoto() {
  if (!state.photoUrl) return;
  const a = document.createElement('a');
  a.href = state.photoUrl;
  a.download = state.photoFile ? state.photoFile.name : `bhapps-ar-${Date.now()}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
}
ui.shutter.addEventListener('click', () => { capture().catch((e) => console.error(e)); });
ui.close.addEventListener('click', () => { ui.sheet.hidden = true; });
ui.save.addEventListener('click', async () => {
  if (!state.photoUrl) return;
  if (!state.canShareFiles) { downloadPhoto(); return; }
  try {
    // Hanya file, tanpa teks: iOS menampilkan "Simpan Gambar" yang langsung masuk ke Foto.
    await navigator.share({ files: [state.photoFile] });
  } catch (e) {
    if (e && e.name !== 'AbortError') downloadPhoto();
  }
});
ui.share.addEventListener('click', downloadPhoto);

if (DEMO) { ui.startMsg.textContent = 'Mode demo: tangan sintetis, tanpa kamera.'; ui.switchCam.hidden = true; }
window.__bhappsAR = { state, begin, capture, _startLoop: () => { if (!state.running) { state.running = true; requestAnimationFrame(frame); } } };
