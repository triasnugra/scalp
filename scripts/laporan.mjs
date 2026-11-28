// laporan.mjs : membuat "Laporan untuk Claude" (markdown) dan rekonstruksi laporan hari yang terlewat.
import { stats, tharp, levelStat, isFinal, kelompok, sesiUtc, MENIT } from './stats.mjs';

export const f2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(d));
export const pc = x => (x == null ? '-' : (100 * x).toFixed(0) + '%');
const jam = m => (m == null ? '-' : m < 90 ? Math.round(m) + 'mnt' : (m / 60).toFixed(1) + 'j');

export function tharpMd(list) {
  let m = '\n## Uji ala Van Tharp (SQN, biaya, distribusi R)\n';
  for (const e of list) {
    const t = e.tharp;
    if (!t || !t.ok) { m += `- ${e.id}: data belum cukup\n`; continue; }
    m += `- ${e.id}: N=${t.n}, R/trade ${f2(t.mean)}, SD ${f2(t.sd)}, SQN ${f2(t.sqn)} (SQN100 ${f2(t.sqn100)}, ${t.cls}); biaya impas ${f2(t.be)}%; R/trade pada biaya 0,1/0,2/0,3/0,5%: ${[1, 3, 4, 5].map(i => f2(t.biaya[i].r)).join(' / ')}R; 3 trade teratas = ${t.top3 == null ? '-' : (t.top3 * 100).toFixed(0) + '%'} dari total untung; R/trade tanpa 3 teratas ${f2(t.meanEx3)}\n    distribusi R: ${t.dist.map(d => d.l + ': ' + d.n).join(' | ')}\n`;
  }
  return m + '- Catatan: SQN bergantung pada jumlah trade; sebelum N >= 30 jangan ditafsirkan. Pada scalping stop sempit, biaya impas adalah angka terpenting.\n';
}
export function levelMd(list) {
  let m = '\n## Level unik (trade independen)\n';
  for (const e of list) {
    const l = e.level;
    if (!l || !l.ok) { m += `- ${e.id}: data belum cukup\n`; continue; }
    m += `- ${e.id}: terisi ${l.n} baris = ${l.u} level unik (duplikat ${l.dup}); N efektif ${l.neff.toFixed(0)}; R/trade per baris ${f2(e.all.netR)} vs R/level ${f2(l.mean)} (SD ${f2(l.sd)}, SQN level ${f2(l.sqn)}${l.u < 30 ? ', N<30' : ''}); TP/SL per level ${l.tp}/${l.sl}; level paling berulang ${l.big.a} ${l.big.d} ${l.big.n}x\n`;
  }
  return m + '- Catatan: level = koin, arah, entry, SL, TP sama. Baris di level yang sama sering keluar bersamaan, jadi bukan bukti independen.\n';
}
function kelompokMd(judul, g, catatan) {
  return `\n## ${judul}\n` + (g.length ? g.map(x => `- ${x.g}: n=${x.n}, TP=${x.tp}, SL=${x.sl}, win(R>0) ${pc(x.win)}, R/trade ${f2(x.r)}${x.se != null ? ' ± ' + f2(x.se) : ''}, PF ${f2(x.pf)}`).join('\n') : '- belum ada data') + '\n' + (catatan ? `- ${catatan}\n` : '');
}

