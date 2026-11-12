// Scalp Engine: metode Eliz (deviasi, stop run, breakout-retest, Monday, Fib 0,75, OBV)
// + gerbang & skor ala tnv2c2 + simulasi hasil bertahap (TP1 60%, sisanya BE/TP2).
export const CFG={minQv:3e7,topN:40,rangeBars:72,skipBars:3,minScore:60,maxPerRun:5,maxPerSide:3,
  costPct:0.1,fillBars:12,holdBars:48,tp1R:1.5,split:0.6,slMin:0.6,slMax:4,cooldownH:6,events:[]};
const H=36e5,avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
export const ema=(a,n)=>{const k=2/(n+1);let e=a[0];return a.map(v=>(e=v*k+e*(1-k)))};
export const atr=(c,n=14)=>{const r=[];for(let i=1;i<c.length;i++)r.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));return avg(r.slice(-n))};
export function trend(c){if(c.length<55)return 0;const x=c.map(k=>k.c),a=ema(x,20).at(-1),b=ema(x,50).at(-1),p=x.at(-1);return a>b&&p>b?1:a<b&&p<b?-1:0}
export function obvDiv(c,side){const n=c.length;if(n<40)return false;let o=0;
  const ob=c.map((k,i)=>i?(o+=k.c>c[i-1].c?k.v:k.c<c[i-1].c?-k.v:0):0);
  const pick=(a,b)=>{let j=a;for(let i=a;i<b;i++)if(side==1?c[i].l<c[j].l:c[i].h>c[j].h)j=i;return j};
  const i2=pick(n-12,n),i1=pick(n-24,n-12);
  return side==1?(c[i2].l<c[i1].l&&ob[i2]>ob[i1]):(c[i2].h>c[i1].h&&ob[i2]<ob[i1])}

