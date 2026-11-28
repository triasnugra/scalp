// pasar.mjs : lapisan keputusan monitor untuk SCALPING. TIDAK mengubah mesin. Semua ambang adalah HIPOTESIS (config.pasar)
// dan diuji lewat audit; jangan dijadikan aturan sebelum puluhan trade per grup.
import fs from 'node:fs';
import { http, httpJson, NO_NET, riwayat } from './io.mjs';
import { isFinal, med, hariUtc, HARI } from './stats.mjs';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'EUR', 'USD1', 'PYUSD', 'USDE', 'BUSD', 'USDS', 'USDT']);
export const TH_DEF = { volRendah: 0.9, atrMati1h: 0.25, atrEkstrem1h: 1.5, trendTipis1h: 0.15, maxJarakPct: 1.5, minKoin: 15 };

async function bj(p) {
  let e; for (const h of HOSTS) { try { return await httpJson(h + '/api/v3/' + p, { timeout: 12000 }); } catch (x) { e = x; if (NO_NET) break; } }
  throw e;
}
const kl = async (s, iv, n) => (await bj(`klines?symbol=${s}&interval=${iv}&limit=${n}`)).map(a => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] }));
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map(v => (e = v * k + e * (1 - k))); };

const px = {};
export async function harga(a) {
  if (a in px) return px[a];
  try { px[a] = +(await bj(`ticker/price?symbol=${a}USDT`)).price; } catch { px[a] = null; }
  return Number.isFinite(px[a]) ? px[a] : (px[a] = null);
}

// Volume altcoin: per koin rata-rata 7 hari / MEDIAN 60 hari sebelumnya, lalu median lintas 30 koin (tesis volume @eliz883).
async function top30() {
  return (await bj('ticker/24hr')).filter(x => x.symbol.endsWith('USDT') && !STABLE.has(x.symbol.slice(0, -4))).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 30);
}
async function breadth(TH) {
  const t = await top30(), rs = [];
  for (let i = 0; i < t.length; i += 6) await Promise.all(t.slice(i, i + 6).map(async x => {
    try { const k = (await kl(x.symbol, '1d', 67)).slice(0, -1), qv = k.map(q => q.v * q.c), base = med(qv.slice(0, -7)), l7 = qv.slice(-7).reduce((a, b) => a + b, 0) / 7; if (base > 0) rs.push(l7 / base); } catch { /* koin dilewati */ }
  }));
  return { n: rs.length, med: rs.length >= TH.minKoin ? med(rs) : null };
}
async function volBackfill(TH, days = 21) {
  const t = await top30(), S = [];
  for (let i = 0; i < t.length; i += 6) await Promise.all(t.slice(i, i + 6).map(async x => { try { S.push(await kl(x.symbol, '1d', 100)); } catch { /* lewati */ } }));
  const res = [], t0 = Date.parse(new Date().toISOString().slice(0, 10));
  for (let b = 1; b <= days; b++) {
    const D = t0 - b * HARI, rs = [];
    for (const k of S) { const c = k.filter(q => q.t < D).slice(-66); if (c.length < 66) continue; const qv = c.map(q => q.v * q.c), base = med(qv.slice(0, -7)), l7 = qv.slice(-7).reduce((a, x) => a + x, 0) / 7; if (base > 0) rs.push(l7 / base); }
    if (rs.length >= TH.minKoin) res.push({ d: new Date(D).toISOString().slice(0, 10), vr: med(rs) });
  }
  return res;
}

