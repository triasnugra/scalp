// build.mjs : orkestrator monitor scalping. Membaca jurnal tiap mesin -> baris kanonik -> statistik -> situs/ (data.json dll).
// Penilaian = hasil jurnal MESIN (monitor tidak menilai ulang candle). Mesin TIDAK diubah.
import fs from 'node:fs';
import path from 'node:path';
import { normalisasi, FINAL } from './adapters.mjs';
import { stats, tharp, levelStat, kelompok, ekuitas, corong, isFinal, netR, sesiUtc, hariPekan, bucketStop, hariUtc, HARI, MENIT, JAM } from './stats.mjs';
import { ambilBerkas, waktuCommit, riwayat, NO_NET, LOCAL } from './io.mjs';
import { overlay, harga } from './pasar.mjs';
import { macroLayer } from './makro.mjs';
import { syncKalender } from './kalender-sync.mjs';
import { buatLaporan, rekonstruksi, f2 } from './laporan.mjs';

const C = JSON.parse(fs.readFileSync(process.env.CONFIG || 'config.json', 'utf8'));
const NOW = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : Date.now();
const SITE = process.env.SITE_DIR || 'site';
const out = { updated: new Date(NOW).toISOString(), cfg: { minTrades: C.minTrades, minWeeks: C.minWeeks, costPct: C.costPct }, engines: [], warnings: [] };
const W = (lvl, e, t, aksi = null) => out.warnings.push({ lvl, e, t, aksi });
const wibD = ms => new Date(ms + 7 * 36e5).toISOString().slice(0, 10);
const hm = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// ---------------------------------------------------------------- 1. ambil + normalisasi jurnal tiap mesin
const arsipLama = await riwayat(C, 'arsip.json', {});
const arsipBaru = {}, DATA = {};
async function muat(e) {
  const u = await ambilBerkas(C, e, 'utama');
  const raw = e.adapter === 'scv5' ? u.teks : JSON.parse(u.teks);
  let log = null;
  if (LOCAL ? e.lokal?.log : e.berkas?.log) { try { log = (await ambilBerkas(C, e, 'log')).teks; } catch { /* dilaporkan oleh adapter */ } }
  return { u, n: normalisasi(e, raw, { log }) };
}
for (const e of C.engines) {
  let rows = [], meta = { kualitas: [] }, u = null, jenis = 'live', salah = 0, duplikat = 0;
  try { const m = await muat(e); rows = m.n.rows; meta = m.n.meta; u = m.u; salah = m.n.salah; duplikat = m.n.duplikat; }
  catch (x) {
    jenis = 'arsip';
    W(arsipLama[e.id]?.length ? 'merah' : 'merah', e.id, `Jurnal tidak terbaca: ${x.message}${arsipLama[e.id]?.length ? ` (memakai arsip monitor: ${arsipLama[e.id].length} baris)` : ''}`, 'Periksa config.json (repo/berkas), secret MONITOR_TOKEN, atau apakah workflow mesin hidup');
  }
  // arsip: baris yang hilang dari sumber (mesin memotong jurnal) tetap disimpan; baris final yang berubah di sumber dicatat
  const lama = new Map((arsipLama[e.id] || []).map(r => [r.id, r])), ada = new Set(rows.map(r => r.id));
  let berubah = 0, hilang = 0;
  for (const r of rows) { const o = lama.get(r.id); if (o && FINAL.has(o.hasil) && (o.hasil !== r.hasil || Math.abs((o.Rg ?? 0) - (r.Rg ?? 0)) > 1e-6)) berubah++; }
  const gabung = [...rows];
  for (const [id, o] of lama) {
    if (ada.has(id)) continue;
    if (FINAL.has(o.hasil) || ['TIDAK_TERISI', 'BATAL', 'DATA_HILANG'].includes(o.hasil)) gabung.push({ ...o, dariArsip: true });
    else { hilang++; gabung.push({ ...o, hasil: 'DATA_HILANG', Rg: null, tx: null, dariArsip: true }); }
  }
  gabung.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  arsipBaru[e.id] = gabung.map(({ dariArsip, ...r }) => r);
  DATA[e.id] = { e, rows: gabung, meta, u, jenis, salah, duplikat, berubah, hilang, dariArsip: gabung.filter(r => r.dariArsip).length };
}

