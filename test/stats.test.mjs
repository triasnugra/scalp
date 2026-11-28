import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, tharp, netR, wilson, drawdown, bootstrapHari, levelStat, kelompok, sesiUtc, ekuitas, isoWeek } from '../scripts/stats.mjs';
const C = { costPct: 0.2, maksHoldJam: 6 };
const T0 = Date.UTC(2026, 10, 1);
let n = 0;
const mk = (hasil, Rg, o = {}) => ({ id: 'x' + n++, mesin: 'm', aset: o.aset || 'A', arah: o.arah || 'LONG', entry: 100, sl: 99, tp: 102, t: T0 + (o.h ?? n) * 36e5, tFill: null, tx: T0 + ((o.h ?? n) + 1) * 36e5, hasil, Rg, Rm: null, setup: 's', ...o });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('netR: biaya 0,2% pada stop 1% = 0,2R', () => near(netR(mk('TP', 2), 0.2), 1.8));
test('wilson', () => { const [a, b] = wilson(5, 10); assert.ok(a > 0.23 && a < 0.24 && b > 0.76 && b < 0.77); assert.equal(wilson(0, 0), null); });
test('drawdown dan rentetan', () => { const d = drawdown([1, -1, -1, -1, 2, -1]); near(d.dd, 3); assert.equal(d.maxStreak, 3); assert.equal(d.curStreak, 1); });
test('stats: hitung hasil, isi%, PF, tidak menghitung TERBUKA', () => {
  const rows = [mk('TP', 2), mk('SL', -1), mk('PARSIAL', 0.5), mk('TIME', -0.2), mk('TERBUKA', null), mk('TIDAK_TERISI', null), mk('BATAL', null), mk('MENUNGGU', null)];
  const s = stats(rows, C);
  assert.equal(s.terisi, 4); assert.equal(s.tp, 1); assert.equal(s.sl, 1); assert.equal(s.parsial, 1); assert.equal(s.time, 1);
  near(s.isiPct, 5 / 7); near(s.netR, (1.8 - 1.2 + 0.3 - 0.4) / 4);
  assert.ok(s.pf > 0); assert.equal(s.menunggu, 1);
});
test('bootstrap per hari deterministik dan butuh >= 15 hari', () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ t: T0 + i * 864e5, n: 0.1 }));
  assert.equal(bootstrapHari(few), null);
  const many = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * 864e5, n: i % 3 ? 0.5 : -0.4 }));
  const a = bootstrapHari(many), b = bootstrapHari(many); assert.deepEqual(a, b); assert.ok(a[0] < a[1]);
});
test('tharp: biaya impas = biaya yang membuat R/trade nol', () => {
  const f = [mk('TP', 1.5), mk('SL', -1), mk('TP', 1.5), mk('SL', -1)];   // R kotor rata-rata 0,25; stop 1% => impas 0,25%
  const t = tharp(f, C); near(t.be, 0.25); near(t.biaya.find(b => b.c === 0.3).r, 0.25 - 0.3);
});
test('levelStat: baris dengan level sama = satu level', () => {
  const f = [mk('SL', -1, { aset: 'Q' }), mk('SL', -1, { aset: 'Q' }), mk('TP', 2, { aset: 'R' })];
  const l = levelStat(f, C); assert.equal(l.u, 2); assert.equal(l.dup, 1); near(l.neff, 9 / 5);
});
test('kelompok dan sesi', () => {
  assert.equal(sesiUtc(Date.UTC(2026, 10, 1, 3)), 'Asia (00-07 UTC)'); assert.equal(sesiUtc(Date.UTC(2026, 10, 1, 15)), 'Amerika (13-21 UTC)');
  const g = kelompok([mk('TP', 2, { arah: 'LONG' }), mk('SL', -1, { arah: 'SHORT' })], C, r => r.arah); assert.equal(g.length, 2);
});
test('ekuitas dikurangi ke maks titik dan isoWeek', () => {
  const f = Array.from({ length: 500 }, () => mk('TP', 1)); assert.equal(ekuitas(f, C, 100).length, 100);
  assert.equal(isoWeek(Date.UTC(2026, 10, 28)), '2026-48');
});
