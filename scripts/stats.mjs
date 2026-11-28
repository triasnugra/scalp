// stats.mjs : semua perhitungan statistik monitor scalping. Murni (tanpa jaringan), mudah diuji.
// Semua R "bersih" di sini = R kotor (Rg) dikurangi biaya monitor (costPct, % pulang-pergi) / jarak stop (%).
import { FINAL } from './adapters.mjs';

export const HARI = 864e5, JAM = 36e5, MENIT = 6e4;
export const isFinal = r => FINAL.has(r.hasil) && Number.isFinite(r.Rg);
export const sum = a => a.reduce((x, y) => x + y, 0);
export const mean = a => (a.length ? sum(a) / a.length : null);
export const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };
export const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const riskPct = r => (Math.abs(r.entry - r.sl) / r.entry) * 100;
export const netR = (r, costPct) => r.Rg - costPct / riskPct(r);
export const hariUtc = ms => new Date(ms).toISOString().slice(0, 10);

// Pembangkit acak deterministik (mulberry32): laporan yang sama menghasilkan CI yang sama.
export function rng(seed = 20261128) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

export function isoWeek(ms) {
  const d = new Date(ms), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return t.getUTCFullYear() + '-' + String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / HARI + 1) / 7)).padStart(2, '0');
}

// Bootstrap klaster per HARI (trade pada hari yang sama tidak independen). CI95 rata-rata R/trade.
export function bootstrapHari(items, iters = 2000, minHari = 15) {
  const g = new Map();
  for (const x of items) { const k = hariUtc(x.t); (g.get(k) ?? g.set(k, []).get(k)).push(x.n); }
  const v = [...g.values()];
  if (v.length < minHari) return null;
  const rnd = rng(), b = [];
  for (let i = 0; i < iters; i++) { let s = 0, c = 0; for (let j = 0; j < v.length; j++) { const x = v[Math.floor(rnd() * v.length)]; s += sum(x); c += x.length; } b.push(s / c); }
  b.sort((a, c) => a - c);
  return [b[Math.floor(iters * 0.025)], b[Math.floor(iters * 0.975)]];
}

// Urutan kronologis hasil (waktu keluar; bila tak ada pakai waktu sinyal).
export const urutKeluar = rows => [...rows].sort((a, b) => (a.tx ?? a.t) - (b.tx ?? b.t) || a.t - b.t);

export function drawdown(nets) {
  let eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const x of nets) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); if (x < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0; }
  let cur = 0; for (let i = nets.length - 1; i >= 0 && nets[i] < 0; i--) cur++;
  return { dd, maxStreak, curStreak: cur };
}

// Statistik inti satu kumpulan baris (baris milik satu mesin, semua status).
export function stats(rows, C, { boot = true } = {}) {
  const f = urutKeluar(rows.filter(isFinal)), cost = C.costPct;
  const n = f.map(r => netR(r, cost)), nr = f.map((r, i) => ({ t: r.t, n: n[i] }));
  const cnt = h => rows.filter(r => r.hasil === h).length;
  const tp = cnt('TP'), sl = cnt('SL'), parsial = cnt('PARSIAL'), time = cnt('TIME'), terbuka = cnt('TERBUKA'), menunggu = cnt('MENUNGGU'), tdkIsi = cnt('TIDAK_TERISI'), batal = cnt('BATAL');
  const win = n.filter(x => x > 0).length, gp = sum(n.filter(x => x > 0)), gl = -sum(n.filter(x => x < 0));
  const wk = new Set(f.map(r => isoWeek(r.t))), hariAll = new Set(rows.map(r => hariUtc(r.t)));
  const hold = f.map(r => (r.tx - (r.tFill ?? r.t)) / MENIT).filter(x => Number.isFinite(x) && x >= 0);
  const selesaiEntri = f.length + terbuka + tdkIsi + batal, dd = drawdown(n), h = Math.floor(n.length / 2);
  return {
    sinyal: rows.length, terisi: f.length, tp, sl, parsial, time, terbuka, menunggu, tdkIsi, batal,
    isiPct: selesaiEntri ? (f.length + terbuka) / selesaiEntri : null,
    win: f.length ? win / f.length : null, winCI: wilson(win, f.length), tpRate: f.length ? tp / f.length : null,
    netR: f.length ? mean(n) : null, totalR: sum(n), pf: gl > 0 ? gp / gl : null,
    rKotor: f.length ? mean(f.map(r => r.Rg)) : null, rMesin: (() => { const m = f.filter(r => Number.isFinite(r.Rm)); return m.length === f.length && f.length ? mean(m.map(r => r.Rm)) : null; })(),
    minggu: wk.size, hari: hariAll.size, sinyalPerHari: hariAll.size ? rows.length / hariAll.size : 0,
    ci: boot && f.length ? bootstrapHari(nr) : null, dd: dd.dd, maxStreakSL: dd.maxStreak, streakSL: dd.curStreak,
    holdMed: med(hold), holdP90: hold.length ? [...hold].sort((a, b) => a - b)[Math.floor(hold.length * 0.9)] : null,
    holdLebih: hold.length ? hold.filter(x => x > (C.maksHoldJam ?? 6) * 60).length / hold.length : null,
    paruh: f.length >= 10 ? [mean(n.slice(0, h)), mean(n.slice(h)), h, n.length - h] : null,
  };
}