// ---------------------------------------------------------------- 2. statistik per mesin
const startMs = e => (e.start ? Date.parse(e.start) : 0);
const milik = {};
for (const e of C.engines) milik[e.id] = DATA[e.id].rows.filter(r => r.milik === 'sendiri' && r.t >= startMs(e));
const pertama = C.engines.map(e => milik[e.id][0]?.t).filter(Number.isFinite);
const commonMs = C.commonStart ? Date.parse(C.commonStart) : (pertama.length ? Math.max(...pertama) : 0);
out.commonStart = Number.isFinite(commonMs) && commonMs > 0 ? hariUtc(commonMs) : '-';
const RES = {}, ALL = [], ENG = {}, tujuhHari = NOW - 7 * HARI, assetList = new Set();

for (const e of C.engines) {
  const D = DATA[e.id], rows = milik[e.id], warisan = D.rows.filter(r => r.milik === 'warisan').length;
  ENG[e.id] = rows;
  const rk = {}; for (const r of rows) { const d = hariUtc(r.t); r.rk = rk[d] = (rk[d] || 0) + 1; }
  for (const r of rows) {
    const n = isFinal(r) ? netR(r, C.costPct) : null;
    ALL.push({ e: e.id, t: r.t, d: hariUtc(r.t), a: r.aset, arah: r.arah, h: r.hasil, R: n, rk: r.rk });
    RES[`${e.id}|${r.aset}|${r.t}|${r.arah}`] = { h: r.hasil, R: n };
  }
  const fin = rows.filter(isFinal), st = stats(rows, C), sc = stats(rows.filter(r => r.t >= commonMs), C, { boot: false }), s7 = stats(rows.filter(r => r.t >= tujuhHari), C, { boot: false });
  const dir = { LONG: stats(rows.filter(r => r.arah === 'LONG'), C, { boot: false }), SHORT: stats(rows.filter(r => r.arah === 'SHORT'), C, { boot: false }) };
  const fillAs = rows.length ? rows.filter(r => r.fillAsumsi).length / rows.length : 0;
  const ready = [[st.terisi >= C.minTrades, `Trade selesai ${st.terisi}/${C.minTrades}`], [st.minggu >= C.minWeeks, `Minggu ${st.minggu}/${C.minWeeks}`],
    [!!st.ci && st.ci[0] > 0, 'CI95 bawah R/trade > 0 (bootstrap per hari, perlu >= 15 hari)'], [st.pf != null && st.pf >= 1.2, 'Profit factor >= 1,2'],
    [fillAs <= 0.2, 'Pengisian limit dimodelkan (bukan asumsi langsung terisi)']];
  // pending: MENUNGGU (belum terisi) dan TERBUKA, duplikat (koin, arah, entry sama) hanya yang terbaru
  const pend = (() => { const s = new Set(); return rows.filter(r => r.hasil === 'MENUNGGU' || r.hasil === 'TERBUKA').reverse().filter(r => { const k = r.hasil + r.aset + r.arah + r.entry; if (s.has(k)) return false; s.add(k); return true; }).reverse(); })();
  const dupN = rows.filter(r => r.hasil === 'MENUNGGU' || r.hasil === 'TERBUKA').length - pend.length;
  pend.forEach(r => assetList.add(r.aset));
  out.engines.push({
    id: e.id, nama: e.nama, repo: e.repo, adapter: e.adapter, start: e.start || null, kualitas: D.meta.kualitas || [], warisan, dupPending: dupN,
    sumber: { jenis: D.jenis, url: D.u?.sumber || null, baris: D.rows.length, dariArsip: D.dariArsip, salah: D.salah, duplikat: D.duplikat, umurJam: null },
    tharp: tharp(fin, C), level: levelStat(fin, C), all: st, sejakBersama: sc, tujuhHari: s7, dir, corong: corong(rows), ready, layak: ready.every(x => x[0]), fillAsumsi: fillAs,
    setup: kelompok(rows, C, r => r.setup || '-'), sesi: kelompok(rows, C, r => sesiUtc(r.t)), equity: ekuitas(fin, C),
    jurnal: [...rows].reverse().slice(0, C.jurnalMaks || 2000).map(r => ({ t: r.t, a: r.aset, d: r.arah, en: r.entry, sl: r.sl, tp: r.tp, tp2: r.tp2, h: r.hasil, Rg: r.Rg, Rn: isFinal(r) ? netR(r, C.costPct) : null, Rm: r.Rm, tf: r.tFill, tx: r.tx, set: r.setup, sk: r.skor, al: r.alasan, fa: r.fillAsumsi ? 1 : 0, zona: r.zona, ar: r.dariArsip ? 1 : 0 })),
    pending: pend.map(r => ({ a: r.aset, d: r.arah, en: r.entry, sl: r.sl, tp: r.tp, st: r.hasil, t: r.t, w: hariUtc(r.t), rk: r.rk, zona: r.zona, umur: (NOW - r.t) / MENIT, zombie: r.hasil === 'MENUNGGU' && e.kadaluwarsaMenit ? (NOW - r.t) / MENIT > 2 * e.kadaluwarsaMenit : false })),
  });
  D.stats = st; D.dir = dir; D.fin = fin; D.warisan = warisan; D.pend = pend;
}