// Kondisi pasar untuk scalping: volume altcoin (harian) + struktur BTC 1 jam.
async function regime(TH) {
  const k1 = (await kl('BTCUSDT', '1h', 120)).slice(0, -1), c = k1.map(q => q.c), n = k1.length, p = c[n - 1];
  const e20 = ema(c, 20)[n - 1], e50 = ema(c, 50)[n - 1];
  const tr = k1.slice(-14).map((q, i, a) => Math.max(q.h - q.l, i ? Math.abs(q.h - a[i - 1].c) : 0)), atr1h = tr.reduce((x, y) => x + y, 0) / 14 / p * 100;
  const ts = Math.abs(e20 - e50) / p * 100, last24 = k1.slice(-24), range24 = (Math.max(...last24.map(q => q.h)) - Math.min(...last24.map(q => q.l))) / p * 100;
  const kd = (await kl('BTCUSDT', '1d', 70)).slice(0, -1), qv = kd.map(q => q.v * q.c), btcVr = qv.slice(-7).reduce((a, b) => a + b, 0) / 7 / med(qv.slice(0, -7));
  const br = await breadth(TH), fl = [];
  if (br.med != null && br.med < TH.volRendah) fl.push(`volume altcoin rendah (median 7 hari = ${br.med.toFixed(2)}x median 60 hari, ${br.n} koin)`);
  if (ts < TH.trendTipis1h || (p < Math.max(e20, e50) && p > Math.min(e20, e50))) fl.push('tren 1H BTC tidak jelas (harga di antara EMA20 dan EMA50, atau keduanya berimpit)');
  if (atr1h < TH.atrMati1h) fl.push(`pasar mati: ATR14 1H BTC hanya ${atr1h.toFixed(2)}% (scalping tidak punya ruang)`);
  const st = fl.length >= 2 ? 'TIDAK TRADING' : fl.length === 1 ? 'SELEKTIF' : 'NORMAL';
  return { status: st, flags: fl, volRatio: br.med, volN: br.n, btcVr, atr1h, range24, trend1h: ts, btcTrend: p > e20 && e20 > e50 ? 1 : p < e20 && e20 < e50 ? -1 : 0,
    tunggu: atr1h > TH.atrEkstrem1h ? 'Volatilitas 1H ekstrem: jangan kejar harga, tunggu reda' : null };
}
async function eur() {
  const k = (await kl('EURUSDT', '1d', 6)).slice(0, -1), c = k.map(q => q.c), n = c.length, d1 = (c[n - 1] / c[n - 2] - 1) * 100, d3 = (c[n - 1] / c[n - 4] - 1) * 100;
  return { d1, d3, arah: d3 > 0.3 ? 'menguat' : d3 < -0.3 ? 'melemah' : 'datar', catatan: 'EURUSDT (Binance) sebagai proksi EUR/USD. Informasi makro, BUKAN trigger.' };
}

// Konfirmasi sinyal menunggu pada TF scalping (15m untuk retest, 1H untuk invalidasi).
async function konfirmasi(r) {
  const g = async iv => (await kl(r.a + 'USDT', iv, 30)).slice(0, -1), [a, b] = await Promise.all([g('15m'), g('1h')]);
  const s = r.d === 'LONG' ? 1 : -1, en = +r.en, sl = +r.sl, c15 = a.at(-1).c, c60 = b.at(-1).c;
  if (s === 1 ? c60 < sl : c60 > sl) return ['BATAL', 'close 1H melewati SL'];
  const held = a.slice(-8).some(q => (s === 1 ? q.l <= en * 1.0015 && q.c > en : q.h >= en * 0.9985 && q.c < en));
  if (s === 1 ? c15 > en : c15 < en) return held ? ['SIAP', 'retest tertahan di 15m'] : ['TUNGGU', 'di sisi benar level, belum retest'];
  return ['TUNGGU', 'tunggu close 15m ' + (s === 1 ? 'di atas' : 'di bawah') + ' entry'];
}

// Tag ringan dari teks @eliz883 (untuk dicocokkan, BUKAN memicu keputusan)
export function tagEliz(t) {
  const s = String(t).toLowerCase(), tg = [];
  if (/volume/.test(s) && /(low|little|rendah|thin|weak|lack|pointless|without)/.test(s)) tg.push('volume_rendah');
  if (/order ?books?/.test(s) && /(empty|thin|shallow)/.test(s)) tg.push('orderbook_tipis');
  if (/choppy|mess|pointless|no clear|unreliable|sideways|range-bound|directionless|no direction/.test(s)) tg.push('choppy');
  return tg;
}

