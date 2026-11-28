// adapters.mjs : mengubah jurnal 8 mesin scalping (format berbeda-beda) menjadi SATU bentuk baris kanonik.
// Monitor tidak menilai ulang candle: hasil (TP/SL/dst) tetap hasil jurnal mesin. Yang dilakukan di sini hanya
// menyeragamkan nama field, jenis hasil, waktu (epoch ms UTC), dan memulihkan R KOTOR (sebelum biaya) agar semua
// mesin dibandingkan dengan biaya monitor yang sama.
//
// Hasil kanonik (field `hasil`):
//   TP          target penuh (TP2 / target tunggal) tercapai
//   PARSIAL     TP1 diambil, sisa keluar di BE / waktu (R biasanya kecil positif)
//   SL          stop penuh
//   TIME        time-stop sebelum TP1 (mark-to-market)
//   TERBUKA     sudah terisi, belum selesai (tidak dihitung di statistik)
//   MENUNGGU    limit order belum terisi
//   TIDAK_TERISI  limit kedaluwarsa tanpa terisi
//   BATAL       dibatalkan (mis. TP1 tercapai sebelum entry terisi)
//   DATA_HILANG tidak bisa dinilai
//
// Baris kanonik: { id, mesin, aset, arah, entry, sl, tp, tp2, t, tFill, tx, hasil, Rg, Rm, setup, skor, alasan,
//                  milik, fillAsumsi, zona }
//   Rg = R kotor (sebelum biaya apa pun), Rm = R bersih menurut mesin (null bila mesin tidak memotong biaya).

export const FINAL = new Set(['TP', 'PARSIAL', 'SL', 'TIME']);
export const SEMUA_HASIL = ['TP', 'PARSIAL', 'SL', 'TIME', 'TERBUKA', 'MENUNGGU', 'TIDAK_TERISI', 'BATAL', 'DATA_HILANG'];

const num = x => (x === null || x === undefined || x === '' ? NaN : +x);
const nn = x => (Number.isFinite(x) ? x : null);

export function toMs(x) {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) && x > 0 ? x : null;
  const s = String(x).trim();
  if (/^\d{10,}$/.test(s)) return +s;
  let v = s.replace(' UTC', 'Z');
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d/.test(v)) v = v.replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(v)) v += 'Z';
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
export const aset = s => String(s ?? '').toUpperCase().replace(/[/-]?(USDT|USDC|FDUSD)$/, '').replace('/', '') || null;
const stopPct = (e, s) => (Math.abs(e - s) / e) * 100;

function bangun(mesin, o) {
  const r = {
    id: `${mesin}|${o.id}`, mesin, aset: aset(o.aset), arah: o.arah === 'LONG' || o.arah === 'SHORT' ? o.arah : null,
    entry: num(o.entry), sl: num(o.sl), tp: num(o.tp), tp2: nn(num(o.tp2)), t: o.t ?? null, tFill: o.tFill ?? null, tx: o.tx ?? null,
    hasil: o.hasil, Rg: nn(num(o.Rg)), Rm: nn(num(o.Rm)), setup: o.setup ?? null, skor: nn(num(o.skor)), alasan: o.alasan ?? '',
    milik: o.milik || 'sendiri', fillAsumsi: !!o.fillAsumsi, zona: o.zona ?? null,
  };
  if (!r.aset || !r.arah || !Number.isFinite(r.entry) || !Number.isFinite(r.sl) || !Number.isFinite(r.t) || r.entry <= 0 || r.entry === r.sl) r.salah = true;
  if (FINAL.has(r.hasil) && !Number.isFinite(r.Rg)) r.salah = true;
  return r;
}

// ---------------------------------------------------------------- sc (Node) : data/journal.json = [ {id, aset, arah, entry, sl, tp, hasil, R, waktu, t0, tx ...} ]
function adSc(raw) {
  const M = { TP: 'TP', SL: 'SL', kedaluwarsa: 'TIME', 'tidak terisi': 'TIDAK_TERISI', menunggu: 'MENUNGGU' };
  const rows = (Array.isArray(raw) ? raw : []).map(r => {
    const idT = +String(r.id ?? '').split('|').pop();
    const h = M[r.hasil] ?? 'DATA_HILANG';
    return bangun('sc', {
      id: r.id, aset: r.aset, arah: r.arah, entry: r.entry, sl: r.sl, tp: r.tp, hasil: h,
      t: toMs(r.t0) ?? toMs(r.waktu) ?? (Number.isFinite(idT) ? idT : null), tx: h === 'MENUNGGU' ? null : toMs(r.tx),
      Rg: FINAL.has(h) ? r.R : null, setup: r.setup, skor: r.skor, alasan: r.alasan,
    });
  });
  return { rows, meta: { kualitas: [] } };
}

