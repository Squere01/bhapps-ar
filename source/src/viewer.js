// BHAPPS Health Band — realistic 3D preview (three.js)
// Semua dimensi dalam milimeter. Pod dan strap dibangun "datar" (x = panjang busur pada
// radius acuan RM, y = tebal radial dari kulit, z = lebar) lalu dibengkokkan mengikuti lingkar.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeVertices, mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const T = THREE;
const R_IN = 160 / (2 * Math.PI); // radius sisi kulit (lingkar 160 mm)
const POD_H = 8;
const RM = R_IN + POD_H / 2;      // radius acuan panjang busur
const POD_L = 46, POD_W = 28;
const STRAP_W = 24, STRAP_T = 3;
const FLOOR_Y = -(R_IN + STRAP_T + 1.9) - 0.02;

/* ------------------------------------------------------------------ labels */
const LABELS = {
  glass:   { t: 'Kaca safir melengkung', d: 'Melindungi sel surya dari gores dan tetap meneruskan cahaya.', f: 'Panen energi surya' },
  solar:   { t: 'Sel surya monokristal fleksibel', d: 'Mengubah cahaya menjadi listrik untuk mengisi baterai.', f: 'Dashboard Energi: kontribusi surya' },
  bezel:   { t: 'Bezel logam · elektroda ECG atas', d: 'Disentuh jari tangan lain untuk menutup sirkuit EKG.', f: 'Rekam EKG 30 detik' },
  led:     { t: 'LED status Ø1 mm', d: 'Pengganti layar: tanda mengisi daya, sinkron, dan rekam EKG.', f: 'Status perangkat' },
  frame:   { QL: 'Frame titanium brushed champagne', PF: 'Frame aluminium hitam doff', d: 'Rangka utama yang mengunci kaca, bezel, dan modul dalam; tersegel kedap air.', f: '' },
  logo:    { t: 'Logo BHAPPS (laser etch)', d: 'Identitas merek diukir laser di sisi pod, tanpa cat yang bisa luntur.', f: '' },
  pcb:     { t: 'PCB fleksibel melengkung', d: 'Menghubungkan semua komponen sambil mengikuti lengkung pergelangan.', f: '' },
  soc:     { t: 'SoC Bluetooth Low Energy', d: 'Prosesor utama + radio: mengolah sinyal sensor dan sinkron ke ponsel.', f: 'Sinkronisasi data otomatis' },
  pmic:    { t: 'PMIC energy harvesting', d: 'Mengelola daya surya + TEG (MPPT) dan mengisi baterai.', f: 'Status energi & estimasi daya tahan' },
  afe:     { t: 'Analog front-end biosensor', d: 'Memperkuat dan mendigitalkan sinyal PPG, ECG, dan EDA.', f: 'Detak jantung, SpO₂, EKG, skor stres' },
  imu:     { t: 'IMU 6-axis', d: 'Akselerometer + giroskop untuk membaca gerakan tangan.', f: 'Langkah, aktivitas & fase tidur' },
  flash:   { t: 'Memori flash', d: 'Menyimpan data saat ponsel tidak terhubung.', f: 'Riwayat offline' },
  antenna: { t: 'Antena BLE (meander)', d: 'Memancarkan sinyal Bluetooth ke ponsel.', f: 'Koneksi ke aplikasi BHAPPS' },
  battery: { t: 'Baterai Li-Po melengkung ±120 mAh', d: 'Menyimpan energi; cadangan saat cahaya dan panas tubuh kurang.', f: 'Level baterai & mode hemat' },
  lra:     { t: 'Motor getar LRA', d: 'Getaran halus dan senyap sebagai pengganti notifikasi suara.', f: 'Peringatan dini & alarm bangun' },
  teg:     { t: 'Modul TEG Bi₂Te₃', d: 'Mengubah selisih suhu kulit dan udara menjadi listrik (efek Seebeck).', f: 'Dashboard Energi: kontribusi panas tubuh' },
  spreader:{ t: 'Heat spreader tembaga', d: 'Menyebarkan panas sisi dingin TEG ke rangka agar selisih suhu terjaga.', f: 'Panen energi panas tubuh' },
  housing: { QL: 'Housing bawah titanium', PF: 'Housing bawah aluminium', d: 'Tutup belakang yang memegang jendela optik, elektroda, pelat TEG, dan pin pogo.', f: '' },
  lens:    { t: 'Jendela optik PPG', d: 'Lensa kaca sedikit cembung agar menempel rapat ke kulit.', f: 'Akurasi sensor optik' },
  green:   { t: 'LED hijau (2×)', d: 'Menyinari kapiler untuk membaca denyut aliran darah.', f: 'Detak jantung & HRV' },
  red:     { t: 'LED merah', d: 'Bersama LED inframerah membandingkan penyerapan oksigen darah.', f: 'SpO₂ & laju napas' },
  ir:      { t: 'LED inframerah', d: 'Pasangan LED merah untuk pengukuran saturasi oksigen.', f: 'SpO₂ & laju napas' },
  pd:      { t: 'Fotodioda (4×)', d: 'Menangkap cahaya yang dipantulkan kembali dari kulit.', f: 'Detak jantung, HRV, SpO₂' },
  barrier: { t: 'Sekat optik buram', d: 'Mencegah cahaya LED bocor langsung ke fotodioda.', f: 'Akurasi PPG' },
  ecgRing: { t: 'Cincin elektroda ECG (sisi kulit)', d: 'Elektroda stainless pertama yang menempel di pergelangan.', f: 'Rekam EKG 30 detik' },
  tegPlate:{ QL: 'Pelat TEG tembaga (2×)', PF: 'Pelat TEG titanium (2×)', d: 'Menyalurkan panas tubuh ke modul termoelektrik di dalam.', f: 'Panen energi panas tubuh' },
  eda:     { t: 'Elektroda EDA/GSR (2×)', d: 'Mengukur konduktansi kulit yang berubah saat tubuh tegang.', f: 'Skor stres' },
  therm:   { t: 'Sensor suhu kulit (termistor)', d: 'Menyentuh kulit untuk membaca suhu permukaan.', f: 'Tren suhu kulit saat tidur' },
  pogo:    { t: 'Pin pogo emas (4×)', d: 'Cas cadangan dan transfer data lewat dock magnetik. Jarang perlu dicas, bukan tidak pernah.', f: 'Pembaruan firmware & cas cadangan' },
  reg:     { t: 'Teks regulasi (laser etch)', d: 'Nomor model dan asal desain untuk keperluan sertifikasi.', f: '' },
  qr:      { t: 'Mekanisme quick-release', d: 'Spring bar dengan tuas kecil: pod lepas dari strap tanpa alat.', f: 'Ganti strap kolaborasi desainer' },
  strap:   { QL: 'Strap kulit Italia', PF: 'Strap rajut nylon/fluoroelastomer', d: 'Menahan pod menempel rata di pergelangan agar sensor terbaca stabil.', f: '' },
  keeper:  { t: 'Keeper strap', d: 'Menahan sisa ujung strap agar rapi dan tidak tersangkut.', f: '' },
  buckle:  { QL: 'Buckle logam champagne', PF: 'Buckle hitam', d: 'Pengunci strap; ukuran lingkar bisa disetel.', f: '' },
};