export function kinerjaMd(list, C, commonStart) {
  let m = `## Kinerja (hasil jurnal mesin; R kotor dipulihkan lalu dipotong biaya monitor ${C.costPct}% pulang-pergi)\n| Mesin | Sinyal | Terisi (selesai) | Isi% | TP/Parsial/SL/Time | Win R>0 | R/trade | R mesin | PF | MaxDD (R) | Hold median | Minggu | Sejak ${commonStart}: selesai / R/trade |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const e of list) { const a = e.all; m += `| ${e.nama} | ${a.sinyal} | ${a.terisi} | ${pc(a.isiPct)} | ${a.tp}/${a.parsial}/${a.sl}/${a.time} | ${pc(a.win)} | ${f2(a.netR)} | ${f2(a.rMesin)} | ${f2(a.pf)} | ${f2(a.dd)} | ${jam(a.holdMed)} | ${a.minggu} | ${e.sejakBersama.terisi} / ${f2(e.sejakBersama.netR)} |\n`; }
  m += '\n## Corong sinyal\n';
  for (const e of list) { const c = e.corong; m += `- ${e.id}: sinyal ${c.sinyal} -> selesai ${c.selesai}, terbuka ${c.terbuka}, menunggu ${c.menunggu}, tidak terisi ${c.tdkIsi}, batal ${c.batal}${c.hilang ? ', data hilang ' + c.hilang : ''}\n`; }
  m += '\n## LONG vs SHORT\n';
  for (const e of list) m += `- ${e.id}: LONG n=${e.dir.LONG.terisi} R/trade ${f2(e.dir.LONG.netR)}; SHORT n=${e.dir.SHORT.terisi} R/trade ${f2(e.dir.SHORT.netR)}\n`;
  m += '\n## Stabilitas (paruh awal vs paruh akhir, urut waktu keluar) dan rentetan\n';
  for (const e of list) { const a = e.all; m += `- ${e.id}: ${a.paruh ? `paruh 1 (n=${a.paruh[2]}) R/trade ${f2(a.paruh[0])}; paruh 2 (n=${a.paruh[3]}) R/trade ${f2(a.paruh[1])}` : 'belum cukup trade (<10)'}; SL beruntun terpanjang ${a.maxStreakSL}, sekarang ${a.streakSL}\n`; }
  return m;
}

// out = hasil build (engines dll). extra = { overlayMd, makroMd, EZ, now }
export function buatLaporan(out, C, extra) {
  let md = `# Laporan monitor SCALPING untuk Claude (${out.updated})\n\n` + kinerjaMd(out.engines, C, out.commonStart);
  md += '\n## Warning\n'; for (const w of out.warnings) md += `- [${w.lvl}] ${w.e}: ${w.t}${w.aksi ? ' -> ' + w.aksi : ''}\n`;
  md += '\n## Kualitas data per mesin\n';
  for (const e of out.engines) md += `- ${e.id}: sumber ${e.sumber?.jenis || '-'}${e.sumber?.umurJam != null ? `, data berumur ${e.sumber.umurJam.toFixed(1)} jam` : ''}${e.kualitas.length ? '; ' + e.kualitas.map(k => k.t).join('; ') : ''}\n`;
  md += '\n## Per setup/trigger (R/trade sesudah biaya)\n';
  for (const e of out.engines) md += `- ${e.id}: ` + (e.setup.map(x => `${x.g} n=${x.n} R ${f2(x.r)}`).join(' | ') || 'belum ada') + '\n';
  md += kelompokMd('Uji sesi perdagangan (semua mesin; hipotesis)', out.ujiSesi, 'Dikelompokkan menurut jam sinyal (UTC). Selisih kurang dari ~2 galat baku belum berarti.');
  md += kelompokMd('Uji lebar stop vs biaya (semua mesin; hipotesis)', out.ujiStop, 'Stop sempit membuat biaya tetap memakan banyak R.');
  md += kelompokMd('Uji akhir pekan (hipotesis)', out.ujiAkhirPekan, 'Hipotesis dari postingan @eliz883 (candle Sabtu, order book kosong).');
  md += `\n## Postingan terbaru @eliz883 (tickers: ${out.eliz.tickers.join(', ') || '-'})\n`;
  for (const p of out.eliz.posts.slice(0, 5)) md += `- ${p.tgl}: ${p.teks.slice(0, 400)}\n`;
  md += extra.overlayMd + extra.makroMd + tharpMd(out.engines) + levelMd(out.engines);
  md += `\n## Permintaan\nEvaluasi laporan ini, cocokkan dengan postingan @eliz883 di atas, lalu buatkan full coding perbaikan (zip utuh siap commit lewat GitHub web UI) bila ada bukti statistik. Prinsip: tanpa rekayasa hasil, tanpa melebarkan SL sembarangan, tanpa menghapus trade rugi, RR tidak dikorbankan demi win rate, tanpa overfitting; setiap perubahan wajib diuji out-of-sample dan walk-forward; parameter tidak diubah sebelum ada bukti statistik; jujur soal sampel kecil dan rezim pasar. Perhatikan kolom "Kualitas data": mesin dengan asumsi pengisian/R tetap tidak bisa dibandingkan apel-ke-apel. Unggah zip repo mesin terbaru bila perlu diverifikasi.\n`;
  return md;
}

// Rekonstruksi laporan untuk tanggal yang terlewat. BUKAN snapshot asli: dihitung ulang dari jurnal per akhir hari (WIB).
export function rekonstruksi(d, ENG, C, EZ, hariIni) {
  const cut = Date.parse(d) + 864e5 - 7 * 36e5 - 1;
  let m = `# Laporan REKONSTRUKSI tanggal ${d} (dibuat ${hariIni}; BUKAN snapshot asli)\n\nDihitung ulang dari jurnal mesin dengan hanya memakai data sampai akhir ${d} (WIB). Hasil yang baru terjadi setelah itu dianggap belum selesai. TIDAK mencakup kondisi pasar, keputusan monitor, dan harga pada hari itu.\n\n## Kinerja (biaya ${C.costPct}% pulang-pergi)\n| Mesin | Sinyal | Terisi | TP/Parsial/SL/Time | Win R>0 | R/trade | PF |\n|---|---|---|---|---|---|---|\n`;
  const T = [], D2 = [];
  for (const [id, all] of Object.entries(ENG)) {
    const rows = all.filter(r => r.t <= cut).map(r => (r.tx && r.tx > cut && r.hasil !== 'MENUNGGU' ? { ...r, hasil: 'MENUNGGU', Rg: null, tx: null } : r));
    const st = stats(rows, C, { boot: false }), th = tharp(rows.filter(isFinal), C), dl = stats(rows.filter(r => r.arah === 'LONG'), C, { boot: false }), ds = stats(rows.filter(r => r.arah === 'SHORT'), C, { boot: false });
    m += `| ${id} | ${st.sinyal} | ${st.terisi} | ${st.tp}/${st.parsial}/${st.sl}/${st.time} | ${pc(st.win)} | ${f2(st.netR)} | ${f2(st.pf)} |\n`;
    D2.push(`- ${id}: LONG n=${dl.terisi} R/trade ${f2(dl.netR)}; SHORT n=${ds.terisi} R/trade ${f2(ds.netR)}`); T.push({ id, tharp: th });
  }
  m += `\n## LONG vs SHORT\n${D2.join('\n')}\n` + tharpMd(T);
  const P = EZ.filter(p => p.tgl.slice(0, 10) <= d).slice(-5).reverse();
  m += `\n## Postingan @eliz883 sampai ${d}\n${P.map(p => `- ${p.tgl}: ${p.teks.slice(0, 400)}`).join('\n') || '- tidak ada'}\n`;
  return m + '\n## Permintaan\nEvaluasi laporan rekonstruksi ini seperti laporan biasa, dengan catatan bahwa ia dihitung ulang dari jurnal, bukan snapshot asli.\n';
}
export { kelompok, sesiUtc, MENIT };