// Pengelompokan ringkas (per setup, sesi, dst).
export function kelompok(rows, C, keyFn, minN = 1) {
  const g = new Map();
  for (const r of rows.filter(isFinal)) { const k = keyFn(r); if (k == null) continue; (g.get(k) ?? g.set(k, []).get(k)).push(r); }
  return [...g.entries()].map(([k, v]) => {
    const n = v.map(r => netR(r, C.costPct)), w = n.filter(x => x > 0).length, gp = sum(n.filter(x => x > 0)), gl = -sum(n.filter(x => x < 0)), s = sd(n);
    return { g: k, n: v.length, tp: v.filter(r => r.hasil === 'TP').length, sl: v.filter(r => r.hasil === 'SL').length, win: w / v.length, r: mean(n), pf: gl > 0 ? gp / gl : null, se: s == null ? null : s / Math.sqrt(v.length), total: sum(n) };
  }).filter(x => x.n >= minN).sort((a, b) => b.n - a.n);
}

export const sesiUtc = ms => { const h = new Date(ms).getUTCHours(); return h < 7 ? 'Asia (00-07 UTC)' : h < 13 ? 'Eropa (07-13 UTC)' : h < 21 ? 'Amerika (13-21 UTC)' : 'Malam (21-24 UTC)'; };
export const hariPekan = ms => { const w = new Date(ms).getUTCDay(); return w === 0 || w === 6 ? 'akhir pekan (Sab/Min UTC)' : 'hari kerja'; };
export const bucketStop = r => { const s = riskPct(r); return s < 0.4 ? 'stop < 0,4%' : s < 0.7 ? 'stop 0,4-0,7%' : s < 1.2 ? 'stop 0,7-1,2%' : 'stop >= 1,2%'; };

// Uji ala Van Tharp: SQN, sensitivitas biaya, distribusi R, konsentrasi trade teratas.
export function tharp(f, C) {
  const n = f.length; if (n < 2) return { n, ok: false };
  const g = f.map(r => r.Rg), risk = f.map(r => riskPct(r) / 100);
  const net = c => g.map((x, i) => x - (c / 100) / risk[i]);
  const nr = net(C.costPct), m = mean(nr), s = sd(nr), sqn = s > 0 ? Math.sqrt(n) * m / s : null;
  const be = mean(g) / mean(risk.map(x => 1 / x)) * 100;
  const edges = [['<= -1,1', x => x <= -1.1], ['-1,1 s/d -0,5', x => x > -1.1 && x <= -0.5], ['-0,5 s/d +0,5', x => x > -0.5 && x < 0.5], ['+0,5 s/d +1,5', x => x >= 0.5 && x < 1.5], ['+1,5 s/d +2,5', x => x >= 1.5 && x <= 2.5], ['> +2,5', x => x > 2.5]];
  const srt = [...nr].sort((a, b) => b - a), pos = sum(srt.filter(x => x > 0)), top3 = sum(srt.slice(0, 3).filter(x => x > 0));
  const cls = sqn == null ? '-' : sqn < 1.6 ? 'buruk' : sqn < 2 ? 'di bawah rata-rata' : sqn < 2.5 ? 'rata-rata' : sqn < 3 ? 'bagus' : 'sangat bagus';
  return { ok: true, n, mean: m, sd: s, sqn, sqn100: s > 0 ? Math.sqrt(Math.min(n, 100)) * m / s : null, cls, be,
    biaya: [0, 0.1, 0.15, 0.2, 0.3, 0.5].map(c => ({ c, r: mean(net(c)) })), dist: edges.map(([l, fn]) => ({ l, n: g.filter(fn).length })),
    top3: pos > 0 ? top3 / pos : null, meanEx3: n > 3 ? mean(srt.slice(3)) : null };
}

// Level unik: sinyal berulang (koin, arah, entry, SL, TP sama) dihitung SATU trade independen.
export function levelStat(f, C) {
  const n = f.length, g = new Map();
  for (const r of f) { const k = [r.aset, r.arah, r.entry, r.sl, r.tp].join('|'); (g.get(k) ?? g.set(k, []).get(k)).push(r); }
  const L = [...g.values()], u = L.length; if (!u) return { ok: false, n, u: 0 };
  const lv = L.map(v => mean(v.map(r => netR(r, C.costPct)))), m = mean(lv), s = u > 1 ? sd(lv) : null;
  const big = L.reduce((a, v) => (v.length > a.n ? { n: v.length, a: v[0].aset, d: v[0].arah } : a), { n: 0 });
  return { ok: true, n, u, dup: n - u, neff: n * n / sum(L.map(v => v.length ** 2)), mean: m, sd: s, sqn: s > 0 ? Math.sqrt(u) * m / s : null,
    tp: L.filter(v => v[0].hasil === 'TP').length, sl: L.filter(v => v[0].hasil === 'SL').length, big };
}

// Kurva ekuitas (kumulatif R bersih) dikurangi menjadi maksimal `maks` titik untuk grafik kecil.
export function ekuitas(f, C, maks = 160) {
  const pts = []; let eq = 0;
  for (const r of urutKeluar(f)) { eq += netR(r, C.costPct); pts.push([r.tx ?? r.t, +eq.toFixed(3)]); }
  if (pts.length <= maks) return pts;
  const out = [], step = (pts.length - 1) / (maks - 1);
  for (let i = 0; i < maks; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

// Corong sinyal: dari sinyal sampai hasil akhir.
export function corong(rows) {
  const c = h => rows.filter(r => r.hasil === h).length;
  return { sinyal: rows.length, menunggu: c('MENUNGGU'), tdkIsi: c('TIDAK_TERISI'), batal: c('BATAL'), terbuka: c('TERBUKA'), selesai: rows.filter(isFinal).length, hilang: c('DATA_HILANG') };
}