function labelFor(key, variant) {
  const L = LABELS[key];
  if (!L) return null;
  return { key, title: L.t || L[variant], desc: L.d, feat: L.f || '' };
}

/* ---------------------------------------------------------------- geometry */
function rrPath(w, h, r, Cls = T.Shape) {
  const s = new Cls();
  r = Math.max(0.05, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function setUV(g, fn) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = fn ? fn(x, y, z) : [x / 24, z / 24];
    uv[i * 2] = r[0]; uv[i * 2 + 1] = r[1];
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
}

// Rounded slab (outer dims w x d x h, plan-corner radius r, edge bevel b), extruded along +y.
function slab(w, d, h, r, b, o = {}) {
  const shape = rrPath(w - 2 * b, d - 2 * b, Math.max(0.1, r - b));
  if (o.hole) shape.holes.push(rrPath(o.hole.w + 2 * b, o.hole.d + 2 * b, o.hole.r + b, T.Path));
  let g = new T.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, h - 2 * b),
    bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
    bevelSegments: o.bevelSeg ?? 4, curveSegments: o.curveSeg ?? 20,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(o.x || 0, (o.y0 || 0) + b, o.z || 0);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.clearGroups();
  g = mergeVertices(g, 1e-4);
  const me = o.maxEdge ?? 1.4;
  if (me) g = new TessellateModifier(me, 18).modify(g);
  g = toCreasedNormals(g, (o.crease ?? 40) * Math.PI / 180);
  setUV(g, o.uv);
  return g;
}

function lathe(profile, x, z, segs = 40) {
  const g = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segs);
  g.translate(x, 0, z);
  return g;
}

// Bend flat geometry around the wrist ring.
function bend(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const phi = x / RM, s = Math.sin(phi), c = Math.cos(phi), r = R_IN + y;
    p.setXYZ(i, r * s, r * c, z);
    if (n) {
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      const ox = nx * c + ny * s, oy = -nx * s + ny * c;
      const l = Math.hypot(ox, oy, nz) || 1;
      n.setXYZ(i, ox / l, oy / l, nz / l);
    }
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// Rounded-rect cross-section (z: ±a, y: 0..t, corner rc), CCW in (z,y), starts at top-right of top face.
function roundedProfile(a, t, rc, seg = 6) {
  const arcs = [
    [-(a - rc), t - rc, Math.PI / 2, Math.PI],
    [-(a - rc), rc, Math.PI, 1.5 * Math.PI],
    [a - rc, rc, 1.5 * Math.PI, 2 * Math.PI],
    [a - rc, t - rc, 0, Math.PI / 2],
  ];
  const pts = [{ z: a - rc, y: t, nz: 0, ny: 1 }];
  for (const [cz, cy, a0, a1] of arcs) {
    for (let i = 0; i <= seg; i++) {
      const th = a0 + (a1 - a0) * i / seg;
      pts.push({ z: cz + rc * Math.cos(th), y: cy + rc * Math.sin(th), nz: Math.cos(th), ny: Math.sin(th) });
    }
  }
  let s = 0; pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].z - pts[i - 1].z, pts[i].y - pts[i - 1].y);
    pts[i].s = s;
  }
  const k = seg + 1;
  return {
    pts, P: s, rc, a, t,
    sTopEnd: pts[1].s,
    sBotStart: pts[2 * k].s,
    sBotEnd: pts[2 * k + 1].s,
  };
}