// ---------------------------------------------------------------- scv2 (Python) : journal.json = [ {id, ts, symbol, side, status, outcome, r, stop_pct, cost_pct ...} ]
function adScv2(raw) {
  const rows = (Array.isArray(raw) ? raw : []).map(r => {
    let h, st = r.status, oc = r.outcome;
    if (st === 'CLOSED') h = { SL: 'SL', TP2: 'TP', TP1_BE: 'PARSIAL', TIME2: 'PARSIAL', TIME: 'TIME' }[oc] ?? 'DATA_HILANG';
    else if (st === 'PENDING') h = 'MENUNGGU';
    else if (st === 'OPEN') h = 'TERBUKA';
    else if (st === 'EXPIRED') h = oc === 'LIMIT_TIDAK_TERISI' ? 'TIDAK_TERISI' : 'DATA_HILANG';
    else if (st === 'CANCELLED') h = 'BATAL';
    else h = 'DATA_HILANG';
    // r scv2 SUDAH bersih biaya dan dibagi (stop% + biaya%). Pulihkan R kotor (satuan stop%): gross% = r*(stop+cost)+cost
    let Rg = null, Rm = null;
    if (st === 'CLOSED' && Number.isFinite(+r.r)) {
      const sp = +r.stop_pct, cp = +r.cost_pct; Rm = +r.r;
      Rg = Number.isFinite(sp) && Number.isFinite(cp) && sp > 0 ? (Rm * (sp + cp) + cp) / sp : null;
    }
    const t = toMs(r.ts);
    return bangun('scv2', {
      id: r.id, aset: r.symbol, arah: String(r.side || '').toUpperCase(), entry: r.entry, sl: r.stop, tp: r.tp1, tp2: r.tp2, t,
      tFill: toMs(r.fill_ts) ?? (r.entry_type === 'MARKET' ? t : null), tx: toMs(r.exit_ts), hasil: h, Rg, Rm,
      setup: [r.trigger, r.tf].filter(Boolean).join(' '), skor: r.score, alasan: r.counter_trend ? 'counter-trend' : '',
    });
  });
  return { rows, meta: { kualitas: [] } };
}

// ---------------------------------------------------------------- scv5 (Python) : data/journal.jsonl, rantai hash. Event: SIGNAL FILL TP1 CLOSE EXPIRE
function adScv5(raw) {
  const recs = (typeof raw === 'string' ? raw.split('\n').filter(l => l.trim()) : []).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sigs = new Map(), kualitas = [];
  let gap = 0, prev = -1;
  for (const r of recs) {
    if (Number.isFinite(r.seq)) { if (prev >= 0 && r.seq !== prev + 1) gap++; prev = r.seq; }
    const d = r.data || {}, t = r.type;
    if (t === 'SIGNAL') { sigs.set(d.id, { s: d, st: 'PENDING' }); continue; }
    const x = sigs.get(d.id); if (!x) continue;
    if (t === 'FILL') { x.st = 'OPEN'; x.fill = d.ts; }
    else if (t === 'TP1') { x.st = 'OPEN_TP1'; x.tp1 = d.ts; }
    else if (t === 'CLOSE') { x.st = 'CLOSED'; x.tx = d.ts; x.reason = d.reason; x.rg = d.r_gross; x.rn = d.r_net; }
    else if (t === 'EXPIRE') { x.st = 'EXPIRED'; x.tx = d.ts; x.reason = d.reason; }
  }
  if (gap) kualitas.push({ lvl: 'merah', t: `Rantai jurnal scv5 punya ${gap} lompatan nomor urut (seq): ada catatan hilang atau jurnal diedit` });
  const rows = [...sigs.values()].map(({ s, st, fill, tp1, tx, reason, rg, rn }) => {
    let h;
    if (st === 'PENDING') h = 'MENUNGGU';
    else if (st === 'OPEN' || st === 'OPEN_TP1') h = 'TERBUKA';
    else if (st === 'CLOSED') h = reason === 'SL' ? 'SL' : reason === 'TP2' ? 'TP' : reason === 'BE' ? 'PARSIAL' : reason === 'TIMEOUT' ? (tp1 ? 'PARSIAL' : 'TIME') : 'DATA_HILANG';
    else h = reason === 'NOT_FILLED' ? 'TIDAK_TERISI' : reason === 'TARGET_FIRST' ? 'BATAL' : 'DATA_HILANG';
    return bangun('scv5', {
      id: s.id, aset: s.symbol, arah: s.direction, entry: s.entry, sl: s.stop, tp: s.tp1, tp2: s.tp2, t: toMs(s.created_ts), tFill: toMs(fill), tx: toMs(tx),
      hasil: h, Rg: st === 'CLOSED' ? rg : null, Rm: st === 'CLOSED' ? rn : null, setup: s.setup, skor: s.score, alasan: (s.reasons || []).join(' '),
    });
  });
  return { rows, meta: { kualitas } };
}