// harga Binance untuk koin yang punya sinyal menunggu/terbuka
{ const A = [...assetList]; for (let i = 0; i < A.length; i += 8) await Promise.all(A.slice(i, i + 8).map(harga)); }
for (const E of out.engines) for (const r of E.pending) { const p = await harga(r.a); r.px = p; r.dist = p ? (p - +r.en) / +r.en * 100 : null; }

// ---------------------------------------------------------------- 3. warning per mesin
for (const E of out.engines) {
  const D = DATA[E.id], e = D.e, st = E.all, rows = milik[E.id];
  if (!rows.length) { W('merah', E.id, `Tidak ada baris jurnal milik ${e.nama}`, 'Periksa config.json (adapter, repo, start)'); continue; }
  for (const k of E.kualitas) W(k.lvl, E.id, k.t, null);
  if (E.warisan) W('info', E.id, `${E.warisan} baris warisan dari mesin lain dikeluarkan dari statistik`, null);
  if (D.berubah) W('kuning', E.id, `${D.berubah} baris yang sudah final di arsip monitor kini berhasil/hasil berbeda di sumber: mesin menulis ulang riwayat?`, 'Bandingkan jurnal mesin dengan site/arsip.json');
  if (D.hilang) W('info', E.id, `${D.hilang} sinyal belum selesai di arsip menghilang dari jurnal mesin (jurnal dipotong): ditandai DATA_HILANG`, null);
  if (D.dariArsip) W('info', E.id, `${D.dariArsip} baris hanya ada di arsip monitor (sudah tidak ada di jurnal mesin, mis. jurnal dipotong)`, null);
  if (E.dupPending > 0) W('info', E.id, `${E.dupPending} sinyal menunggu duplikat (koin, arah, entry sama dengan yang lebih baru) disembunyikan`, null);
  const zb = E.pending.filter(r => r.zombie).length;
  if (zb) W('kuning', E.id, `${zb} sinyal masih MENUNGGU melewati 2x masa order mesin (${e.kadaluwarsaMenit} menit): jurnal mesin tertinggal atau workflow berhenti`, 'Buka tab Actions di repo mesin');
  if (st.sinyalPerHari > (C.maxSinyalPerHari || 10)) W('kuning', E.id, `Overtrading: ${st.sinyalPerHari.toFixed(0)} sinyal/hari. @eliz883: tidak harus trading tiap hari`, 'Tambah batas harian dan skor minimum');
  if (st.terisi < 30) W('info', E.id, `Sampel kecil (${st.terisi} trade selesai): hasil belum bermakna`, 'Tunggu data; jangan ubah mesin');
  const t = E.tharp;
  if (t.ok && t.n >= 30) {
    if (t.be <= 0) W('kuning', E.id, `Tidak ada edge sebelum biaya: R kotor rata-rata <= 0 (biaya impas ${t.be.toFixed(2)}%). Biaya sekecil apa pun hanya memperburuk`, 'Jangan optimalkan biaya; periksa logika entri/keluar lewat analisis out-of-sample');
    else if (t.be < C.costPct * 1.5) W('kuning', E.id, `Edge tipis terhadap biaya: biaya impas ${t.be.toFixed(2)}% vs asumsi ${C.costPct}%. Selisih biaya/slippage kecil dapat menghapus profit`, 'Uji biaya nyata di Binance (fee tier, slippage) sebelum uang sungguhan');
    if (t.top3 != null && t.top3 > 0.5) W('kuning', E.id, `Hasil terkonsentrasi: 3 trade teratas = ${(t.top3 * 100).toFixed(0)}% dari total untung`, 'Tanpa 3 trade itu R/trade = ' + f2(t.meanEx3));
  }
  const L = E.dir.LONG, S = E.dir.SHORT;
  if (L.terisi >= 15 && S.terisi >= 15 && ((L.netR ?? 0) < 0 !== (S.netR ?? 0) < 0) && Math.abs((L.netR ?? 0) - (S.netR ?? 0)) > 0.3) W('kuning', E.id, `Hasil bertumpu pada satu arah: LONG ${f2(L.netR)}R (n=${L.terisi}) vs SHORT ${f2(S.netR)}R (n=${S.terisi}). Kemungkinan bergantung rezim pasar`, 'Uji lintas rezim sebelum memakai satu arah saja');
  const nonMenunggu = st.terisi + st.terbuka + st.tdkIsi + st.batal;
  if (nonMenunggu >= 10 && st.tdkIsi / nonMenunggu > 0.3) W('kuning', E.id, `${(100 * st.tdkIsi / nonMenunggu).toFixed(0)}% sinyal tidak terisi: entry limit terlalu jauh / masa order terlalu singkat`, 'Batasi jarak entry ke harga');
  if (nonMenunggu >= 10 && st.batal / nonMenunggu > 0.4) W('kuning', E.id, `${(100 * st.batal / nonMenunggu).toFixed(0)}% sinyal dibatalkan karena target tercapai sebelum entry terisi: entry terlalu dalam di pullback`, null);
  if (st.holdMed != null && st.holdMed > (C.maksHoldJam || 6) * 60) W('kuning', E.id, `Durasi posisi median ${(st.holdMed / 60).toFixed(1)} jam (> ${C.maksHoldJam || 6} jam): lebih mirip day/swing trade daripada scalping`, 'Cek time-stop mesin');
  if (st.streakSL >= (C.streakSL || 5)) W('kuning', E.id, `${st.streakSL} stop loss beruntun saat ini (terpanjang ${st.maxStreakSL})`, 'Jangan ubah parameter karena rentetan; cek rezim pasar dan biaya');
  if (st.paruh && st.paruh[2] >= 15 && st.paruh[3] >= 15 && st.paruh[0] > 0 && st.paruh[1] < 0) W('kuning', E.id, `Edge memburuk: R/trade paruh awal ${f2(st.paruh[0])} (n=${st.paruh[2]}) -> paruh akhir ${f2(st.paruh[1])} (n=${st.paruh[3]})`, 'Tanda rezim berubah atau edge awal hanya kebetulan');
  if (st.minggu < 6) W('info', E.id, `Hanya ${st.minggu} minggu data`, 'Syarat minggu tetap penentu kelayakan');
}
// kesegaran data (berumur sumber): pakai waktu pembaruan di jurnal / Last-Modified / commit GitHub / baris terakhir
for (const E of out.engines) {
  const D = DATA[E.id], rows = milik[E.id]; if (!rows.length || D.jenis === 'arsip') continue;
  const lastRow = Math.max(...D.rows.filter(r => !r.dariArsip).map(r => r.tx ?? r.t));
  let cm = D.meta.updatedAt ?? D.u?.lastModified ?? null; if (cm == null && D.u) cm = await waktuCommit(C, D.e, D.u);
  const umur = cm != null ? Math.max(0, (NOW - cm) / JAM) : null, umurRow = Math.max(0, (NOW - lastRow) / JAM);
  E.sumber.umurJam = umur; E.sumber.umurBarisJam = umurRow;
  const batas = C.jamBasi || 12;
  if (umurRow > batas && (umur == null || umur > batas)) W('kuning', E.id, `Baris jurnal terakhir ${umurRow.toFixed(0)} jam lalu` + (umur == null ? ' (waktu pembaruan sumber tidak terbaca)' : `, pembaruan sumber ${umur.toFixed(0)} jam lalu`) + '. Bisa berarti memang tidak ada sinyal, bukan workflow mati', 'Buka tab Actions di repo mesin sekali untuk memastikan');
  else if (umurRow > batas) W('info', E.id, `Tidak ada baris jurnal baru ${umurRow.toFixed(0)} jam, tetapi sumber diperbarui ${umur.toFixed(0)} jam lalu: workflow tampak hidup (mesin selektif)`, null);
}
for (const E of out.engines) if (!E.layak && E.all.sinyal) W('merah', E.id, 'BELUM LAYAK uang sungguhan: ' + E.ready.filter(x => !x[0]).map(x => x[1]).join('; '), 'Jika tetap trading, risiko maks 0,25% per trade dan hitung biaya nyata');
W('kuning', 'monitor', 'Penilaian monitor memakai hasil jurnal tiap mesin; R kotor dipulihkan dari R mesin lalu dipotong biaya monitor yang sama untuk semua mesin. Aturan pengisian/time-stop tiap mesin berbeda, jadi perbandingan antar mesin belum apel-ke-apel', 'Baca kolom "Kualitas data" dan "R mesin" sebelum membandingkan');

