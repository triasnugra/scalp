# monitorsc
Monitor mesin SCALPING: sc, sctn, sctnv2, sctnv3, sctnv4, scv2, scv5, scv6. Situs: https://triasnugra.github.io/monitorsc/
Versi scalping dari monitortn (swing). Mesin TIDAK diubah; monitor hanya membaca jurnal tiap mesin.

## Pasang
1. Buat repo `monitorsc`, upload semua isi folder ini (GitHub web UI), Settings > Pages > Source: **GitHub Actions**.
2. Repo mesin privat: buat token (read contents) lalu simpan sebagai secret `MONITOR_TOKEN`. Repo publik tidak perlu token.
3. Actions > deploy > Run workflow. Setelah itu berjalan tiap 15 menit.

## Dari mana jurnal dibaca (config.json > engines[].berkas)
| Mesin | Berkas | Catatan |
|---|---|---|
| sc | `data/journal.json` (main) | |
| sctn, sctnv2, sctnv3 | `output/forward_test.json` + `output/signal_log.csv` (main) | signal_log dipakai membaca hash konfigurasi: baris berhash lama = warisan mesin sebelumnya, tidak dihitung |
| sctnv4 | `history.json` di GitHub Pages repo sctnv4 | tidak di-commit oleh workflow mesin, hanya ada di Pages |
| scv2 | `journal.json` di branch `data` (cadangan: Pages `data/journal.json`) | |
| scv5 | `data/journal.jsonl` (main) | rantai hash; monitor memeriksa nomor urut |
| scv6 | `data/journal.json` (main) | hanya 100 hasil terakhir disimpan mesin |
Nama repo/berkas bisa diubah di `config.json`. Urutan sumber: raw GitHub (pakai token) lalu GitHub Pages.

## Cara penilaian
- Hasil = hasil jurnal mesin (tidak dinilai ulang). Hasil dibuat seragam: TP, PARSIAL (TP1 lalu BE/waktu), SL, TIME, TERBUKA, MENUNGGU, TIDAK_TERISI, BATAL.
- R kotor dipulihkan dari R mesin (menambah kembali biaya yang sudah dipotong mesin), lalu dipotong biaya monitor `costPct` (0,2% pulang-pergi) untuk SEMUA mesin. Kolom "R mesin" menunjukkan angka versi mesin sendiri.
- Kualitas data tiap mesin ditampilkan: scv6 dan sctnv4 tidak memodelkan limit tidak terisi, scv6 memakai R tetap (0,9R), sctn* memakai masa order 24 jam dan hold 72 jam.
- Syarat uang sungguhan (angka di config.json, hipotesis): selesai >= 200 trade, >= 8 minggu, CI95 bawah R/trade > 0 (bootstrap per hari, perlu >= 15 hari), PF >= 1,2, pengisian limit dimodelkan.

## Fitur khusus scalping (tidak ada di monitortn)
Corong sinyal (menunggu/tidak terisi/batal/selesai), isi%, durasi posisi (median, P90, peringatan bila > 6 jam), MaxDD dan SL beruntun, kurva ekuitas, uji per setup, sesi (Asia/Eropa/Amerika), lebar stop vs biaya, stabilitas paruh awal vs akhir, kondisi pasar 1H (ATR, EMA), konfirmasi 15m/1H untuk sinyal menunggu, jendela makro pendek (config.makro), zona waktu WIB/UTC.

## Arsip
`site/arsip.json` (dibawa antar build lewat Pages) menyimpan semua baris yang pernah terbaca, supaya riwayat tidak hilang bila mesin memotong jurnalnya (scv6 hanya menyimpan 100 hasil). Jika jurnal live tidak terbaca, monitor memakai arsip dan menandainya. Baris final yang kemudian berubah di sumber memunculkan warning.

## Laporan untuk Claude
Sama seperti monitortn: 3 laporan harian + 1 live, tanggal lapor tersimpan di Firebase (koleksi `laporan`, id berakhiran 0001 agar tidak bentrok dengan monitortn yang berakhiran 0000; firestore.rules lama sudah cocok). Postingan @eliz883: tambahkan ke `data/eliz-posts.json` (format tgl + teks; sudah berisi gabungan semua berkas tambahan monitortn). Kalender makro: `data/events.json` + sinkron otomatis bls.gov/federalreserve.gov (scripts/kalender-sync.mjs).

## Uji lokal
`node --test "test/*.test.mjs"` (offline). Build lokal tanpa jaringan: `NO_NET=1 LOCAL_DIR=<folder berisi repo-main> node scripts/build.mjs` lalu buka `site/index.html` lewat server statis. Folder `test/fixtures` berisi cuplikan jurnal asli; scv2 dan sctnv4 berisi data sintetis berformat sama karena keadaannya tidak ada di zip repo.