// ---------------------------------------------------------------- scv6 (Node) : data/journal.json = {updatedAt, activeSignals[], closedSignals[]}
function adScv6(raw) {
  const j = raw && typeof raw === 'object' ? raw : {}, kualitas = [];
  const M = { STOPPED_OUT: 'SL', TP1_BE_PROTECTED: 'PARSIAL', TP1_EXPIRED_PROFIT: 'PARSIAL', EXPIRED_NO_FILL: 'TIDAK_TERISI', TP2_FULL_WIN: 'TP' };
  const mk = (r, tutup) => {
    const h = tutup ? (M[r.status] ?? 'DATA_HILANG') : (r.tp1Hit ? 'TERBUKA' : 'MENUNGGU');
    return bangun('scv6', {
      id: r.id, aset: r.symbol, arah: r.direction, entry: (num(r.entryLow) + num(r.entryHigh)) / 2, sl: r.initialStopLoss, tp: r.tp1, tp2: r.tp2,
      t: toMs(r.createdAt), tx: tutup ? toMs(r.closedAt) : null, hasil: h, Rg: FINAL.has(h) ? r.realizedR : null,
      setup: r.setupCode, alasan: r.setupName, fillAsumsi: true, zona: `${r.entryLow}–${r.entryHigh}`,
    });
  };
  const rows = [...(j.closedSignals || []).map(r => mk(r, true)), ...(j.activeSignals || []).map(r => mk(r, false))];
  kualitas.push({ lvl: 'kuning', t: 'scv6 tidak memodelkan pengisian limit (sinyal dianggap terisi di tengah zona saat dibuat), R TP1/BE ditetapkan tetap 0,9R dan TP2 memakai TP1 = 1,5R, waktu hasil = waktu scan (bukan candle), tanpa biaya, dan hanya 100 hasil terakhir disimpan' });
  return { rows, meta: { kualitas, updatedAt: toMs(j.updatedAt), rHardcode: true } };
}

// ---------------------------------------------------------------- sctn, sctnv2, sctnv3 (Python) : output/forward_test.json + output/signal_log.csv (hash konfigurasi)
export function parseCsv(text) {
  const out = []; let f = [], cur = '', q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { f.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; f.push(cur); cur = ''; if (f.length > 1 || f[0] !== '') out.push(f); f = []; }
    else cur += c;
  }
  if (cur !== '' || f.length) { f.push(cur); out.push(f); }
  const h = out.shift() || [];
  return out.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