// ---------------------------------------------------------------- 4. uji gabungan (hipotesis)
const finAll = C.engines.flatMap(e => milik[e.id].filter(isFinal));
out.ujiSesi = kelompok(finAll, C, r => sesiUtc(r.t));
out.ujiStop = kelompok(finAll, C, bucketStop);
out.ujiAkhirPekan = kelompok(finAll, C, r => hariPekan(r.t));
out.ujiSetup = kelompok(finAll, C, r => `${r.mesin}: ${r.setup || '-'}`);

// ---------------------------------------------------------------- 5. @eliz883
let EZ = []; try { EZ = JSON.parse(fs.readFileSync('data/eliz-posts.json', 'utf8')); } catch { /* kosong */ }
const tick = new Set(); EZ.slice(-30).forEach(p => [...p.teks.matchAll(/\$([A-Z]{2,10})/g)].forEach(m => tick.add(m[1])));
out.eliz = { posts: EZ.slice(-10).reverse(), tickers: [...tick], lastPost: EZ.at(-1)?.tgl || null,
  cocok: [...tick].map(t => ({ t, sinyal: out.engines.map(E => ({ e: E.id, n: E.jurnal.slice(0, 200).filter(r => r.a === t).slice(0, 3).map(r => `${r.d} ${hm(r.t).slice(5, 10)} ${r.h}`) })) })) };