// Pemicu di 1H (h1 = candle tertutup saja)
export function detect(h1){
  const n=h1.length,last=h1[n-1],list=[];
  const rg=h1.slice(-(CFG.rangeBars+CFG.skipBars),-CFG.skipBars);
  const Hh=Math.max(...rg.map(k=>k.h)),Ll=Math.min(...rg.map(k=>k.l));
  const vavg=avg(h1.slice(-21,-1).map(k=>k.v))||1;
  for(const side of[1,-1]){ // deviasi / double deviation (stop run)
    const lvl=side==1?Ll:Hh,idx=[];
    for(let i=n-12;i<n;i++)if(side==1?h1[i].l<lvl:h1[i].h>lvl)idx.push(i);
    if(!idx.length)continue;const ls=idx.at(-1);
    if(n-1-ls>5||!(side==1?last.c>lvl:last.c<lvl))continue;
    const wick=side==1?Math.min(...idx.map(i=>h1[i].l)):Math.max(...idx.map(i=>h1[i].h));
    const bi=idx.reduce((b,i)=>h1[i].v>h1[b].v?i:b,idx[0]);
    list.push({k:idx.length>=2?'DD':'DV',side,lvl,wick,age:n-1-ls,vr:h1[bi].v/vavg});
  }
  const r2=h1.slice(-96,-24),H2=Math.max(...r2.map(k=>k.h)),L2=Math.min(...r2.map(k=>k.l)),w=h1.slice(-24),l2=h1.slice(-2);
  for(const side of[1,-1]){ // breakout 2 close lalu retest tertahan
    const lvl=side==1?H2:L2;let j=-1;
    for(let i=0;i<w.length-1;i++)if(side==1?(w[i].c>lvl*1.002&&w[i+1].c>lvl):(w[i].c<lvl*.998&&w[i+1].c<lvl)){j=i;break}
    if(j<0||j>w.length-3)continue;
    const touch=side==1?Math.min(...l2.map(k=>k.l))<=lvl*1.004:Math.max(...l2.map(k=>k.h))>=lvl*.996;
    const hold=side==1?last.c>lvl&&last.c>last.o:last.c<lvl&&last.c<last.o;
    if(touch&&hold&&Math.abs(last.c-lvl)/lvl<.015)list.push({k:'BR',side,lvl,age:0,vr:last.v/vavg,
      wick:side==1?Math.min(...l2.map(k=>k.l)):Math.max(...l2.map(k=>k.h))});
  }
  const d=new Date(last.t+H),dsm=(d.getUTCDay()+6)%7; // sapuan Monday range (hanya setelah Senin selesai)
  if(dsm>0){const ms=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dsm),mon=h1.filter(k=>k.t>=ms&&k.t<ms+864e5);
    if(mon.length>=20){const mh=Math.max(...mon.map(k=>k.h)),ml=Math.min(...mon.map(k=>k.l));
      for(const side of[1,-1]){const lvl=side==1?ml:mh,idx=[];
        for(let i=Math.max(n-6,0);i<n;i++)if(h1[i].t>=ms+864e5&&(side==1?h1[i].l<lvl:h1[i].h>lvl))idx.push(i);
        if(idx.length&&(side==1?last.c>lvl:last.c<lvl))list.push({k:'MON',side,lvl,age:n-1-idx.at(-1),vr:1,
          wick:side==1?Math.min(...idx.map(i=>h1[i].l)):Math.max(...idx.map(i=>h1[i].h))});}}}
  return{H:Hh,L:Ll,list};
}
// Pullback ke zona Fib 0,70-0,79 dari impuls 4H terakhir
export function fib(h4,last){
  const w=h4.slice(-60),out=[];if(w.length<40)return out;let iH=0,iL=0;
  w.forEach((k,i)=>{if(k.h>w[iH].h)iH=i;if(k.l<w[iL].l)iL=i});
  if(iL<iH&&iH<w.length-1){const hi=w[iH].h,lo=Math.min(...w.slice(0,iH+1).map(k=>k.l)),m=hi-lo,z1=hi-.79*m,z2=hi-.7*m;
    if(m/lo>.06&&last.l<=z2&&last.c>z1&&last.c>last.o)out.push({k:'FIB',side:1,lvl:hi-.75*m,wick:Math.min(last.l,z1),age:0,vr:1})}
  if(iH<iL&&iL<w.length-1){const lo=w[iL].l,hi=Math.max(...w.slice(0,iL+1).map(k=>k.h)),m=hi-lo,z1=lo+.7*m,z2=lo+.79*m;
    if(m/lo>.06&&last.h>=z1&&last.c<z2&&last.c<last.o)out.push({k:'FIB',side:-1,lvl:lo+.75*m,wick:Math.max(last.h,z2),age:0,vr:1})}
  return out;
}
const PRI={DD:0,DV:1,BR:2,FIB:3,MON:4};
const NM=(k,s)=>({DD:`Double deviation ${s==1?'di bawah low':'di atas high'} range (stop run berulang)`,
  DV:`Deviasi ${s==1?'di bawah low':'di atas high'} range, close kembali ke dalam`,
  BR:'Breakout 2 close lalu retest tertahan',FIB:'Pullback ke zona Fib 0,70-0,79 + candle penolakan',
  MON:`Sapuan Monday ${s==1?'low':'high'} lalu pulih`})[k];