function adSctn(mesin, raw, ctx) {
  const ft = raw && typeof raw === 'object' ? raw : {}, fee = ctx.feeMesinPct ?? 0.10, kualitas = [];
  const log = ctx.log ? parseCsv(ctx.log).filter(r => String(r.demo ?? '0') !== '1') : null;
  const hashOf = new Map((log || []).map(r => [r.signal_id, { h: r.config_hash, st: r.status, t: toMs(r.asof_utc) }]));
  // hash milik sendiri = hash dengan analisis pertama paling baru (tanpa hardcode); baris berhash lama = warisan
  let own = ctx.hashSendiri || null;
  if (!own && log) {
    const first = new Map();
    for (const [, v] of hashOf) if (v.h && Number.isFinite(v.t)) first.set(v.h, Math.min(first.get(v.h) ?? Infinity, v.t));
    own = [...first.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  } else if (!log) kualitas.push({ lvl: 'kuning', t: `signal_log.csv tidak terbaca: baris warisan dari mesin sebelumnya tidak bisa dipisahkan dari baris milik ${mesin}` });
  const rows = (ft.trades || []).map(r => {
    const e = num(r.entry), s = num(r.stop), sp = stopPct(e, s), info = hashOf.get(r.signal_id), st = r.status, oc = r.outcome;
    let h;
    if (st === 'CLOSED') h = { LOSS: 'SL', TP2: 'TP', TP1_BE: 'PARSIAL', TIMEOUT: 'TIME' }[oc] ?? 'DATA_HILANG';
    else if (st === 'OPEN') h = 'TERBUKA';
    else if (st === 'WAITING') h = 'MENUNGGU';
    else if (st === 'CANCELLED') h = /kedaluwarsa/i.test(r.reason || '') ? 'TIDAK_TERISI' : 'BATAL';
    else h = 'DATA_HILANG';
    const Rm = st === 'CLOSED' ? num(r.r) : null;
    return bangun(mesin, {
      id: r.signal_id, aset: r.symbol, arah: r.direction, entry: e, sl: s, tp: r.tp1, tp2: r.tp2, t: toMs(r.asof), tFill: toMs(r.fill_time), tx: toMs(r.exit_time),
      hasil: h, Rm, Rg: Rm == null || !(sp > 0) ? null : Rm + fee / sp, setup: [r.trigger, r.tf].filter(Boolean).join(' '), skor: r.score,
      milik: !info || !own || info.h === own ? 'sendiri' : 'warisan',
    });
  });
  const w = rows.filter(r => r.milik === 'warisan').length;
  if (w) kualitas.push({ lvl: 'info', t: `${w} baris berhash konfigurasi lama (warisan dari mesin sebelumnya) tidak dihitung sebagai analisis milik ${mesin}` });
  kualitas.push({ lvl: 'info', t: 'Simulasi mesin memakai candle 15m, pending limit berlaku 24 jam dan posisi boleh ditahan sampai 72 jam: lebih panjang daripada scalping umumnya' });
  return { rows, meta: { kualitas, updatedAt: toMs(ft.updated), hashSendiri: own } };
}

// ---------------------------------------------------------------- sctnv4 (Python) : history.json (di GitHub Pages) = {signals:[{id,symbol,direction,trigger,time,entry,stop,tp1,tp2,score,status,r,closed_at}]}
function adSctnv4(raw, ctx) {
  const fee = ctx.feeMesinPct ?? 0.16, arr = Array.isArray(raw?.signals) ? raw.signals : [];
  const M = { SL: 'SL', TP2: 'TP', TP1_BE: 'PARSIAL', TP1_SL: 'PARSIAL', TP1_TIME: 'PARSIAL', TIME: 'TIME', OPEN: 'TERBUKA', TP1_OPEN: 'TERBUKA', INVALID: 'DATA_HILANG' };
  const rows = arr.map(r => {
    const h = M[r.status] ?? 'DATA_HILANG', e = num(r.entry), s = num(r.stop), sp = stopPct(e, s), fin = FINAL.has(h);
    const Rm = fin ? num(r.r) : null;
    return bangun('sctnv4', {
      id: r.id, aset: r.symbol, arah: String(r.direction || '').toUpperCase(), entry: e, sl: s, tp: r.tp1, tp2: r.tp2, t: toMs(r.time), tx: toMs(r.closed_at),
      hasil: h, Rm, Rg: Rm == null || !(sp > 0) ? null : Rm + fee / sp, setup: [r.trigger, r.level_label].filter(Boolean).join(' '), skor: r.score, fillAsumsi: true,
    });
  });
  return { rows, meta: { kualitas: [{ lvl: 'kuning', t: 'sctnv4 menganggap setiap sinyal langsung terisi di harga entry saat dibuat (tidak ada model limit order tidak terisi), sehingga win rate dan R/trade cenderung terlalu optimis' }] } };
}

export const ADAPTERS = {
  sc: (raw) => adSc(raw),
  scv2: (raw) => adScv2(raw),
  scv5: (raw) => adScv5(raw),
  scv6: (raw) => adScv6(raw),
  sctn: (raw, ctx) => adSctn(ctx.mesin, raw, ctx),
  sctnv4: (raw, ctx) => adSctnv4(raw, ctx),
};

// Hasil: { rows (valid), salah (jumlah baris tak valid), meta }
export function normalisasi(engine, raw, extra = {}) {
  const f = ADAPTERS[engine.adapter];
  if (!f) throw new Error(`adapter tidak dikenal: ${engine.adapter}`);
  const res = f(raw, { mesin: engine.id, feeMesinPct: engine.feeMesinPct, hashSendiri: engine.hashSendiri, ...extra });
  const rows = res.rows.filter(r => !r.salah), salah = res.rows.length - rows.length;
  // satu id satu baris (versi terakhir menang)
  const m = new Map(); for (const r of rows) m.set(r.id, r);
  const uniq = [...m.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  return { rows: uniq, salah, duplikat: rows.length - uniq.length, meta: res.meta || { kualitas: [] } };
}