function sweep(prof, x0, x1, step, { uLen = 30, yOff = 0, caps = true } = {}) {
  const n = Math.max(2, Math.ceil((x1 - x0) / step) + 1);
  const m = prof.pts.length;
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * i / (n - 1);
    for (const p of prof.pts) {
      pos.push(x, p.y + yOff, p.z); nor.push(0, p.ny, p.nz); uv.push(x / uLen, p.s / prof.P);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = (i + 1) * m + k, c = (i + 1) * m + k + 1, d = i * m + k + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (caps) {
    let cz = 0, cy = 0;
    for (const p of prof.pts) { cz += p.z; cy += p.y; }
    cz /= m; cy /= m;
    for (const [x, sgn] of [[x0, -1], [x1, 1]]) {
      const base = pos.length / 3;
      pos.push(x, cy + yOff, cz); nor.push(sgn, 0, 0); uv.push(x / uLen, 0.5);
      for (const p of prof.pts) { pos.push(x, p.y + yOff, p.z); nor.push(sgn, 0, 0); uv.push(x / uLen, p.s / prof.P); }
      for (let k = 0; k < m - 1; k++) {
        if (sgn > 0) idx.push(base, base + 2 + k, base + 1 + k);
        else idx.push(base, base + 1 + k, base + 2 + k);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function box(w, h, d, x, y, z, segX = 1) {
  const g = new T.BoxGeometry(w, h, d, segX, 1, 1);
  g.translate(x, y, z);
  return g;
}

/* ---------------------------------------------------------------- textures */
function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = false, flipY = true, aniso = 8 } = {}) {
  const t = new T.CanvasTexture(c);
  t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  t.flipY = flipY;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function brushedCanvas() {
  const W = 512, H = 512, c = cnv(W, H), g = c.getContext('2d');
  const R = rand(7);
  g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3200; i++) {
    const y = R() * H, x = R() * W, len = 40 + R() * 420, v = Math.round(105 + R() * 100);
    g.strokeStyle = `rgba(${v},${v},${v},${0.18 + R() * 0.32})`;
    g.lineWidth = 0.5 + R() * 1.3;
    for (const off of [0, -W]) { g.beginPath(); g.moveTo(x + off, y); g.lineTo(x + off + len, y); g.stroke(); }
  }
  return c;
}

function solarCanvas() {
  const Wmm = 40.6, Dmm = 22.6, W = 2048, H = Math.round(W * Dmm / Wmm), k = W / Wmm;
  const c = cnv(W, H), g = c.getContext('2d');
  const R = rand(11);
  g.fillStyle = '#04060c'; g.fillRect(0, 0, W, H);
  const cols = 5, rows = 2, gap = 0.45, m = 0.6;
  const cw = (Wmm - 2 * m - (cols - 1) * gap) / cols, ch = (Dmm - 2 * m - (rows - 1) * gap) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x0 = (m + i * (cw + gap)) * k, y0 = (m + j * (ch + gap)) * k, w = cw * k, h = ch * k, ch2 = 0.9 * k;
      g.save();
      g.beginPath();
      g.moveTo(x0 + ch2, y0); g.lineTo(x0 + w - ch2, y0); g.lineTo(x0 + w, y0 + ch2); g.lineTo(x0 + w, y0 + h - ch2);
      g.lineTo(x0 + w - ch2, y0 + h); g.lineTo(x0 + ch2, y0 + h); g.lineTo(x0, y0 + h - ch2); g.lineTo(x0, y0 + ch2); g.closePath();
      g.clip();
      const tint = R() * 10;
      const grd = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
      grd.addColorStop(0, `rgb(${14 + tint},${26 + tint},${52 + tint})`);
      grd.addColorStop(1, `rgb(${8 + tint},${16 + tint},${36 + tint})`);
      g.fillStyle = grd; g.fillRect(x0, y0, w, h);
      for (let n = 0; n < 900; n++) {
        const v = R() < 0.5 ? 'rgba(80,110,170,0.05)' : 'rgba(0,0,0,0.07)';
        g.fillStyle = v; g.beginPath(); g.arc(x0 + R() * w, y0 + R() * h, 4 + R() * 26, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(170,190,225,0.20)'; g.lineWidth = 1.4;
      for (let y = y0 + 0.4 * k; y < y0 + h; y += 0.72 * k) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); }
      g.fillStyle = 'rgba(185,200,228,0.42)';
      for (const f of [1 / 3, 2 / 3]) g.fillRect(x0 + w * f - 0.16 * k, y0, 0.32 * k, h);
      g.restore();
    }
  }
  return c;
}

function pcbCanvas(chips) {
  const Wmm = 40, Dmm = 22, W = 1024, H = Math.round(W * Dmm / Wmm), k = W / Wmm;
  const c = cnv(W, H), g = c.getContext('2d'), R = rand(23);
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#9a5612'); grd.addColorStop(1, '#b8701f');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const P = (x, z) => [(x + Wmm / 2) * k, (z + Dmm / 2) * k];
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const a = chips[Math.floor(R() * chips.length)], b = chips[Math.floor(R() * chips.length)];
    let [x, y] = P(a.x + (R() - 0.5) * a.w, a.z + (R() - 0.5) * a.d);
    const [x2, y2] = P(b.x + (R() - 0.5) * b.w, b.z + (R() - 0.5) * b.d);
    g.strokeStyle = `rgba(222,150,72,${0.45 + R() * 0.3})`; g.lineWidth = 2 + R() * 3;
    g.beginPath(); g.moveTo(x, y);
    if (R() < 0.5) { g.lineTo(x2, y); g.lineTo(x2, y2); } else { g.lineTo(x, y2); g.lineTo(x2, y2); }
    g.stroke();
  }
  for (const ch of chips) {
    const [x, y] = P(ch.x - ch.w / 2 - 0.4, ch.z - ch.d / 2 - 0.4);
    g.fillStyle = 'rgba(232,192,98,0.9)';
    g.fillRect(x, y, (ch.w + 0.8) * k, (ch.d + 0.8) * k);
  }
  for (let i = 0; i < 60; i++) {
    const x = R() * W, y = R() * H;
    g.fillStyle = 'rgba(235,190,100,0.9)'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a3008'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function chipCanvas(lines) {
  const c = cnv(256, 256), g = c.getContext('2d');
  g.fillStyle = '#16171a'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#7b7f87'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 38px ui-monospace, Menlo, monospace';
  lines.forEach((l, i) => g.fillText(l, 128, 128 + (i - (lines.length - 1) / 2) * 46));
  g.beginPath(); g.arc(34, 34, 10, 0, Math.PI * 2); g.fillStyle = '#2b2d31'; g.fill();
  return c;
}

function batteryCanvas() {
  const c = cnv(1024, 708), g = c.getContext('2d');
  g.fillStyle = '#dadcdf'; g.fillRect(0, 0, 1024, 708);
  g.fillStyle = '#e9eaec'; g.fillRect(70, 150, 884, 408);
  g.fillStyle = '#2a2d33'; g.textAlign = 'center';
  g.font = '700 74px "Plus Jakarta Sans", system-ui, sans-serif';
  g.fillText('Li-Po 3.85 V · 120 mAh', 512, 330);
  g.font = '500 40px "Plus Jakarta Sans", system-ui, sans-serif';
  g.fillText('BHAPPS · BH-01-BAT · curved cell', 512, 420);
  return c;
}

function etchCanvas(lines, wmm, hmm, { size = 0.62, weight = 600, track = 0, pxmm = 64 } = {}) {
  const W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm), c = cnv(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const fs = size * pxmm;
  g.font = `${weight} ${fs}px "Plus Jakarta Sans", system-ui, sans-serif`;
  const lh = H / lines.length;
  lines.forEach((line, i) => {
    const y = lh * (i + 0.5);
    const chars = [...line];
    const widths = chars.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + track * pxmm * (chars.length - 1);
    let x = (W - total) / 2;
    chars.forEach((ch, j) => { g.fillText(ch, x, y); x += widths[j] + track * pxmm; });
  });
  return c;
}

function normalFromHeight(src, strength) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cnv(w, h), og = out.getContext('2d'), img = og.createImageData(w, h), o = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, yr = y * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (d[(yr + xr) * 4] - d[(yr + xl) * 4]) / 255 * strength;
      const dy = (d[(yd + x) * 4] - d[(yu + x) * 4]) / 255 * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (yr + x) * 4;
      o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (-dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// Strap textures. u = 30 mm tile along the strap, v = profile perimeter (flipY=false → canvas row = v).
function strapCanvases(kind, prof) {
  const W = 1024, H = 2048, uMM = 30, pxU = W / uMM, pxV = H / prof.P;
  const col = cnv(W, H), g = col.getContext('2d');
  const hgt = cnv(W / 2, H / 2), h = hgt.getContext('2d');
  h.setTransform(0.5, 0, 0, 0.5, 0, 0);
  const R = rand(kind === 'leather' ? 3 : 5);
  const sv = (s) => s * pxV;
  const wrapDot = (ctx, x, y, r) => {
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      if (x + ox + r < 0 || x + ox - r > W || y + oy + r < 0 || y + oy - r > H) continue;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  };
  const inset = 2 - prof.rc;
  if (kind === 'leather') {
    g.fillStyle = '#d7c3a4'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(255,249,236,0.04)' : 'rgba(120,92,58,0.035)';
      wrapDot(g, R() * W, R() * H, 3 + R() * 14);
    }
    g.fillStyle = '#bba27f';
    g.fillRect(0, sv(prof.sTopEnd), W, sv(prof.sBotStart) - sv(prof.sTopEnd));
    g.fillRect(0, sv(prof.sBotEnd), W, H - sv(prof.sBotEnd));
    g.fillStyle = 'rgba(255,250,240,0.10)';
    g.fillRect(0, sv(prof.sBotStart), W, sv(prof.sBotEnd) - sv(prof.sBotStart));
    h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
    for (let i = 0; i < 16000; i++) {
      const v = R() < 0.5 ? 150 : 104;
      h.fillStyle = `rgba(${v},${v},${v},0.35)`;
      wrapDot(h, R() * W, R() * H, 1 + R() * 3.2);
    }
    const rows = [inset, prof.sTopEnd - inset, prof.sBotStart + inset, prof.sBotEnd - inset];
    for (const s of rows) {
      const y = sv(s);
      g.strokeStyle = 'rgba(110,85,55,0.16)'; g.lineWidth = 0.7 * pxV;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      h.strokeStyle = 'rgb(92,92,92)'; h.lineWidth = 0.6 * pxV;
      h.beginPath(); h.moveTo(0, y); h.lineTo(W, y); h.stroke();
      for (let k = 0; k < 10; k++) {
        const cx = (k + 0.5) * 3 * pxU, half = 1.05 * pxU, tilt = 0.12 * pxV;
        g.lineCap = h.lineCap = 'round';
        g.strokeStyle = 'rgba(70,52,30,0.35)'; g.lineWidth = 0.5 * pxV;
        g.beginPath(); g.moveTo(cx - half, y + tilt + 3); g.lineTo(cx + half, y - tilt + 3); g.stroke();
        g.strokeStyle = '#efe5d3'; g.lineWidth = 0.42 * pxV;
        g.beginPath(); g.moveTo(cx - half, y + tilt); g.lineTo(cx + half, y - tilt); g.stroke();
        h.strokeStyle = 'rgb(225,225,225)'; h.lineWidth = 0.42 * pxV;
        h.beginPath(); h.moveTo(cx - half, y + tilt); h.lineTo(cx + half, y - tilt); h.stroke();
        for (const ex of [cx - half - 0.35 * pxU, cx + half + 0.35 * pxU]) {
          g.fillStyle = 'rgba(80,60,36,0.55)'; wrapDot(g, ex, y, 0.2 * pxV);
          h.fillStyle = 'rgb(40,40,40)'; wrapDot(h, ex, y, 0.22 * pxV);
        }
      }
    }
  } else {
    g.fillStyle = '#26282c'; g.fillRect(0, 0, W, H);
    h.fillStyle = 'rgb(55,55,55)'; h.fillRect(0, 0, W, H);
    const courses = 40, cu = uMM / courses;
    const wales = Math.round(prof.P / 0.85), wv = prof.P / wales;
    const redS = [2.2 - prof.rc, prof.sTopEnd - (2.2 - prof.rc), prof.sBotStart + (2.2 - prof.rc), prof.sBotEnd - (2.2 - prof.rc)];
    g.lineCap = h.lineCap = 'round';
    for (let j = 0; j < wales; j++) {
      const sc = (j + 0.5) * wv;
      const isRed = redS.some((s) => Math.abs(s - sc) < wv * 0.55);
      for (let i = 0; i < courses; i++) {
        const u = (i + 0.5) * cu;
        const x = u * pxU, y = sc * pxV, du = cu * pxU, dv = wv * pxV;
        const jit = (R() - 0.5) * 16;
        const base = isRed ? [190 + jit, 40 + jit / 3, 48 + jit / 3] : [54 + jit, 57 + jit, 63 + jit];
        g.strokeStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
        g.lineWidth = dv * 0.36;
        for (const sgn of [-1, 1]) {
          g.beginPath(); g.moveTo(x - du * 0.42, y + sgn * dv * 0.36); g.lineTo(x + du * 0.4, y + sgn * dv * 0.06); g.stroke();
          h.strokeStyle = 'rgb(210,210,210)'; h.lineWidth = dv * 0.34;
          h.beginPath(); h.moveTo(x - du * 0.42, y + sgn * dv * 0.36); h.lineTo(x + du * 0.4, y + sgn * dv * 0.06); h.stroke();
        }
      }
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      wrapDot(g, R() * W, R() * H, 1 + R() * 2);
    }
  }
  return { col, nrm: normalFromHeight(hgt, kind === 'leather' ? 1.4 : 2.0) };
}

/* -------------------------------------------------------------- environment */
export function makeEnv(renderer) {
  const s = new T.Scene();
  s.background = new T.Color(0x0a1c3e);
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide });
    const p = new T.Mesh(new T.PlaneGeometry(w, h), m);
    p.position.set(...pos); p.lookAt(0, 0, 0); s.add(p);
  };
  panel(34, 26, [4, 42, 12], 5.5);
  panel(7, 46, [-40, 12, 14], 3.6);
  panel(7, 46, [40, 8, -4], 3.0, 0xf3f6ff);
  panel(64, 10, [0, -10, 42], 1.1, 0xfff1de);
  panel(46, 14, [0, 16, -42], 2.0, 0x9cc0ff);
  panel(20, 20, [26, 30, 30], 1.6);
  panel(70, 70, [0, -42, 0], 0.7, 0xd5def2);
  const pm = new T.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.03);
  pm.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------------- viewer */
