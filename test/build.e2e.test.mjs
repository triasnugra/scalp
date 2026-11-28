// Uji ujung-ke-ujung OFFLINE: build memakai fixture lokal, lalu build kedua dengan riwayat dari build pertama.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname), FIX = path.join(ROOT, 'test/fixtures');
const run = (site, extra = {}) => spawnSync('node', ['scripts/build.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_NET: '1', LOCAL_DIR: FIX, SITE_DIR: site, FAKE_NOW: '2026-11-28T03:00:00Z', ...extra } });

test('build offline menghasilkan data.json lengkap tanpa NaN', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const r = run(site); assert.equal(r.status, 0, r.stderr + r.stdout);
  const raw = fs.readFileSync(path.join(site, 'data.json'), 'utf8'), D = JSON.parse(raw);
  assert.equal(D.engines.length, 8); assert.ok(!/NaN|undefined/.test(raw));
  const by = Object.fromEntries(D.engines.map(e => [e.id, e]));
  assert.equal(by.scv6.all.terisi, 65); assert.equal(by.scv6.all.sl, 43);        // sama dengan statistik jurnal scv6 sendiri
  assert.equal(by.sctnv3.all.terisi, 11); assert.equal(by.sctnv2.warisan, 7); assert.equal(by.sctnv2.all.terisi, 12);
  assert.ok(D.engines.every(e => e.layak === false));                              // sampel masih kecil: tidak ada yang layak
  assert.equal(D.log.length, 4); assert.ok(D.log.every(l => /0001$/.test(l.id)) && /0001$/.test(D.hariId));
  for (const f of ['index.html', 'laporan.md', 'arsip.json', 'laporan-log.json', 'regime-history.json', 'decisions.json', 'vendor/xlsx.full.min.js']) assert.ok(fs.existsSync(path.join(site, f)), f);
  assert.match(D.laporan, /Kinerja/); assert.match(D.laporan, /Kualitas data/);
});

test('arsip: baris yang hilang dari sumber tetap ada; sumber hilang -> memakai arsip', () => {
  const s1 = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), s2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  assert.equal(run(s1).status, 0);
  // folder lokal kedua: scv6 dipotong jadi 10 baris tertutup
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-')); fs.cpSync(FIX, fx, { recursive: true });
  const jp = path.join(fx, 'scv6/data/journal.json'), j = JSON.parse(fs.readFileSync(jp, 'utf8')); j.closedSignals = j.closedSignals.slice(0, 10); j.activeSignals = []; fs.writeFileSync(jp, JSON.stringify(j));
  fs.rmSync(path.join(fx, 'sc/data/journal.json'));                                  // sumber sc hilang
  const r = run(s2, { LOCAL_DIR: fx, STATE_IN: s1 }); assert.equal(r.status, 0, r.stderr + r.stdout);
  const D = JSON.parse(fs.readFileSync(path.join(s2, 'data.json'), 'utf8')), by = Object.fromEntries(D.engines.map(e => [e.id, e]));
  assert.equal(by.scv6.all.terisi, 65);                                              // 55 hilang dari sumber tetap dihitung dari arsip
  assert.equal(by.scv6.sumber.dariArsip > 50, true);
  assert.equal(by.sc.sumber.jenis, 'arsip'); assert.equal(by.sc.all.terisi, 5);
  assert.ok(D.warnings.some(w => w.e === 'sc' && w.lvl === 'merah' && /arsip/.test(w.t)));
  assert.equal(D.log.length >= 3, true);                                             // riwayat laporan dibawa
});