if (!EZ.length) W('kuning', 'eliz', 'data/eliz-posts.json kosong', 'Tambahkan postingan terbaru @eliz883');
else if ((NOW - new Date(EZ.at(-1).tgl)) / HARI > 3) W('kuning', 'eliz', `Postingan @eliz883 terakhir di monitor sudah ${((NOW - new Date(EZ.at(-1).tgl)) / HARI).toFixed(0)} hari`, 'Perbarui data/eliz-posts.json');

// ---------------------------------------------------------------- 6. pasar + makro
fs.mkdirSync(SITE, { recursive: true });
const overlayMd = await overlay(out, C, RES, ALL, NOW);
const SYNC = await syncKalender({ cfg: C.makro?.sinkron, now: NOW, cacheUrl: `https://${C.owner}.github.io/${C.situs}/kalender-auto.json`, local: (!!LOCAL || NO_NET) && process.env.FORCE_SYNC !== '1' });
if (SYNC.simpan) fs.writeFileSync(path.join(SITE, 'kalender-auto.json'), JSON.stringify(SYNC.simpan));
const EVM = macroLayer({ cfg: C.makro, now: NOW, auto: SYNC, trades: ALL.filter(x => x.R != null).map(x => ({ t: x.t, r: x.R, tp: x.h === 'TP' })) });
out.makro = EVM.makro; { const o = { merah: 0, kuning: 1, info: 2 }; out.warnings.unshift(...EVM.warnings.sort((a, b) => o[a.lvl] - o[b.lvl])); }