export function createViewer(canvas, opts = {}) {
  let disposed = false;
  const api = { setVariant() {}, setView() {}, setExploded() {}, dispose() { disposed = true; } };
  const pending = { variant: opts.variant || 'QL', view: opts.view || 'persp', exploded: !!opts.exploded };
  api.setVariant = (v) => { pending.variant = v; };
  api.setView = (v) => { pending.view = v; };
  api.setExploded = (b) => { pending.exploded = b; };

  const fontReady = (document.fonts && document.fonts.load)
    ? Promise.race([
      Promise.all([
        document.fonts.load('600 40px "Plus Jakarta Sans"'),
        document.fonts.load('700 40px "Plus Jakarta Sans"'),
      ]).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ])
    : Promise.resolve();

  fontReady.then(() => {
    if (disposed) return;
    try { build(); } catch (e) { console.error(e); opts.onError && opts.onError(e); }
  });

  function build() {
    const t0 = performance.now(); const tlog = (m) => opts.debug && console.log('[bhapps]', m, Math.round(performance.now() - t0));
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.VSMShadowMap;
    renderer.setClearColor(0x000000, 0);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new T.Scene();
    scene.environment = makeEnv(renderer);
    scene.environmentIntensity = 1.0;

    const camera = new T.PerspectiveCamera(30, 1, 1, 3000);
    camera.position.set(95, 58, 130);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 55;
    controls.maxDistance = 420;
    controls.rotateSpeed = 0.8;
    controls.target.set(0, 2, 0);

    // lights
    const key = new T.DirectionalLight(0xffffff, 1.6);
    key.position.set(30, 140, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 400 });
    key.shadow.radius = 14;
    key.shadow.blurSamples = 20;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new T.DirectionalLight(0xa9c8ff, 1.1);
    rim.position.set(-80, 40, -90);
    scene.add(rim);
    const fill = new T.DirectionalLight(0xfff2e0, 0.35);
    fill.position.set(60, 10, 120);
    scene.add(fill);
    const head = new T.DirectionalLight(0xffffff, 0.55);
    head.position.set(0.3, 0.4, 1);
    camera.add(head);
    camera.add(head.target);
    head.target.position.set(0, 0, -1);
    scene.add(camera);

    // floor shadow
    const floor = new T.Mesh(new T.PlaneGeometry(600, 600), new T.ShadowMaterial({ color: 0x00030c, opacity: 0.42 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);
    const blobC = cnv(256, 256), bg = blobC.getContext('2d');
    const rg = bg.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, 'rgba(0,0,0,0.75)'); rg.addColorStop(0.35, 'rgba(0,0,0,0.32)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = rg; bg.fillRect(0, 0, 256, 256);
    const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex(blobC), transparent: true, depthWrite: false, color: 0x000814 }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(46, 40, 1);
    blob.position.y = FLOOR_Y + 0.05;
    blob.renderOrder = -1;
    scene.add(blob);

    /* ---------------------------------------------------------- materials */
    tlog('scene setup');
    const brushedC = brushedCanvas();
    const brushed = tex(brushedC, { srgb: false, repeat: true, aniso: maxAniso });
    const brushed2 = tex(brushedC, { srgb: false, repeat: true, aniso: maxAniso });
    brushed2.repeat.set(3, 3);
    const P = (o) => new T.MeshPhysicalMaterial(o);
    const S = (o) => new T.MeshStandardMaterial(o);

    const leatherProf = roundedProfile(STRAP_W / 2, STRAP_T, 1.0, 6);
    const knitProf = roundedProfile(STRAP_W / 2, STRAP_T, 1.25, 6);
    const lc = strapCanvases('leather', leatherProf);
    const kc = strapCanvases('knit', knitProf);
    const strapTex = (c, srgb) => tex(c, { srgb, repeat: true, flipY: false, aniso: maxAniso });

    tlog('strap textures');
    const etchLogoC = etchCanvas(['BHAPPS'], 16, 2.2, { size: 1.15, weight: 600, track: 0.75 });
    const etchRegC = etchCanvas(['BHAPPS · MODEL BH-01', 'DESIGNED IN INDONESIA', 'SOLAR + TEG · Li-Po 120 mAh'], 14, 5.0, { size: 0.74, weight: 600, track: 0.08 });
    const logoAlpha = tex(etchLogoC, { srgb: false, aniso: maxAniso });
    const regAlpha = tex(etchRegC, { srgb: false, aniso: maxAniso });
    const etchMat = (alphaMap, color, metal, rough) => S({
      color, metalness: metal, roughness: rough, alphaMap, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });

    const VAR = {
      QL: {
        casing: P({ color: 0xd3c2a5, metalness: 1, roughness: 0.62, roughnessMap: brushed, anisotropy: 0.55 }),
        bezel: P({ color: 0xe3d3b6, metalness: 1, roughness: 0.1 }),
        tegPlate: P({ color: 0xc9845a, metalness: 1, roughness: 0.6, roughnessMap: brushed2 }),
        strap: P({ map: strapTex(lc.col, true), normalMap: strapTex(lc.nrm, false), normalScale: new T.Vector2(0.55, 0.55), roughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.55, sheen: 0.25, sheenRoughness: 0.7, sheenColor: new T.Color(0xfff3e0) }),
        buckle: P({ color: 0xdfcdae, metalness: 1, roughness: 0.14 }),
        etchLogo: etchMat(logoAlpha, 0x4a4136, 0.45, 0.75),
        etchReg: etchMat(regAlpha, 0x3a332b, 0.35, 0.8),
      },
      PF: {
        casing: P({ color: 0x1f2124, metalness: 0.75, roughness: 0.6, roughnessMap: brushed2, clearcoat: 0.25, clearcoatRoughness: 0.45 }),
        bezel: P({ color: 0x2c2e33, metalness: 1, roughness: 0.16 }),
        tegPlate: P({ color: 0x8f9398, metalness: 1, roughness: 0.6, roughnessMap: brushed2 }),
        strap: P({ map: strapTex(kc.col, true), normalMap: strapTex(kc.nrm, false), normalScale: new T.Vector2(0.9, 0.9), roughness: 0.84, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new T.Color(0x7d8696) }),
        buckle: P({ color: 0x1e1f23, metalness: 0.8, roughness: 0.32 }),
        etchLogo: etchMat(logoAlpha, 0xa4a9b0, 0.6, 0.5),
        etchReg: etchMat(regAlpha, 0xb0b5bc, 0.6, 0.5),
      },
    };
    const strapMats = [VAR.QL.strap, VAR.PF.strap, VAR.QL.buckle, VAR.PF.buckle];

    const glassMat = P({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.8, ior: 1.77, specularIntensity: 1, envMapIntensity: 1.0 });
    const lensMat = P({ color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.6, ior: 1.52, envMapIntensity: 1.2 });
    const solarMat = P({ map: tex(solarCanvas(), { aniso: maxAniso }), roughness: 0.36, metalness: 0.3, iridescence: 0.12, iridescenceIOR: 1.6, iridescenceThicknessRange: [260, 380] });
    const steel = P({ color: 0xd6d9dd, metalness: 1, roughness: 0.14 });
    const steelBrushed = P({ color: 0xc8cbcf, metalness: 1, roughness: 0.55, roughnessMap: brushed2 });
    const gold = P({ color: 0xe8bb5c, metalness: 1, roughness: 0.2 });
    const blackMatte = S({ color: 0x07080a, roughness: 0.85 });
    const substrate = S({ color: 0x0e1013, roughness: 0.55 });
    const ledGreen = S({ color: 0x0c3a1d, emissive: 0x2dff7a, emissiveIntensity: 1.3, roughness: 0.3 });
    const ledRed = S({ color: 0x3a0b0b, emissive: 0xff2b2b, emissiveIntensity: 1.3, roughness: 0.3 });
    const ledIR = S({ color: 0x1c1018, emissive: 0x4a1440, emissiveIntensity: 0.35, roughness: 0.3 });
    const photodiode = P({ color: 0x1b2a5c, metalness: 0.45, roughness: 0.22, clearcoat: 0.6 });
    const statusLed = S({ color: 0x9fffe0, emissive: 0x47f0b0, emissiveIntensity: 1.2, roughness: 0.4 });
    const ceramic = S({ color: 0xeeeae2, roughness: 0.62 });
    const pellet = P({ color: 0x4a4e55, metalness: 0.6, roughness: 0.42 });
    const copper = P({ color: 0xc27c4c, metalness: 1, roughness: 0.3 });
    const batt = P({ map: tex(batteryCanvas(), { aniso: maxAniso }), color: 0xd0d3d7, metalness: 0.7, roughness: 0.4 });
    const nickel = P({ color: 0xbfc3c8, metalness: 1, roughness: 0.3 });
    const foam = S({ color: 0x111214, roughness: 0.95 });
    const chipSide = S({ color: 0x141518, roughness: 0.5 });

    /* ------------------------------------------------------------- groups */
    const root = new T.Group();
    scene.add(root);
    const pickables = [];
    const layers = {};
    const mk = (name, explode, interior = false) => {
      const g = new T.Group();
      g.userData = { explode: explode.clone ? explode : new T.Vector3(0, explode, 0), interior };
      root.add(g);
      layers[name] = g;
      return g;
    };
    const add = (group, geo, mat, keyName, role, { cast = true, bendIt = true } = {}) => {
      const m = new T.Mesh(bendIt ? bend(geo) : geo, mat);
      m.castShadow = cast;
      m.userData.key = keyName;
      if (role) m.userData.role = role;
      group.add(m);
      if (keyName) pickables.push(m);
      return m;
    };

    const L = {
      strap: mk('strap', 0),
      qrL: mk('qrL', new T.Vector3(-16, 8, 0), false),
      qrR: mk('qrR', new T.Vector3(16, 8, 0), false),
      housing: mk('housing', 0),
      teg: mk('teg', 9, true),
      lra: mk('lra', 16, true),
      battery: mk('battery', 24, true),
      pcb: mk('pcb', 32, true),
      frame: mk('frame', 40),
      bezel: mk('bezel', 49),
      solar: mk('solar', 56),
      glass: mk('glass', 63),
    };

    /* -------------------------------------------------------------- strap */
    const xEnd = POD_L / 2 - 3.5;
    const loopLen = 2 * Math.PI * RM;
    const strapX0 = xEnd, strapX1 = loopLen - xEnd;
    // Main run starts where the pod's flat case-back ends; the short end pieces tuck into the pod
    // with a slightly raised inner face so they never share a surface with the case back.
    const tuck = POD_L / 2 - 0.5;
    for (const [prof, v] of [[leatherProf, 'QL'], [knitProf, 'PF']]) {
      const endProf = roundedProfile(STRAP_W / 2, STRAP_T - 0.35, prof.rc, 6);
      const parts = [
        sweep(prof, tuck, loopLen - tuck, 0.9),
        sweep(endProf, strapX0, tuck, 0.5, { yOff: 0.35 }),
        sweep(endProf, loopLen - tuck, strapX1, 0.5, { yOff: 0.35 }),
      ];
      const m = add(L.strap, mergeGeometries(parts), VAR[v].strap, 'strap', 'strap');
      m.userData.only = v;
    }
    const bx = Math.PI * RM; // bottom of the loop
    const keeperProf = roundedProfile(STRAP_W / 2 + 0.9, STRAP_T + 1.8, 1.5, 6);
    add(L.strap, sweep(keeperProf, bx + 7.5, bx + 13, 0.6, { yOff: -0.9 }), VAR.QL.strap, 'keeper', 'strap');
    // buckle frame (rounded rectangle tube resting on the strap)
    {
      const pts = [];
      const hw = 4.3, hd = STRAP_W / 2 + 1.7, r = 2.4, y = STRAP_T + 1.0;
      const seg = (x0, z0, x1, z1, n) => { for (let i = 0; i < n; i++) pts.push(new T.Vector3(x0 + (x1 - x0) * i / n, y, z0 + (z1 - z0) * i / n)); };
      const arc = (cx, cz, a0) => { for (let i = 0; i < 8; i++) { const a = a0 + (Math.PI / 2) * i / 8; pts.push(new T.Vector3(cx + r * Math.cos(a), y, cz + r * Math.sin(a))); } };
      seg(-hw + r, -hd, hw - r, -hd, 6); arc(hw - r, -hd + r, -Math.PI / 2);
      seg(hw, -hd + r, hw, hd - r, 14); arc(hw - r, hd - r, 0);
      seg(hw - r, hd, -hw + r, hd, 6); arc(-hw + r, hd - r, Math.PI / 2);
      seg(-hw, hd - r, -hw, -hd + r, 14); arc(-hw + r, -hd + r, Math.PI);
      const curve = new T.CatmullRomCurve3(pts.map((p) => p.add(new T.Vector3(bx, 0, 0))), true, 'centripetal');
      add(L.strap, new T.TubeGeometry(curve, 220, 0.95, 14, true), VAR.QL.buckle, 'buckle', 'buckle');
      const tang = new T.CylinderGeometry(0.55, 0.55, 8.6, 14, 8);
      tang.rotateZ(Math.PI / 2);
      tang.translate(bx, STRAP_T + 0.62, 0);
      add(L.strap, tang, VAR.QL.buckle, 'buckle', 'buckle');
    }

    /* -------------------------------------------------------- quick-release */
    const levers = [];
    for (const [grp, sgn] of [[L.qrL, -1], [L.qrR, 1]]) {
      const bar = new T.CylinderGeometry(0.75, 0.75, 24.4, 18, 1);
      bar.rotateX(Math.PI / 2);
      bar.translate(sgn * 20.0, 1.5, 0);
      add(grp, bar, steel, 'qr', null);
      for (const zz of [-12.3, 12.3]) {
        const tip = new T.CylinderGeometry(0.45, 0.45, 0.8, 14, 1);
        tip.rotateX(Math.PI / 2);
        tip.translate(sgn * 20.0, 1.5, zz);
        add(grp, tip, steel, 'qr', null);
      }
      const lever = slab(1.4, 3.6, 0.7, 0.6, 0.25, { x: sgn * (POD_L / 2 + 2.4), y0: -0.55, z: 8.4, maxEdge: 0 });
      levers.push(add(grp, lever, steel, 'qr', null));
    }

    /* ---------------------------------------------------- housing (bottom) */
    const H = L.housing;
    add(H, slab(POD_L, POD_W, 2.4, 7, 0.7), VAR.QL.casing, 'housing', 'casing');
    // optical window
    add(H, lathe([[5.0, 0.1], [5.0, -0.28], [5.25, -0.46], [6.25, -0.46], [6.6, -0.28], [6.6, 0.1]], 0, 0, 64), steel, 'ecgRing');
    add(H, lathe([[0, -0.05], [5.0, -0.05]], 0, 0, 48), substrate, 'lens', null, { cast: false });
    const dome = [];
    for (let i = 0; i <= 12; i++) { const r = 5.0 * i / 12; dome.push([r, -0.78 + 0.5 * (r / 5) ** 2]); }
    dome.push([5.0, 0.0]);
    add(H, lathe(dome, 0, 0, 64), lensMat, 'lens', null, { cast: false });
    add(H, lathe([[2.05, -0.02], [2.05, -0.66], [2.45, -0.66], [2.45, -0.02]], 0, 0, 48), blackMatte, 'barrier');
    add(H, box(0.9, 0.26, 0.9, -0.85, -0.18, 0), ledGreen, 'green');
    add(H, box(0.9, 0.26, 0.9, 0.85, -0.18, 0), ledGreen, 'green');
    add(H, box(0.8, 0.26, 0.8, 0, -0.18, 0.9), ledRed, 'red');
    add(H, box(0.8, 0.26, 0.8, 0, -0.18, -0.9), ledIR, 'ir');
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const g = new T.BoxGeometry(1.5, 0.2, 1.5);
      g.rotateY(a);
      g.translate(3.45 * Math.cos(a), -0.14, 3.45 * Math.sin(a));
      add(H, g, photodiode, 'pd');
    }
    // TEG plates (stadium) left/right
    for (const zz of [-9.55, 9.55]) add(H, slab(36, 4.6, 0.5, 2.3, 0.18, { y0: -0.32, z: zz, maxEdge: 1.2 }), VAR.QL.tegPlate, 'tegPlate', 'tegPlate');
    // EDA electrodes
    for (const zz of [-3.3, 3.3]) add(H, lathe([[0, -0.36], [0.9, -0.33], [1.25, -0.2], [1.3, 0.1]], -11.2, zz, 32), steel, 'eda');
    // thermistor
    add(H, lathe([[1.0, -0.03], [1.75, -0.03]], 11.2, 0, 32), blackMatte, 'therm', null, { cast: false });
    add(H, lathe([[0, -0.48], [0.7, -0.42], [0.95, -0.25], [1.0, 0.05]], 11.2, 0, 32), steel, 'therm');
    // pogo pins
    for (const zz of [-4.2, -1.4, 1.4, 4.2]) {
      add(H, lathe([[0.72, -0.02], [1.1, -0.02]], -17.4, zz, 28), blackMatte, 'pogo', null, { cast: false });
      add(H, lathe([[0, -0.16], [0.5, -0.13], [0.68, -0.05], [0.7, 0.05]], -17.4, zz, 28), gold, 'pogo');
    }
    // regulatory etch
    {
      const g = new T.PlaneGeometry(14, 5.0, 4, 6);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.translate(16.6, -0.02, 0);
      add(H, g, VAR.QL.etchReg, 'reg', 'etchReg', { cast: false });
    }

    /* ---------------------------------------------------------------- TEG */
    for (const zz of [-9.55, 9.55]) {
      add(L.teg, box(31, 0.45, 4.4, 0, 0.55, zz, 24), ceramic, 'teg');
      add(L.teg, box(31, 0.45, 4.4, 0, 2.45, zz, 24), ceramic, 'teg');
      const pel = [];
      for (let i = 0; i < 20; i++) for (let j = 0; j < 3; j++) pel.push(box(0.7, 1.45, 0.7, -13.3 + i * 1.4, 1.5, zz - 1.25 + j * 1.25));
      add(L.teg, mergeGeometries(pel), pellet, 'teg');
      const strips = [];
      for (let i = 0; i < 10; i++) strips.push(box(2.0, 0.08, 3.6, -12.6 + i * 2.8, 0.82, zz));
      add(L.teg, mergeGeometries(strips), copper, 'teg');
    }
    add(L.teg, slab(40, 24, 0.25, 5, 0.06, { y0: 2.85, maxEdge: 1.6 }), copper, 'spreader');

    /* ---------------------------------------------------------------- LRA */
    {
      const c = new T.CylinderGeometry(3.6, 3.6, 2.5, 48, 1);
      c.translate(-15, 4.25, 0);
      add(L.lra, c, steelBrushed, 'lra');
      const f = new T.CylinderGeometry(3.0, 3.0, 0.22, 40, 1);
      f.translate(-15, 5.62, 0);
      add(L.lra, f, foam, 'lra');
    }

    /* ------------------------------------------------------------ battery */
    add(L.battery, slab(26, 18, 2.6, 3, 0.75, { x: 3, y0: 2.6, uv: (x, y, z) => [(x - 3 + 13) / 26, 1 - (z + 9) / 18] }), batt, 'battery');
    for (const zz of [-3, 3]) add(L.battery, box(3.2, 0.12, 2.2, 17.4, 3.8, zz, 2), nickel, 'battery');

    /* ---------------------------------------------------------------- PCB */
    const chips = [
      { k: 'soc', x: -4.5, z: -4.2, w: 5, d: 5, h: 0.85, t: ['BLE', 'SoC'] },
      { k: 'pmic', x: 3.8, z: -4.4, w: 4, d: 4, h: 0.75, t: ['PMIC', 'EH'] },
      { k: 'afe', x: -4.5, z: 4.6, w: 4.6, d: 3.6, h: 0.75, t: ['AFE'] },
      { k: 'imu', x: 3.6, z: 4.6, w: 2.6, d: 3.0, h: 0.8, t: ['IMU', '6X'] },
      { k: 'flash', x: 9.6, z: 0, w: 3.2, d: 4.2, h: 0.7, t: ['FLASH'] },
    ];
    const pcbMat = P({ map: tex(pcbCanvas(chips), { aniso: maxAniso }), roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.18 });
    add(L.pcb, slab(40, 22, 0.22, 4, 0.05, { y0: 5.3, uv: (x, y, z) => [(x + 20) / 40, 1 - (z + 11) / 22] }), pcbMat, 'pcb');
    for (const ch of chips) {
      const top = S({ map: tex(chipCanvas(ch.t), { aniso: maxAniso }), roughness: 0.45 });
      const g = new T.BoxGeometry(ch.w, ch.h, ch.d, 3, 1, 1);
      g.translate(ch.x, 5.52 + ch.h / 2, ch.z);
      add(L.pcb, g, [chipSide, chipSide, top, chipSide, chipSide, chipSide], ch.k);
    }
    {
      const parts = [];
      const n = 6, x0 = 13.4, pitch = 0.95, len = 15;
      for (let i = 0; i < n; i++) parts.push(box(0.36, 0.05, len, x0 + i * pitch, 5.545, 0, 1));
      for (let i = 0; i < n - 1; i++) parts.push(box(pitch + 0.36, 0.05, 0.36, x0 + i * pitch + pitch / 2, 5.545, (i % 2 ? -1 : 1) * (len / 2 - 0.18), 2));
      add(L.pcb, mergeGeometries(parts), gold, 'antenna', null, { cast: false });
    }

    /* -------------------------------------------------------------- frame */
    add(L.frame, slab(POD_L, POD_W, 4.6, 7, 0.45, { y0: 2.4, hole: { w: 41, d: 23, r: 4.5 } }), VAR.QL.casing, 'frame', 'casing');
    {
      const g = new T.PlaneGeometry(16, 2.2, 40, 1);
      g.translate(0, 4.7, POD_W / 2 + 0.015);
      add(L.frame, g, VAR.QL.etchLogo, 'logo', 'etchLogo', { cast: false });
    }

    /* -------------------------------------------------------------- bezel */
    add(L.bezel, slab(44.6, 26.6, 0.7, 6.3, 0.25, { y0: 6.9, hole: { w: 41.6, d: 23.6, r: 4.8 } }), VAR.QL.bezel, 'bezel', 'bezel');
    add(L.bezel, lathe([[0.5, 7.604], [0, 7.604]], 21.55, 0, 24), blackMatte, 'led', null, { cast: false });
    add(L.bezel, lathe([[0.34, 7.612], [0, 7.612]], 21.55, 0, 24), statusLed, 'led', null, { cast: false });

    /* -------------------------------------------------------- solar/glass */
    add(L.solar, slab(40.6, 22.6, 0.25, 4.2, 0.04, { y0: 6.62, maxEdge: 1.4, uv: (x, y, z) => [(x + 20.3) / 40.6, (z + 11.3) / 22.6] }), solarMat, 'solar');
    add(L.glass, slab(41.4, 23.4, 0.85, 4.7, 0.3, { y0: 6.95 }), glassMat, 'glass', null, { cast: false });

    tlog('geometry built');
    /* ------------------------------------------------------------ variant */
    const st = {
      variant: null, view: pending.view, exploded: pending.exploded,
      ex: pending.exploded ? 1 : 0, exTarget: pending.exploded ? 1 : 0,
      strapA: 1, strapATarget: 1,
    };
    function applyVariant(v) {
      clearHover();
      st.variant = v;
      root.traverse((o) => {
        if (!o.isMesh) return;
        const role = o.userData.role;
        if (o.userData.only) o.visible = o.userData.only === v;
        if (role && VAR[v][role]) {
          if (role === 'strap' && o.userData.only) o.material = VAR[v].strap;
          else o.material = VAR[v][role];
        }
      });
      setStrapAlpha(st.strapA, true);
    }
    function setStrapAlpha(a, force) {
      for (const m of strapMats) {
        const tr = a < 0.999;
        if (m.transparent !== tr || force) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
        m.opacity = a;
      }
      L.strap.visible = a > 0.01;
      L.strap.traverse((o) => { if (o.isMesh) o.castShadow = a > 0.6; });
    }

    /* ------------------------------------------------------------- camera */
    const sph = (r, phi, theta) => new T.Spherical(r, phi, theta);
    function preset(view, ex) {
      switch (view) {
        case 'atas': return { t: new T.Vector3(0, ex ? 46 : 24, 0), s: sph(ex ? 250 : 140, 0.1, 0.0) };
        case 'bawah': return { t: new T.Vector3(0, 24, 0), s: sph(ex ? 170 : 125, Math.PI - 0.5, 0.0) };
        case 'samping': return { t: new T.Vector3(0, ex ? 40 : 1, 0), s: sph(ex ? 270 : 185, Math.PI / 2 - 0.04, 0.0) };
        default: return { t: new T.Vector3(0, ex ? 46 : 2, 0), s: sph(ex ? 255 : 178, 1.12, 0.62) };
      }
    }
    let camTween = null;
    function aspectK() {
      const a = camera.aspect || 1.6;
      return a < 1.35 ? Math.pow(1.35 / a, 0.85) : 1;
    }
    function goTo(view, instant) {
      const p = preset(view, st.exploded);
      p.s.radius *= aspectK();
      const fromS = new T.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (instant) {
        controls.target.copy(p.t);
        camera.position.copy(new T.Vector3().setFromSpherical(p.s).add(p.t));
        camTween = null;
        return;
      }
      let dTheta = p.s.theta - fromS.theta;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
      camTween = { t: 0, dur: 1.0, fromT: controls.target.clone(), toT: p.t, fromS, toS: p.s, dTheta };
    }
    function strapTargetFor() {
      if (st.view === 'bawah' && !st.exploded) return 0;
      return st.exploded ? 0.22 : 1;
    }

    /* -------------------------------------------------------------- hover */
    const ray = new T.Raycaster();
    const ptr = new T.Vector2();
    let hoverKey = null, hoverMeshes = [], lastPtr = null, needPick = false, dragging = false;
    function clearHover() {
      for (const m of hoverMeshes) { if (m.userData.baseMat) { m.material = m.userData.baseMat; delete m.userData.baseMat; } }
      hoverMeshes = [];
      hoverKey = null;
    }
    function highlight(keyName) {
      clearHover();
      hoverKey = keyName;
      if (!keyName) return;
      for (const m of pickables) {
        if (m.userData.key !== keyName || !m.visible) continue;
        m.userData.baseMat = m.material;
        const tint = (mat) => {
          const c = mat.clone();
          if (c.emissive) { c.emissive = c.emissive.clone().lerp(new T.Color(0x3d7bff), 0.6); c.emissiveIntensity = Math.max(c.emissiveIntensity || 0, 0.35); }
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
        hoverMeshes.push(m);
      }
    }
    const visibleDeep = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
    function pick() {
      needPick = false;
      if (!lastPtr || dragging) return;
      const rect = canvas.getBoundingClientRect();
      ptr.set(((lastPtr.x - rect.left) / rect.width) * 2 - 1, -((lastPtr.y - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hits = ray.intersectObjects(pickables, false);
      let hit = null;
      for (const h of hits) {
        if (!visibleDeep(h.object)) continue;
        if (h.object.parent === L.strap && st.strapA < 0.5) continue;
        hit = h; break;
      }
      const k = hit ? hit.object.userData.key : null;
      if (k !== hoverKey) highlight(k);
      canvas.style.cursor = k ? 'help' : 'grab';
      if (opts.onHover) {
        if (!k) opts.onHover(null);
        else {
          const lab = labelFor(k, st.variant);
          opts.onHover({ ...lab, x: lastPtr.x - rect.left, y: lastPtr.y - rect.top, w: rect.width, h: rect.height });
        }
      }
    }
    const onMove = (e) => { lastPtr = { x: e.clientX, y: e.clientY }; needPick = true; };
    const onLeave = () => { lastPtr = null; highlight(null); canvas.style.cursor = 'grab'; opts.onHover && opts.onHover(null); };
    const onDown = () => { dragging = true; };
    const onUp = () => { dragging = false; needPick = true; };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    /* ------------------------------------------------------------- sizing */
    function resize() {
      const el = canvas.parentElement || canvas;
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement || canvas);
    resize();

    /* ---------------------------------------------------------------- api */
    api.setVariant = (v) => { if (VAR[v] && v !== st.variant) applyVariant(v); };
    api.setView = (v) => { st.view = v; st.strapATarget = strapTargetFor(); goTo(v); };
    api.setExploded = (b) => { st.exploded = !!b; st.exTarget = b ? 1 : 0; st.strapATarget = strapTargetFor(); goTo(st.view); };
    api.dispose = () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose();
    };
    api._debug = { scene, camera, controls, renderer, st, root, layers, VAR, levers };

    applyVariant(pending.variant);
    st.strapATarget = strapTargetFor();
    st.strapA = st.strapATarget;
    setStrapAlpha(st.strapA, true);
    goTo(st.view, true);

    /* --------------------------------------------------------------- loop */
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const clock = new T.Clock();
    let readySent = false, frames = 0, paused = false, simTime = 0;
    function step(dt, draw = true) {
      simTime += dt;
      const time = simTime;
      // explode
      if (st.ex !== st.exTarget) {
        const d = st.exTarget - st.ex, stepv = dt / 0.9;
        st.ex = Math.abs(d) <= stepv ? st.exTarget : st.ex + Math.sign(d) * stepv;
      }
      const e = ease(st.ex);
      for (const g of Object.values(layers)) {
        g.position.copy(g.userData.explode).multiplyScalar(e);
        if (g.userData.interior) g.visible = st.ex > 0.015;
      }
      if (st.strapA !== st.strapATarget) {
        const d = st.strapATarget - st.strapA, stepv = dt / 0.5;
        st.strapA = Math.abs(d) <= stepv ? st.strapATarget : st.strapA + Math.sign(d) * stepv;
        setStrapAlpha(st.strapA);
      }
      for (const lv of levers) lv.visible = st.strapA > 0.3 || st.ex > 0.02;
      if (camTween) {
        camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
        const k = ease(camTween.t);
        const tgt = camTween.fromT.clone().lerp(camTween.toT, k);
        const s = new T.Spherical(
          camTween.fromS.radius + (camTween.toS.radius - camTween.fromS.radius) * k,
          camTween.fromS.phi + (camTween.toS.phi - camTween.fromS.phi) * k,
          camTween.fromS.theta + camTween.dTheta * k,
        );
        controls.target.copy(tgt);
        camera.position.copy(new T.Vector3().setFromSpherical(s).add(tgt));
        if (camTween.t >= 1) camTween = null;
      }
      statusLed.emissiveIntensity = 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(time * 2.2));
      controls.update();
      if (needPick) pick();
      if (!draw) return;
      renderer.render(scene, camera);
      if (!readySent && ++frames > 1) { readySent = true; opts.onReady && opts.onReady(); }
    }
    renderer.setAnimationLoop(() => { const dt = Math.min(clock.getDelta(), 0.05); if (!paused) step(dt); });
    api._test = {
      pause: (b) => { paused = b; },
      advance: (sec) => { const n = Math.ceil(sec / 0.05); for (let i = 0; i < n; i++) step(0.05, i === n - 1); },
    };
  }

  return {
    setVariant: (v) => api.setVariant(v),
    setView: (v) => api.setView(v),
    setExploded: (b) => api.setExploded(b),
    dispose: () => api.dispose(),
    get debug() { return api._debug; },
    get test() { return api._test; },
  };
}