function evalSide(side,ts,c){
  const{d,px,last,a1,t1,t4,btc,sym,now,h1,h4}=c;
  ts=ts.filter(x=>x.k!=='FIB'||t1===side).sort((a,b)=>PRI[a.k]-PRI[b.k]);
  if(!ts.length)return{rej:'tanpa-pemicu'};
  const main=ts[0],kinds=[...new Set(ts.map(x=>x.k))],div=obvDiv(h4,side);
  if(t1===-side&&kinds.length+(div?1:0)<2)return{rej:'lawan-tren'};
  const free=kinds.includes('BR')||kinds.includes('FIB'),pos=(px-d.L)/(d.H-d.L),wd=(d.H-d.L)/d.L;
  if(!free&&(wd<.025||wd>.15))return{rej:'range-invalid'};
  if(!free&&(side==1?pos>.35:pos<.65))return{rej:'mid-range'};
  if(side==1?last.c<=last.o:last.c>=last.o)return{rej:'tanpa-konfirmasi'};
  if(main.age>4)return{rej:'usang'};
  if(sym!=='BTCUSDT'){if(!btc)return{rej:'btc-tidak-ada'};
    if(btc.t1===-side&&btc.t4===-side)return{rej:'lawan-btc'};if(btc.mv6*side<-2.5)return{rej:'btc-pisau'}}
  const lim=main.lvl+side*.25*a1,entry=side==1?Math.min(px,lim):Math.max(px,lim);
  const l6=h1.slice(-6),ext=side==1?Math.min(main.wick,...l6.map(k=>k.l)):Math.max(main.wick,...l6.map(k=>k.h));
  let sl=ext-side*.25*a1,risk=Math.abs(entry-sl);if(risk<a1){sl=entry-side*a1;risk=a1}
  const slp=risk/entry*100;if(slp<CFG.slMin||slp>CFG.slMax)return{rej:'sl-di-luar-batas'};
  if(Math.abs(px-entry)>risk)return{rej:'jauh-dari-entry'};
  const oppR=side*((side==1?d.H:d.L)-entry)/risk;if(oppR<2.5)return{rej:'rr-kurang'};
  const tgtR=Math.min(5,oppR),tp1=entry+side*CFG.tp1R*risk,tp2=entry+side*tgtR*risk;
  const since=h1.slice(-(main.age+1));
  if(side==1?Math.max(...since.map(k=>k.h))>=tp1:Math.min(...since.map(k=>k.l))<=tp1)return{rej:'usang-tp'};
  if(side==1?Math.min(...since.map(k=>k.l))<=sl:Math.max(...since.map(k=>k.h))>=sl)return{rej:'sl-tersentuh'};
  const loc=free?.6:side==1?1-pos:pos,notes=[];
  let score=(t1===side?15:t1===0?8:2)+(t4===side?10:t4===0?5:0)
    +Math.min(25,{DD:20,DV:16,BR:16,FIB:14,MON:8}[main.k]+Math.min(9,(kinds.length-1)*5)+(div?6:0))
    +Math.round(15*Math.min(1,Math.max(0,(loc-.3)/.6)))+(main.vr>=1.5?10:main.vr>=1?6:2)
    +(sym==='BTCUSDT'?7:(btc.t1===side||btc.t4===side)?10:5)+(tgtR>=4?10:tgtR>=3?8:5)+([5,4,3][main.age]??1);
  if(kinds.length===1&&main.k==='MON'){score-=10;notes.push('Hanya Monday-sweep: bobot dikurangi (Monday kotor)')}
  if([0,6].includes(new Date(now).getUTCDay())){score-=5;notes.push('Akhir pekan: likuiditas tipis')}
  score=Math.max(0,Math.min(100,score));if(score<CFG.minScore)return{rej:'skor-rendah'};
  const why=[...ts.map(x=>NM(x.k,side)),`Tren 1D ${t1==1?'naik':t1==-1?'turun':'datar'}, 4H ${t4==1?'naik':t4==-1?'turun':'datar'}`];
  if(div)why.push('Divergensi OBV 4H searah');if(main.vr>=1.5)why.push(`Volume pemicu ${main.vr.toFixed(1)}x rata-rata`);
  return{sig:{id:`${sym}|${side}|${main.k}|${h1[h1.length-1-main.age].t}`,sym,side:side==1?'LONG':'SHORT',trig:kinds,
    score,grade:score>=75?'A':'B',entry,sl,tp1,tp2,slp:+slp.toFixed(3),tgtR:+tgtR.toFixed(2),px,
    pos:+pos.toFixed(2),t1,t4,t:last.t+H,why:[...why,...notes],hasil:'MENUNGGU'}};
}
export function analyze(sym,d1,h4,h1,btc,now=Date.now()){
  const rej=r=>({rej:r});
  if(h1.length<130||h4.length<60||d1.length<55)return rej('data-kurang');
  if((CFG.events||[]).some(e=>Math.abs(Date.parse(e.t)-now)<2*H))return rej('agenda-makro');
  const last=h1.at(-1),d=detect(h1),list=[...d.list,...fib(h4,last)];
  if(!list.length)return rej('tanpa-pemicu');
  const c={d,px:last.c,last,a1:atr(h1),t1:trend(d1),t4:trend(h4),btc,sym,now,h1,h4};
  let best=null,why=null;
  for(const s of[1,-1]){const ts=list.filter(x=>x.side===s);if(!ts.length)continue;
    const r=evalSide(s,ts,c);if(r.sig&&(!best||r.sig.score>best.score))best=r.sig;else if(r.rej)why??=r.rej}
  return best?{sig:best}:rej(why||'tanpa-pemicu');
}
// Simulasi: limit terisi <=12 bar, TP1 60% lalu SL ke BE, sisa ke TP2; sama-bar = pesimis (SL dulu)
export function resolve(s,bars){
  const L=s.side==='LONG'?1:-1,risk=Math.abs(s.entry-s.sl),tgt=Math.abs(s.tp2-s.entry)/risk,cost=CFG.costPct/s.slp;
  const tE=k=>L==1?k.l<=s.entry:k.h>=s.entry,tS=k=>L==1?k.l<=s.sl:k.h>=s.sl,t1=k=>L==1?k.h>=s.tp1:k.l<=s.tp1,t2=k=>L==1?k.h>=s.tp2:k.l<=s.tp2;
  const done=(hasil,R)=>({hasil,R:+R.toFixed(3),Rnet:+(R-cost).toFixed(3)});
  let f=-1,st=0;const real=CFG.split*CFG.tp1R;
  for(let i=0;i<bars.length;i++){const k=bars[i];
    if(f<0){if(i>=CFG.fillBars)return{hasil:'TIDAK-TERISI',R:0};
      if(!tE(k)){if(t1(k))return{hasil:'BATAL',R:0};continue}
      f=i;if(tS(k))return done('SL',-1);continue}
    if(st==0){if(tS(k))return done('SL',-1);if(t1(k))st=1}
    else{if(L==1?k.l<=s.entry:k.h>=s.entry)return done('TP1+BE',real);if(t2(k))return done('TP2',real+(1-CFG.split)*tgt)}
    if(i-f>=CFG.holdBars){const rm=L*(k.c-s.entry)/risk;return done('TIMEOUT',st?real+(1-CFG.split)*rm:rm)}}
  return f<0?{hasil:bars.length>=CFG.fillBars?'TIDAK-TERISI':'MENUNGGU',R:0}:{hasil:'OPEN'};
}
export function stats(j){
  const done=j.filter(x=>['SL','TP1+BE','TP2','TIMEOUT'].includes(x.hasil));
  const sm=a=>{const n=a.length,g=a.filter(x=>x.Rnet>0).reduce((s,x)=>s+x.Rnet,0),l=-a.filter(x=>x.Rnet<=0).reduce((s,x)=>s+x.Rnet,0);
    return{n,win:n?+(a.filter(x=>x.Rnet>0).length/n*100).toFixed(1):0,avgR:n?+(a.reduce((s,x)=>s+x.Rnet,0)/n).toFixed(3):0,pf:l?+(g/l).toFixed(2):null}};
  const by=f=>{const m={};done.forEach(x=>f(x).forEach(k=>(m[k]??=[]).push(x)));return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,sm(v)]))};
  const c=h=>j.filter(x=>x.hasil===h).length;
  return{total:j.length,aktif:c('MENUNGGU')+c('OPEN'),tidakTerisi:c('TIDAK-TERISI'),batal:c('BATAL'),terisi:sm(done),
    perPemicu:by(x=>x.trig),perGrade:by(x=>[x.grade]),perSisi:by(x=>[x.side]),
    catatan:'Angka baru bermakna setelah >=100 trade terisi; ini uji maju, bukan bukti edge.'};
}