// ---------------------------------------------------------------- 7. laporan untuk Claude (4 kolom: 3 harian + live)
const md = buatLaporan(out, C, { overlayMd, makroMd: EVM.md });
out.laporan = md;
let LG = await riwayat(C, 'laporan-log.json', []);
if (process.env.LOG_IN) LG = JSON.parse(fs.readFileSync(process.env.LOG_IN, 'utf8'));
const hari = wibD(NOW), sufiks = C.laporanSufiks || '0001';   // sufiks 0001: tidak bentrok dengan id laporan monitortn (0000) di Firestore yang sama
LG = LG.map(x => (x.d ? x : { ...x, d: wibD(Date.parse(x.t)) }));
for (const k of [3, 2, 1]) { const d = new Date(Date.parse(hari) - k * HARI).toISOString().slice(0, 10); if (!LG.some(x => x.d === d)) LG.push({ id: d.replace(/-/g, '') + sufiks, d, t: out.updated, md: rekonstruksi(d, ENG, C, EZ, out.updated.slice(0, 10)), rekon: true }); }
let cur = LG.find(x => x.d === hari);
if (cur) { cur.t = out.updated; cur.md = md; } else { cur = { id: hari.replace(/-/g, '') + sufiks, d: hari, t: out.updated, md }; LG.push(cur); }
out.hariIni = hari; out.hariId = cur.id;
const batas = new Date(Date.parse(hari) - 4 * HARI).toISOString().slice(0, 10);
LG = LG.filter(x => x.d >= batas).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
out.log = LG.map(x => (x.d === hari ? { ...x, md: '' } : x));

// ---------------------------------------------------------------- 8. tulis situs
fs.writeFileSync(path.join(SITE, 'laporan-log.json'), JSON.stringify(LG));
for (const [n, v] of Object.entries(out.simpan || {})) fs.writeFileSync(path.join(SITE, n), JSON.stringify(v));
fs.writeFileSync(path.join(SITE, 'arsip.json'), JSON.stringify(arsipBaru));
delete out.simpan;
fs.copyFileSync('index.html', path.join(SITE, 'index.html'));
if (fs.existsSync('vendor')) fs.cpSync('vendor', path.join(SITE, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(SITE, 'data.json'), JSON.stringify(out));
fs.writeFileSync(path.join(SITE, 'laporan.md'), md);
console.log('OK', out.engines.length, 'mesin,', out.warnings.length, 'warning,', Object.values(DATA).reduce((a, d) => a + d.rows.length, 0), 'baris');
