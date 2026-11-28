// io.mjs : semua akses jaringan dan berkas keadaan di satu tempat.
//  - NO_NET=1      : tidak ada panggilan jaringan sama sekali (uji offline).
//  - LOCAL_DIR=dir : jurnal mesin dibaca dari folder lokal (dir/<repo>-main/<path> atau dir/<repo>/<path>).
//  - STATE_IN=dir  : riwayat monitor (laporan-log, regime-history, decisions, arsip) dibaca dari folder, bukan dari Pages.
import fs from 'node:fs';
import path from 'node:path';

export const NO_NET = !!process.env.NO_NET;
export const LOCAL = process.env.LOCAL_DIR || '';
export const TOKEN = process.env.MONITOR_TOKEN || '';

export async function http(url, { headers = {}, timeout = 20000 } = {}) {
  if (NO_NET) throw new Error('NO_NET');
  return fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
}
export async function httpJson(url, opt) {
  const r = await http(url, opt);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Riwayat monitor yang dibawa antar build lewat GitHub Pages. 404 = belum ada (build pertama). Galat lain = hentikan
// build supaya riwayat tidak tertimpa kosong.
export async function riwayat(C, nama, kosong = []) {
  if (process.env.STATE_IN) {
    const f = path.join(process.env.STATE_IN, nama);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : kosong;
  }
  if (LOCAL || NO_NET) return kosong;
  const r = await http(`https://${C.owner}.github.io/${C.situs}/${nama}`);
  if (r.status === 404) return kosong;
  if (!r.ok) throw new Error(`${nama} HTTP ${r.status}: build dihentikan agar riwayat tidak hilang`);
  return r.json();
}

function lokalPath(e, rel) {
  for (const d of [`${e.repo}-main`, e.repo]) { const f = path.join(LOCAL, d, rel); if (fs.existsSync(f)) return f; }
  return null;
}

// Ambil satu berkas mesin. Urutan: kandidat di config.berkas[kunci] (raw GitHub dengan token, lalu GitHub Pages).
// Hasil: { teks, sumber, lastModified } atau lempar galat berisi semua alasan gagal.
export async function ambilBerkas(C, e, kunci) {
  if (LOCAL) {
    const rel = e.lokal?.[kunci]; if (!rel) throw new Error(`config.lokal.${kunci} tidak diisi untuk ${e.id}`);
    const f = lokalPath(e, rel); if (!f) throw new Error(`berkas lokal tidak ada: ${rel}`);
    return { teks: fs.readFileSync(f, 'utf8'), sumber: 'lokal:' + rel, lastModified: null };
  }
  const alasan = [];
  for (const k of e.berkas?.[kunci] || []) {
    const url = k.pages ? `https://${C.owner}.github.io/${e.repo}/${k.pages}` : `https://raw.githubusercontent.com/${C.owner}/${e.repo}/${k.cabang || 'main'}/${k.path}`;
    try {
      const r = await http(url + (k.pages ? `?cb=${Date.now()}` : ''), { headers: k.pages || !TOKEN ? {} : { Authorization: 'token ' + TOKEN } });
      if (!r.ok) { alasan.push(`${url} -> HTTP ${r.status}`); continue; }
      const lm = Date.parse(r.headers.get('last-modified') || '');
      return { teks: await r.text(), sumber: url, lastModified: Number.isFinite(lm) ? lm : null, cabang: k.cabang || null, path: k.path || null };
    } catch (x) { alasan.push(`${url} -> ${x.message}`); }
  }
  throw new Error(alasan.join(' | ') || 'tidak ada sumber di config.berkas.' + kunci);
}

// Waktu commit terakhir sebuah berkas (untuk mengetahui apakah workflow mesin masih hidup). null bila tak terbaca.
export async function waktuCommit(C, e, src) {
  if (NO_NET || LOCAL || !src?.path) return null;
  try {
    const u = `https://api.github.com/repos/${C.owner}/${e.repo}/commits?sha=${src.cabang || 'main'}&path=${encodeURIComponent(src.path)}&per_page=1`;
    const j = await httpJson(u, { headers: { Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: 'token ' + TOKEN } : {}) }, timeout: 10000 });
    return j[0] ? Date.parse(j[0].commit.committer.date) : null;
  } catch { return null; }
}
