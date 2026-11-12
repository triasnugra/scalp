import fs from'node:fs';import{CFG,analyze,resolve,stats,trend}from'../lib/engine.mjs';
const HOSTS=['https://data-api.binance.vision','https://api.binance.com','https://api1.binance.com','https://api2.binance.com'];
const IV={'1h':36e5,'4h':144e5,'1d':864e5},STABLE=/^(USDC|FDUSD|TUSD|USDP|DAI|EUR|AEUR|USDE|XUSD|BFUSD|PAXG)USDT$/;
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v));
async function get(p){let e;for(let t=0;t<2;t++)for(const h of HOSTS){try{const r=await fetch(h+p,{signal:AbortSignal.timeout(15000)});if(r.ok)return await r.json();e=h+' '+r.status}catch(x){e=x.message}}throw new Error(e)}
async function kl(s,iv,n){const now=Date.now();return(await get(`/api/v3/klines?symbol=${s}&interval=${iv}&limit=${n}`)).map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})).filter(k=>k.t+IV[iv]<=now)}
async function pool(a,n,f){const o=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<a.length){const j=i++;try{o[j]=await f(a[j])}catch{o[j]=null}}}));return o}
Object.assign(CFG,read('config.json',{}));fs.mkdirSync('data',{recursive:true});
const journal=read('data/journal.json',[]),now=Date.now();let tick;
try{tick=await get('/api/v3/ticker/24hr')}catch(e){write('data/report.json',{...read('data/report.json',{}),status:'gagal ambil data: '+e.message,checkedAt:new Date().toISOString()});console.log('gagal',e.message);process.exit(0)}
let uni=tick.filter(x=>x.symbol.endsWith('USDT')&&!STABLE.test(x.symbol)&&+x.quoteVolume>=CFG.minQv).sort((a,b)=>b.quoteVolume-a.quoteVolume).map(x=>x.symbol).slice(0,CFG.topN);
if(!uni.includes('BTCUSDT'))uni.unshift('BTCUSDT');
const act=j=>j.hasil==='MENUNGGU'||j.hasil==='OPEN',all=[...new Set([...uni,...journal.filter(act).map(j=>j.sym)])];
const map={};(await pool(all,5,async s=>({s,d1:await kl(s,'1d',120),h4:await kl(s,'4h',150),h1:await kl(s,'1h',250)}))).forEach(x=>x&&(map[x.s]=x));
const b=map.BTCUSDT;if(!b){write('data/report.json',{...read('data/report.json',{}),status:'gagal: data BTC kosong',checkedAt:new Date().toISOString()});process.exit(0)}
const btc={t1:trend(b.d1),t4:trend(b.h4),mv6:(b.h1.at(-1).c/b.h1.at(-7).c-1)*100};
for(const j of journal.filter(act)){const m=map[j.sym];if(m)Object.assign(j,resolve(j,m.h1.filter(k=>k.t>=j.t)))}
const rejects={},cands=[];let scanned=0;
for(const s of uni){const m=map[s];if(!m){rejects['data-gagal']=(rejects['data-gagal']||0)+1;continue}scanned++;
  const r=analyze(s,m.d1,m.h4,m.h1,s==='BTCUSDT'?null:btc,now);
  if(r.sig)cands.push(r.sig);else rejects[r.rej]=(rejects[r.rej]||0)+1}
cands.sort((a,b)=>b.score-a.score);const ids=new Set(journal.map(j=>j.id)),side={LONG:0,SHORT:0},picked=[];
for(const c of cands){
  if(ids.has(c.id)){rejects['sudah-tercatat']=(rejects['sudah-tercatat']||0)+1;continue}
  if(journal.some(j=>j.sym===c.sym&&act(j))){rejects['posisi-aktif']=(rejects['posisi-aktif']||0)+1;continue}
  if(journal.some(j=>j.sym===c.sym&&j.hasil==='SL'&&c.t-j.t<CFG.cooldownH*36e5)){rejects['cooldown-sl']=(rejects['cooldown-sl']||0)+1;continue}
  if(picked.length>=CFG.maxPerRun||side[c.side]>=CFG.maxPerSide){rejects['batas-portofolio']=(rejects['batas-portofolio']||0)+1;continue}
  side[c.side]++;picked.push(c)}
journal.push(...picked);const out=journal.slice(-1500);
write('data/journal.json',out);write('data/signals.json',out.filter(act).sort((a,b)=>b.score-a.score));
write('data/report.json',{status:'ok',generatedAt:new Date(now).toISOString(),btc,funnel:{universe:uni.length,scanned,candidates:cands.length,published:picked.length,rejects},stats:stats(out),minScore:CFG.minScore});
console.log(`pindai ${scanned}, kandidat ${cands.length}, baru ${picked.length}`);
