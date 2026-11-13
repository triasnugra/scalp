import{detect,resolve,CFG}from'../lib/engine.mjs';
let f=0;const ok=(c,m)=>{if(!c){f++;console.log('GAGAL',m)}else console.log('ok  ',m)};
const T0=Date.UTC(2026,0,5),bars=[];
for(let i=0;i<200;i++){const m=105+4*Math.sin(i/8);bars.push({t:T0+i*36e5,o:m,c:m+.2,h:m+.8,l:m-.5,v:100})}
Object.assign(bars[197],{o:101,h:101.5,l:98.5,c:101.2});Object.assign(bars[198],{o:101.2,h:102,l:100.9,c:101.8});Object.assign(bars[199],{o:101.8,h:102.5,l:101.6,c:102.2});
const d=detect(bars);ok(d.list.some(x=>x.k==='DV'&&x.side===1),'deviasi di bawah low range terdeteksi (LONG)');
ok(!d.list.some(x=>x.side===-1&&x.k==='DV'),'tidak ada deviasi SHORT palsu');
const s={side:'LONG',entry:100,sl:99,tp1:101.5,tp2:103,slp:1},B=(l,h)=>({o:100,c:100,l,h});
let r=resolve(s,[B(99.8,100.4),B(100.1,101.6),B(100.2,103.1)]);ok(r.hasil==='TP2'&&Math.abs(r.R-2.1)<.01,'TP1 lalu TP2 = 2.1R');
r=resolve(s,[B(99.8,100.4),B(98.9,100.3)]);ok(r.hasil==='SL'&&r.R===-1,'SL = -1R');
r=resolve(s,[B(99.8,100.4),B(100.1,101.6),B(99.9,100.5)]);ok(r.hasil==='TP1+BE'&&Math.abs(r.R-.9)<.01,'TP1 lalu BE = 0.9R');
r=resolve(s,[B(100.5,101.6)]);ok(r.hasil==='BATAL','TP tersentuh sebelum terisi = batal');
r=resolve(s,Array.from({length:CFG.fillBars+1},()=>B(100.5,100.9)));ok(r.hasil==='TIDAK-TERISI','tidak terisi dalam 12 bar');
r=resolve({...s,side:'SHORT',entry:100,sl:101,tp1:98.5,tp2:97},[B(99.6,100.2),B(99.0,100.2)]);ok(r.hasil==='OPEN','SHORT terisi, masih berjalan');
const T=(i,l,h)=>({t:1e12+i*36e5,o:100,c:100,l,h});
r=resolve(s,[T(0,99.8,100.4),T(1,100.1,101.6),T(2,100.2,103.1)]);ok(r.hasil==='TP2'&&r.tx===1e12+2*36e5,'waktu hasil (tx) = candle saat TP2 tercapai');
r=resolve(s,[T(0,99.8,100.4),T(1,98.9,100.3)]);ok(r.hasil==='SL'&&r.tx===1e12+36e5,'waktu hasil (tx) = candle saat SL');
r=resolve(s,[T(0,99.8,100.4)]);ok(r.hasil==='OPEN'&&r.tx===undefined,'posisi OPEN belum punya waktu hasil');
console.log(f?`${f} GAGAL`:'SEMUA LULUS');process.exit(f?1:0);