export async function overlay(out, C, RES, ALL, SEKARANG) {
  const TH = { ...TH_DEF, ...(C.pasar || {}) }, today = new Date(SEKARANG).toISOString().slice(0, 10), cap = C.dailyCap || 3, W = out.warnings;
  let reg = null, eu = null;
  try { reg = await regime(TH); } catch (x) { W.push({ lvl: x.message === 'NO_NET' ? 'info' : 'kuning', e: 'monitor', t: 'Kondisi pasar tidak terambil: ' + x.message, aksi: 'Cek akses Binance dari Actions' }); }
  try { eu = await eur(); } catch { /* informasi saja */ }
  out.regime = reg; out.eur = eu; out.th = TH;
  const ez = out.eliz.lastPost ? (SEKARANG - new Date(out.eliz.lastPost)) / HARI : null; out.elizAge = ez;

  // riwayat status pasar harian (agar bisa diuji terhadap postingan @eliz883 ke depan)
  let hist = await riwayat(C, 'regime-history.json');
  if (reg) hist = hist.filter(h => h.d !== today).concat({ d: today, status: reg.status, vr: reg.volRatio, flags: reg.flags.length, t: new Date(SEKARANG).toISOString() }).slice(-400);
  const have = new Set(hist.map(h => h.d)), miss = [...Array(21)].map((_, i) => new Date(SEKARANG - (i + 1) * HARI).toISOString().slice(0, 10)).filter(d => !have.has(d));
  if (miss.length && !NO_NET) {
    try { for (const x of await volBackfill(TH)) if (!have.has(x.d)) hist.push({ d: x.d, status: null, vr: x.vr, flags: null, bf: true, t: new Date(SEKARANG).toISOString() }); hist = hist.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-400); }
    catch (x) { W.push({ lvl: 'kuning', e: 'monitor', t: 'Rekonstruksi volume harian gagal: ' + x.message, aksi: null }); }
  }
  out.simpan = { 'regime-history.json': hist };

  // uji volume vs @eliz883
  let EZ = []; try { EZ = JSON.parse(fs.readFileSync('data/eliz-posts.json', 'utf8')); } catch { /* kosong */ }
  const byDay = Object.fromEntries(hist.map(h => [h.d, h]));
  const utcD = t => { const x = String(t); if (x.length === 10) return x; return new Date(/(Z|[+-]\d\d:\d\d)$/.test(x) ? x : x + '+07:00').toISOString().slice(0, 10); };
  const vrPosts = [...new Set(EZ.filter(p => tagEliz(p.teks).includes('volume_rendah')).map(p => utcD(p.tgl)))];
  const terukur = vrPosts.filter(d => byDay[d] && byDay[d].vr != null).map(d => ({ d, vr: byDay[d].vr, flag: byDay[d].vr < TH.volRendah, bf: !!byDay[d].bf }));
  const sb = hist.filter(h => h.vr != null).slice(-21).map(h => h.vr);
  out.ujiEliz = { postVolumeRendah: vrPosts.length, postOrderbookTipis: [...new Set(EZ.filter(p => tagEliz(p.teks).includes('orderbook_tipis')).map(p => utcD(p.tgl)))].length, hariTerukur: terukur.length, cocok: terukur.filter(x => x.flag).length, rinci: terukur,
    sebaran: sb.length ? { n: sb.length, rendah: sb.filter(v => v < TH.volRendah).length, min: Math.min(...sb), med: med(sb), max: Math.max(...sb) } : null,
    catatan: 'Hari bertanda bf direkonstruksi dari kline (30 koin teratas saat ini). Tanggal postingan tanpa zona dianggap WIB. Sampel kecil: jangan ubah ambang sebelum puluhan hari terukur.' };

  // uji batas harian (per mesin): sinyal ke-(cap+1) dst pada hari yang sama
  const rowsToday = ALL.filter(x => x.d === today), lewat = rowsToday.filter(x => x.rk > cap).length, G = {};
  for (const x of ALL) { if (x.R == null) continue; const g = x.rk > cap ? 'lewat' : 'dalam', s = G[g] ??= { n: 0, tp: 0, r: 0 }; s.n++; if (x.h === 'TP') s.tp++; s.r += x.R; }
  out.ujiHarian = { cap, hariIni: rowsToday.length, lewatHariIni: lewat, grup: Object.entries(G).map(([g, s]) => ({ g: g === 'lewat' ? `lewat batas (sinyal ke-${cap + 1} dst per mesin per hari)` : `dalam batas (maks ${cap}/mesin/hari)`, n: s.n, tp: s.tp, r: s.r / s.n })) };
  if (lewat) W.push({ lvl: 'info', e: 'monitor', t: `Hari ini ${lewat} sinyal melewati batas uji ${cap}/mesin/hari`, aksi: 'Hanya label keputusan; mesin tidak diubah. Baca audit setelah data cukup' });
  if (reg && reg.volRatio == null && !NO_NET) W.push({ lvl: 'kuning', e: 'pasar', t: 'Volume altcoin tidak terukur (data koin kurang dari ' + TH.minKoin + ')', aksi: 'Cek akses Binance dari Actions' });
  if (reg && reg.status !== 'NORMAL') W.push({ lvl: reg.status === 'TIDAK TRADING' ? 'merah' : 'kuning', e: 'pasar', t: `Kondisi pasar ${reg.status}: ${reg.flags.join('; ')}`, aksi: 'Sejalan dengan @eliz883: tidak harus trading tiap hari' });
  if (reg?.tunggu) W.push({ lvl: 'kuning', e: 'pasar', t: reg.tunggu, aksi: null });
  if (eu && eu.arah === 'menguat') W.push({ lvl: 'info', e: 'makro', t: `EUR/USD ${eu.arah} (${eu.d3.toFixed(2)}% 3 hari): hindari short BTC`, aksi: null });

  // keputusan per sinyal menunggu
  const old = await riwayat(C, 'decisions.json'), seen = new Map(old.map(d => [d.k, d])), cache = {};
  for (const e of out.engines) for (const r of e.pending) {
    if (r.st !== 'MENUNGGU') continue;
    let kp = '-', kn = '';
    try {
      if (reg?.status === 'TIDAK TRADING') { kp = 'HINDARI'; kn = 'pasar tanpa volume/arah/ruang gerak'; }
      else { const c = cache[r.a + r.d + r.en] ??= await konfirmasi(r); [kp, kn] = c; if (r.dist != null && Math.abs(r.dist) > TH.maxJarakPct && kp === 'SIAP') { kp = 'TUNGGU'; kn = 'harga >' + TH.maxJarakPct + '% dari entry'; } }
      if (r.a === 'BTC' && r.d === 'SHORT' && eu?.arah === 'menguat') kn += ' | EUR/USD menguat: hati-hati short BTC';
    } catch (x) { kn = x.message === 'NO_NET' ? '' : 'konfirmasi gagal diambil'; }
    if (r.rk > cap) { kp = 'LEWAT BATAS'; kn = `sinyal ke-${r.rk} pada ${r.w} (batas uji ${cap}); hanya diuji`; }
    r.kp = kp; r.kn = kn;
    const k = `${e.id}|${r.a}|${r.t}|${r.d}`;
    if (kp !== '-' && !seen.has(k)) seen.set(k, { k, t: new Date(SEKARANG).toISOString(), kp, rg: reg?.status || '?', bf: r.w < today });
  }
  const dec = [...seen.values()].slice(-3000), G2 = {};
  for (const d of dec) { const x = RES[d.k]; if (d.bf || !x || x.R == null) continue; const g = d.kp === 'SIAP' ? 'SIAP' : d.kp === 'LEWAT BATAS' ? 'LEWAT BATAS' : 'LAINNYA', s = G2[g] ??= { n: 0, tp: 0, r: 0 }; s.n++; if (x.h === 'TP') s.tp++; s.r += x.R; }
  out.audit = { catatan: 'Keputusan dicatat saat sinyal pertama kali terlihat (tanpa backfill). Baca hanya bila tiap grup >= 30.', grup: Object.entries(G2).map(([g, s]) => ({ g, n: s.n, tp: s.tp, r: s.r / s.n })), total: dec.length };
  out.simpan['decisions.json'] = dec;

  let m = '\n## Kondisi pasar objektif (scalping)\n' + (reg ? `- Status: ${reg.status}${reg.flags.length ? ' (' + reg.flags.join('; ') + ')' : ''}\n- Volume altcoin (median 7 hari / median 60 hari, ${reg.volN} koin): ${reg.volRatio == null ? '-' : reg.volRatio.toFixed(2) + 'x'}; BTC: ${reg.btcVr.toFixed(2)}x\n- BTC 1H: ATR14 ${reg.atr1h.toFixed(2)}%, range 24 jam ${reg.range24.toFixed(1)}%, jarak EMA20-EMA50 ${reg.trend1h.toFixed(2)}%\n` : '- tidak tersedia\n') + (eu ? `- EUR/USD ${eu.arah} (1 hari ${eu.d1.toFixed(2)}%, 3 hari ${eu.d3.toFixed(2)}%)\n` : '');
  m += `\n## Uji batas harian (hipotesis, bukan aturan mesin)\nBatas uji ${cap}/mesin/hari. Hari ini ${rowsToday.length} sinyal, ${lewat} melewati batas.\n` + (out.ujiHarian.grup.map(g => `- ${g.g}: n=${g.n}, TP=${g.tp}, R/trade ${g.r.toFixed(2)}`).join('\n') || '- belum ada data') + '\n';
  m += `\n## Uji volume vs @eliz883\n- Postingan yang menyebut orderbook tipis: ${out.ujiEliz.postOrderbookTipis}\n- Postingan yang menyebut volume rendah: ${out.ujiEliz.postVolumeRendah}; hari terukur: ${out.ujiEliz.hariTerukur}; cocok: ${out.ujiEliz.cocok}\n${out.ujiEliz.rinci.map(x => `- ${x.d}: volume ${x.vr.toFixed(2)}x, ${x.flag ? 'ditandai rendah' : 'TIDAK ditandai'}${x.bf ? ' (rekonstruksi)' : ''}\n`).join('')}${out.ujiEliz.sebaran ? `- Sebaran 21 hari terakhir: ${out.ujiEliz.sebaran.n} hari, ${out.ujiEliz.sebaran.rendah} di bawah ${TH.volRendah}; min ${out.ujiEliz.sebaran.min.toFixed(2)}, median ${out.ujiEliz.sebaran.med.toFixed(2)}, maks ${out.ujiEliz.sebaran.max.toFixed(2)}\n` : ''}- ${out.ujiEliz.catatan}\n`;
  m += '\n## Keputusan monitor untuk sinyal menunggu\n';
  for (const e of out.engines) for (const r of e.pending) if (r.st === 'MENUNGGU') m += `- ${e.id} ${r.a} ${r.d} entry ${r.en}: ${r.kp || '-'} ${r.kn || ''}\n`;
  m += `\n## Audit lapisan keputusan\n${out.audit.grup.map(g => `- ${g.g}: n=${g.n}, TP=${g.tp}, R/trade ${g.r.toFixed(2)}`).join('\n') || '- belum ada sinyal selesai'}\n`;
  if (ez != null && ez > 3) m = `\n> PENGINGAT: postingan @eliz883 terakhir di monitor ${ez.toFixed(0)} hari lalu. Lampirkan postingan terbaru di chat.\n` + m;
  return m;
}
