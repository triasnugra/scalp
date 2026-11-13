# Scalp Engine

Mesin analisis scalping crypto (Binance spot USDT) berbasis metode Eliz, dengan gerbang dan skor ala tnv2c2. Tanpa dependensi (Node 20+).

## Deploy ke GitHub Pages
1. Buat repo baru, upload seluruh isi folder ini ke branch `main`.
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Actions > General > Workflow permissions: **Read and write permissions**.
4. Tab Actions > scalp-engine > Run workflow. Selanjutnya berjalan otomatis tiap jam.

## Alur
1H dipindai pada top 40 koin (volume >= $30 juta): deviasi/double deviation, breakout-retest, sapuan Monday, pullback Fib 0,70-0,79 (4H), divergensi OBV 4H.
Gerbang: tren 1D (lawan tren butuh >= 2 konfirmasi), filter mid-range, konfirmasi candle, SL 0,6-4% (min 1x ATR), RR >= 2,5, usang, gerbang BTC (fail closed), agenda makro.
Skor 0-100 (min 60; A >= 75). Maks 5 sinyal/jam, 3 per sisi, cooldown 6 jam setelah SL.
Tabel Riwayat menampilkan waktu analisis dan waktu hasil (kapan hasil final terjadi; field `tx` di jurnal, sinyal lama tanpa `tx` tampil `-`).
Hasil disimulasikan di `data/journal.json`: limit terisi <= 12 bar, 60% di TP1 (1,5R) lalu SL ke BE, sisa ke TP2, biaya 0,1%, bar yang sama dihitung SL.

## Pengaturan
`config.json` menimpa nilai di `lib/engine.mjs`. Isi `events` dengan jadwal FOMC/CPI: `{"events":[{"t":"2026-12-09T19:00:00Z","n":"FOMC"}]}` (sinyal diblokir +-2 jam). Verifikasi tanggal dari sumber resmi.

## Batasan
Parameter adalah hipotesis, belum divalidasi. Heatmap dan order book tidak dipakai (tidak ada data resmi gratis yang stabil dari runner GitHub). Bukan saran finansial.
