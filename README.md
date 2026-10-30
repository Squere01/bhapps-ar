# BHAPPS Health Band — Web AR (Performance Edition)

Gelang 3D muncul di pergelangan **hanya saat kamera mendeteksi tangan**. Deteksi tangan memakai
MediaPipe Hand Landmarker dan berjalan di HP (video tidak dikirim ke server).

## Isi folder
- `index.html`, `app.js` — aplikasi AR (siap pakai, tidak perlu build)
- `models/bhapps_performance_ar.glb` — model gelang versi ringan untuk AR (±12 ribu segitiga, ±0,7 MB)
- `wasm/` — runtime MediaPipe
- `source/` — kode sumber, kalau ingin mengubah lalu build ulang (`npm i && npm run build`)

## 1. Coba di laptop
```
npx serve .
```
- `http://localhost:3000/?demo` → tangan sintetis, tanpa kamera (cek tampilan & foto)
- `http://localhost:3000/` → pakai webcam laptop

## 2. Online supaya bisa dibuka di HP (wajib https)
```
npx vercel --prod
```
Atau seret folder ini ke https://app.netlify.com/drop. Buka link https-nya di HP → **Mulai kamera** → izinkan kamera.

## 3. (Opsional) Simpan model tangan sendiri
Unduh https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
dan taruh di `models/hand_landmarker.task`. Kalau file ini ada, aplikasi memakainya; kalau tidak, model diambil dari Google.

## Tips
- Kamera belakang, punggung tangan menghadap kamera, jari terbuka, cahaya terang.
- Tombol panah (kiri bawah, kedua) membalik sisi pod kalau pod muncul di sisi telapak.
- Tombol − / + mengatur ukuran gelang.
- Tombol bulat menyimpan foto dengan resolusi penuh kamera (biasanya 1920×1080).
- Tambahkan `?debug` di URL untuk melihat titik-titik tangan yang terdeteksi.
- Angka penyetelan (FOV kamera, jarak gelang dari pergelangan) ada di bagian atas `source/src/ar-app.js`.
