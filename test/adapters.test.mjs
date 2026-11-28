import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisasi, toMs, parseCsv } from '../scripts/adapters.mjs';
const F = p => fs.readFileSync(new URL('./fixtures/' + p, import.meta.url), 'utf8');
const J = p => JSON.parse(F(p));
const hit = rows => rows.reduce((a, r) => (a[r.hasil] = (a[r.hasil] || 0) + 1, a), {});
const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('toMs: label UTC, epoch, ISO tanpa zona', () => {
  assert.equal(toMs('2026-11-11 11:45 UTC'), Date.UTC(2026, 10, 11, 11, 45));
  assert.equal(toMs(1794397500000), 1794397500000);
  assert.equal(toMs('2026-11-19T19:27:37+00:00'), Date.UTC(2026, 10, 19, 19, 27, 37));
  assert.equal(toMs(''), null);
});
test('parseCsv: kutip dan CRLF', () => {
  const r = parseCsv('a,b\r\n1,"x,y"\r\n2,z\r\n');
  assert.deepEqual(r, [{ a: '1', b: 'x,y' }, { a: '2', b: 'z' }]);
});
test('sc: hasil dan waktu', () => {
  const r = normalisasi({ id: 'sc', adapter: 'sc' }, J('sc/data/journal.json'));
  assert.equal(r.rows.length, 5); assert.deepEqual(hit(r.rows), { SL: 4, TP: 1 });
  assert.equal(r.rows[0].t, Date.UTC(2026, 10, 11, 11, 45)); assert.equal(r.rows.every(x => x.Rm === null), true);
});
test('scv5: replay event rantai', () => {
  const r = normalisasi({ id: 'scv5', adapter: 'scv5' }, F('scv5/data/journal.jsonl'));
  assert.deepEqual(hit(r.rows), { TIDAK_TERISI: 1, SL: 3 });
  const sl = r.rows.find(x => x.hasil === 'SL'); assert.equal(sl.Rg, -1); assert.ok(sl.Rm < -1);   // r_net lebih buruk dari -1 karena biaya
});
test('scv6: status -> hasil, entry tengah zona, bendera kualitas', () => {
  const r = normalisasi({ id: 'scv6', adapter: 'scv6' }, J('scv6/data/journal.json'));
  const h = hit(r.rows); assert.equal(h.SL, 43); assert.equal(h.TP, 1); assert.equal(h.PARSIAL, 21); assert.equal(h.TIDAK_TERISI, 4);
  assert.ok(r.rows.every(x => x.fillAsumsi)); assert.ok(r.meta.rHardcode);
});
test('sctn: R kotor dipulihkan = R mesin + fee/stop%', () => {
  const r = normalisasi({ id: 'sctnv3', adapter: 'sctn', feeMesinPct: 0.1 }, J('sctnv3/output/forward_test.json'), { log: F('sctnv3/output/signal_log.csv') });
  const x = r.rows.find(q => q.hasil === 'TP'); const sp = Math.abs(x.entry - x.sl) / x.entry * 100;
  near(x.Rg, x.Rm + 0.1 / sp); assert.ok(x.Rg > x.Rm);
});
test('sctnv2: baris berhash lama = warisan', () => {
  const r = normalisasi({ id: 'sctnv2', adapter: 'sctn' }, J('sctnv2/output/forward_test.json'), { log: F('sctnv2/output/signal_log.csv') });
  assert.equal(r.rows.filter(x => x.milik === 'warisan').length, 7); assert.equal(r.rows.filter(x => x.milik === 'sendiri').length, 22);
  assert.equal(r.meta.hashSendiri, '52a982af2374');
});
test('sctn tanpa signal_log: tidak ada warisan, ada peringatan kualitas', () => {
  const r = normalisasi({ id: 'sctnv2', adapter: 'sctn' }, J('sctnv2/output/forward_test.json'), { log: null });
  assert.equal(r.rows.filter(x => x.milik === 'warisan').length, 0); assert.ok(r.meta.kualitas.some(k => /signal_log/.test(k.t)));
});
test('scv2: outcome dipetakan dan R kotor dipulihkan', () => {
  const r = normalisasi({ id: 'scv2', adapter: 'scv2' }, J('scv2/state/journal.json'));
  assert.deepEqual(hit(r.rows), { SL: 1, TP: 1, PARSIAL: 1, TIME: 1, TIDAK_TERISI: 1, BATAL: 1, MENUNGGU: 1, TERBUKA: 1 });
  const sl = r.rows.find(x => x.hasil === 'SL'); near(sl.Rg, -1);
  const tp = r.rows.find(x => x.hasil === 'TP'); assert.ok(tp.Rg > tp.Rm);
  assert.equal(r.rows.find(x => x.hasil === 'TERBUKA').tFill !== null, true);   // MARKET terisi di awal
});
test('sctnv4: status dipetakan, aset tanpa /USDT, fill diasumsikan', () => {
  const r = normalisasi({ id: 'sctnv4', adapter: 'sctnv4', feeMesinPct: 0.16 }, J('sctnv4/history.json'));
  assert.deepEqual(hit(r.rows), { SL: 1, TP: 1, PARSIAL: 1, TIME: 1, TERBUKA: 1 });
  assert.equal(r.rows[0].aset, 'BTC'); assert.ok(r.rows.every(x => x.fillAsumsi));
  const sl = r.rows.find(x => x.hasil === 'SL'); assert.ok(sl.Rg > sl.Rm);
});
test('baris rusak dibuang, id ganda digabung', () => {
  const raw = [{ id: 'a|1', aset: 'X', arah: 'LONG', entry: 1, sl: 0.9, tp: 1.2, hasil: 'TP', R: 2, t0: 1794397500000 }, { id: 'a|1', aset: 'X', arah: 'LONG', entry: 1, sl: 0.9, tp: 1.2, hasil: 'TP', R: 2, t0: 1794397500000 }, { id: 'b', aset: 'Y', arah: 'LONG', entry: 1, sl: 1, tp: 2, hasil: 'SL', R: -1, t0: 1794397500000 }, { id: 'c', aset: 'Z', arah: 'LONG', entry: 1, sl: 0.9, tp: 2, hasil: 'TP', R: null, t0: 1794397500000 }];
  const r = normalisasi({ id: 'sc', adapter: 'sc' }, raw);
  assert.equal(r.rows.length, 1); assert.equal(r.salah, 2); assert.equal(r.duplikat, 1);
});
