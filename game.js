/* Wanderlit — light up the world you've travelled */
(() => {
'use strict';

/* =========================================================
   Data + rules
   ========================================================= */
const COLORS = {
  'Europe':'#7b97ff','Asia':'#ff6ba0','Africa':'#ffb23e','North America':'#2fe0c2',
  'South America':'#8de85f','Oceania':'#3ccbff','Antarctica':'#e6f0ff'
};
const GOLD = '#ffd479';
const PTS = { city:10, country:100, continent:1000 };
const RANKS = [[0,'Homebody'],[10,'Day Tripper'],[100,'Wanderer'],[300,'Backpacker'],[800,'Explorer'],
  [2000,'Globetrotter'],[4500,'Nomad'],[9000,'Cartographer'],[16000,'World Walker'],[26000,'Legend']];
const CITY_RADIUS = 2.1;                 // degrees of "painted" area around a visited city
const VIEWS = {                           // [lon, lat, zoom] used when a continent unlocks
  'Europe':[14,52,3.4],'Asia':[88,38,2.1],'Africa':[20,2,2.3],'North America':[-100,45,2.2],
  'South America':[-60,-18,2.6],'Oceania':[145,-24,2.8],'Antarctica':[0,-80,2.4]
};

const cities = CITIES.map((c,i)=>({...c,i,cont:CONTINENT[c.c]}));
const byCountry = new Map();
cities.forEach(c=>{ if(!byCountry.has(c.c)) byCountry.set(c.c,[]); byCountry.get(c.c).push(c.i); });
const contCountries = new Map();         // continent -> [countries that have cities]
byCountry.forEach((_,name)=>{ const k=CONTINENT[name]; if(!contCountries.has(k)) contCountries.set(k,[]); contCountries.get(k).push(name); });
const CONTS = [...contCountries.keys()];

const countryNeed = n => n<=3 ? n : Math.min(Math.ceil(n*0.6),5);
const contNeed = n => Math.ceil(n*0.75);

function derive(visited){
  const vc = new Map();                  // country -> visited count
  visited.forEach(i=>{ const c=cities[i].c; vc.set(c,(vc.get(c)||0)+1); });
  const countries = new Set();
  byCountry.forEach((list,name)=>{ if((vc.get(name)||0) >= countryNeed(list.length)) countries.add(name); });
  const conts = new Set();
  contCountries.forEach((list,k)=>{ if(list.filter(n=>countries.has(n)).length >= contNeed(list.length)) conts.add(k); });
  const score = visited.size*PTS.city + countries.size*PTS.country + conts.size*PTS.continent;
  return { vc, countries, conts, score };
}
const rankFor = s => RANKS.reduce((r,x)=> s>=x[0]?x:r, RANKS[0]);

/* =========================================================
   State + persistence + share codec
   ========================================================= */
const KEY='wanderlit.v1';
let visited = new Set();
let settings = { sound:true, name:'' };
let viewing = null;                       // {name, visited:Set} when looking at a shared map
try{
  const s = JSON.parse(localStorage.getItem(KEY)||'null');
  if(s){ visited = new Set((s.v||[]).filter(i=>cities[i])); Object.assign(settings,s.settings||{}); }
}catch(e){}
const save = () => { try{ localStorage.setItem(KEY, JSON.stringify({v:[...visited],settings})); }catch(e){} };

function encode(set){
  const bytes = new Uint8Array(Math.ceil(cities.length/8));
  set.forEach(i=>{ bytes[i>>3] |= 1<<(i&7); });
  let last = bytes.length; while(last>0 && bytes[last-1]===0) last--;
  return '1'+btoa(String.fromCharCode(...bytes.slice(0,last))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(str){
  try{
    if(str[0]!=='1') return null;
    const b = atob(str.slice(1).replace(/-/g,'+').replace(/_/g,'/'));
    const out = new Set();
    for(let i=0;i<b.length;i++) for(let k=0;k<8;k++) if(b.charCodeAt(i)&(1<<k)){ const id=i*8+k; if(cities[id]) out.add(id); }
    return out;
  }catch(e){ return null; }
}
function readHash(){
  const p = new URLSearchParams(location.hash.slice(1));
  const s = p.get('s'); if(!s) return null;
  const set = decode(s); if(!set) return null;
  return { visited:set, name:(p.get('n')||'').slice(0,24) };
}

const $ = id => document.getElementById(id);
const active = () => viewing ? viewing.visited : visited;     // the set currently shown
let D = derive(active());

/* =========================================================
   Map
   ========================================================= */
const svg = d3.select('#map');
const world = WORLD_TOPO;
const features = topojson.feature(world, world.objects.countries).features;
const geoms = world.objects.countries.geometries;
const featByName = new Map(features.map((f,i)=>[f.properties.name,{f,i}]));
const contOf = name => CONTINENT[name];
const totalArea = d3.sum(features,f=>d3.geoArea(f));
const areaOf = features.map(f=>d3.geoArea(f));

let W=innerWidth, H=innerHeight;
const projection = d3.geoNaturalEarth1();
const path = d3.geoPath(projection);
const sphere = {type:'Sphere'};
const graticule = d3.geoGraticule10();
let K = 1;                                 // current zoom factor

// defs
const defs = svg.append('defs');
const og = defs.append('radialGradient').attr('id','oceanGrad').attr('cx','50%').attr('cy','45%').attr('r','75%');
og.append('stop').attr('offset','0%').attr('stop-color','#0b1836');
og.append('stop').attr('offset','100%').attr('stop-color','#050a18');
Object.entries(COLORS).forEach(([k,c])=>{
  const id=k.replace(/\s/g,'');
  const g=defs.append('radialGradient').attr('id','glow-'+id);
  g.append('stop').attr('offset','0%').attr('stop-color',c).attr('stop-opacity',.95);
  g.append('stop').attr('offset','55%').attr('stop-color',c).attr('stop-opacity',.55);
  g.append('stop').attr('offset','100%').attr('stop-color',c).attr('stop-opacity',0);
  const l=defs.append('linearGradient').attr('id','lit-'+id).attr('x1',0).attr('y1',0).attr('x2',1).attr('y2',1);
  l.append('stop').attr('offset','0%').attr('stop-color',c).attr('stop-opacity',.78);
  l.append('stop').attr('offset','100%').attr('stop-color',c).attr('stop-opacity',.42);
});
const gid = k => k.replace(/\s/g,'');

const zoomG = svg.append('g');
zoomG.append('path').attr('class','ocean');
zoomG.append('path').attr('class','grat');
const landG  = zoomG.append('g');
const paintG = zoomG.append('g').attr('class','paint');
const litG   = zoomG.append('g');
const contG  = zoomG.append('g');
const nameG  = zoomG.append('g');
const dotG   = zoomG.append('g');

// land
const land = landG.selectAll('path').data(features).join('path').attr('class','land')
  .on('mouseenter',(e,f)=>hoverCountry(e,f)).on('mousemove',moveTip).on('mouseleave',()=>{ hideTip(); })
  .on('click',(e,f)=>openPanel(f.properties.name));
// hidden defs copies used for clip paths
const clipSrc = defs.append('g');
clipSrc.selectAll('path').data(features).join('path').attr('id',(f,i)=>'cp'+i);

// dots
const dots = dotG.selectAll('g').data(cities).join('g').attr('class','dot')
  .style('--c',c=>COLORS[c.cont]);
dots.append('circle').attr('class','halo').attr('r',7);
dots.append('circle').attr('class','core').attr('r',3.1);
dots.append('circle').attr('class','hit').attr('r',9);
dots.append('text').attr('x',7).attr('y',3.5).text(c=>c.n);
dots.on('click',(e,c)=>{ e.stopPropagation(); toggleCity(c.i); })
    .on('mouseenter',(e,c)=>hoverCity(e,c)).on('mousemove',moveTip).on('mouseleave',hideTip);

// largest-polygon helpers for nice zooms / labels
function largestPoly(f){
  const g=f.geometry;
  if(g.type==='Polygon') return f;
  let best=null,ba=-1;
  g.coordinates.forEach(c=>{ const p={type:'Feature',geometry:{type:'Polygon',coordinates:c}}; const a=d3.geoArea(p); if(a>ba){ba=a;best=p;} });
  return best;
}
const mainPoly = features.map(largestPoly);

function layout(){
  W=innerWidth; H=innerHeight;
  svg.attr('viewBox',`0 0 ${W} ${H}`);
  const padTop = W<960 ? 130 : 70, padBot = W<960 ? 170 : 60;
  projection.fitExtent([[W*0.02,padTop],[W*0.98,H-padBot]],sphere);
  zoomG.select('.ocean').attr('d',path(sphere));
  zoomG.select('.grat').attr('d',path(graticule));
  land.attr('d',path);
  clipSrc.selectAll('path').attr('d',(f)=>path(f));
  dots.attr('data-x',c=>c.x=projection([c.lon,c.lat])[0]).attr('data-y',c=>c.y=projection([c.lon,c.lat])[1]);
  zoom.translateExtent([[-W*0.25,-H*0.25],[W*1.25,H*1.25]]);
  applyTransform(d3.zoomTransform(svg.node()));
  paintAll(false);
}

/* ---------- zoom ---------- */
const zoom = d3.zoom().scaleExtent([1,70]).on('zoom',e=>applyTransform(e.transform));
svg.call(zoom).on('dblclick.zoom',null);
function applyTransform(t){
  K=t.k;
  zoomG.attr('transform',t);
  dots.attr('transform',c=>`translate(${c.x},${c.y}) scale(${1/K})`);
  nameG.selectAll('text').attr('transform',function(){ const d=this.__data__; return `translate(${d.x},${d.y}) scale(${1/K})`; });
  svg.classed('lv0',K<2).classed('lv1',K>=2.3).classed('lv2',K>=5.5);
}
const toScreen = (lon,lat) => { const p=projection([lon,lat]); const t=d3.zoomTransform(svg.node()); return t.apply(p); };
function flyTo(lon,lat,k,ms=1100){
  const [px,py]=projection([lon,lat]);
  const t=d3.zoomIdentity.translate(W/2,H/2+ (W<960?-40:0)).scale(k).translate(-px,-py);
  return svg.transition().duration(ms).ease(d3.easeCubicInOut).call(zoom.transform,t).end().catch(()=>{});
}
function fitPoly(f,maxK=9){
  const [[x0,y0],[x1,y1]]=path.bounds(f);
  const k=Math.max(1.4,Math.min(maxK,0.55/Math.max((x1-x0)/W,(y1-y0)/(H-120))));
  const cx=(x0+x1)/2, cy=(y0+y1)/2;
  const t=d3.zoomIdentity.translate(W/2,H/2).scale(k).translate(-cx,-cy);
  return svg.transition().duration(1500).ease(d3.easeCubicInOut).call(zoom.transform,t).end().catch(()=>{});
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* =========================================================
   Painting
   ========================================================= */
const circleGen = d3.geoCircle();
const circlePath = (c,r)=> path(circleGen.center([c.lon,c.lat]).radius(Math.max(r,0.001))());
const outlineCache = new Map();
function outlineFor(k){
  if(!outlineCache.has(k)){
    const mesh = topojson.mesh(world,world.objects.countries,(a,b)=> contOf(a.properties.name)===k && (a===b || contOf(b.properties.name)!==k));
    outlineCache.set(k,mesh);
  }
  return outlineCache.get(k);
}

let prev = { cities:new Set(), lit:new Set(), conts:new Set() };
function litSet(d){
  const s=new Set(d.countries);
  features.forEach(f=>{ if(d.conts.has(contOf(f.properties.name))) s.add(f.properties.name); });
  return s;
}

function paintAll(animate=true, newCity=null, newCountries=[], newConts=[]){
  const set = active();
  const lit = litSet(D);

  // dots
  dots.classed('on',c=>set.has(c.i));

  // city glows, clipped to their country
  const groups = new Map();
  set.forEach(i=>{ const c=cities[i]; if(!featByName.has(c.c)) return; (groups.get(c.c)||groups.set(c.c,[]).get(c.c)).push(c); });
  const gd = [...groups.entries()].map(([name,list])=>({name,list,idx:featByName.get(name).i}));
  const gsel = paintG.selectAll('g.cg').data(gd,d=>d.name);
  gsel.exit().remove();
  const genter = gsel.enter().append('g').attr('class','cg').attr('clip-path',d=>`url(#clip${d.idx})`);
  // lazily create clip paths
  gd.forEach(d=>{ if(defs.select('#clip'+d.idx).empty()) defs.append('clipPath').attr('id','clip'+d.idx).append('use').attr('href','#cp'+d.idx); });
  const all = genter.merge(gsel);
  all.each(function(d){
    const sel = d3.select(this).selectAll('path.glow').data(d.list,c=>c.i);
    sel.exit().remove();
    sel.attr('d',c=>circlePath(c,CITY_RADIUS));
    const en = sel.enter().append('path').attr('class','glow').attr('fill',c=>`url(#glow-${gid(c.cont)})`);
    if(animate){
      en.attr('d',c=>circlePath(c,0.01)).transition().duration(900).ease(d3.easeCubicOut)
        .attrTween('d',c=>t=>circlePath(c,CITY_RADIUS*Math.max(t,0.001)));
    } else en.attr('d',c=>circlePath(c,CITY_RADIUS));
  });

  // fully lit countries
  const ld = features.filter(f=>lit.has(f.properties.name));
  const lsel = litG.selectAll('path.lit').data(ld,f=>f.properties.name);
  lsel.exit().remove();
  lsel.attr('d',path);
  const len = lsel.enter().append('path').attr('class','lit').attr('d',path)
    .attr('fill',f=>`url(#lit-${gid(contOf(f.properties.name))})`)
    .attr('stroke',f=>COLORS[contOf(f.properties.name)]);
  if(animate){
    len.attr('opacity',0).classed('fresh',true).transition().duration(1300).attr('opacity',1);
  }

  // country names for lit countries
  const nd = ld.map(f=>{ const i=featByName.get(f.properties.name).i; const [x,y]=path.centroid(mainPoly[i]); return {name:f.properties.name,x,y,big:areaOf[i]>0.02}; })
    .filter(d=>isFinite(d.x));
  const nsel = nameG.selectAll('text').data(nd,d=>d.name);
  nsel.exit().remove();
  nsel.enter().append('text').attr('class',d=>'cname'+(d.big?' big':'')).text(d=>d.name).attr('font-size',d=>d.big?13:10);
  nameG.selectAll('text').each(d=>{});
  applyTransform(d3.zoomTransform(svg.node()));

  // continent outlines
  const csel = contG.selectAll('g.cont').data([...D.conts],d=>d);
  csel.exit().remove();
  const cen = csel.enter().append('g').attr('class','cont');
  cen.each(function(k){
    const m=outlineFor(k);
    const g=d3.select(this);
    g.append('path').attr('class','contLine outer').attr('d',path(m));
    g.append('path').attr('class','contLine inner').attr('d',path(m));
  });
  contG.selectAll('g.cont').each(function(k){ d3.select(this).selectAll('path').attr('d',path(outlineFor(k))); });
  if(animate) cen.style('opacity',0).transition().duration(1600).style('opacity',1);

  if(newCity!==null){
    dots.filter(c=>c.i===newCity).classed('bounce',true);
    setTimeout(()=>dots.classed('bounce',false),1000);
  }
  prev = { cities:new Set(set), lit, conts:new Set(D.conts) };
}

/* =========================================================
   FX (canvas particles) + audio
   ========================================================= */
const cv=$('fx'), cx=cv.getContext('2d');
let parts=[], rings=[], raf=0, DPR=1;
function sizeCanvas(){ DPR=Math.min(devicePixelRatio||1,2); cv.width=W*DPR; cv.height=H*DPR; cx.setTransform(DPR,0,0,DPR,0,0); }
function hexA(h,a){ const n=parseInt(h.slice(1),16); return `rgba(${n>>16},${n>>8&255},${n&255},${a})`; }
function burst(x,y,color,n,speed,life=1,grav=60){
  for(let i=0;i<n;i++){
    const a=Math.random()*6.283, s=speed*(0.25+Math.random()*0.9);
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:life*(0.6+Math.random()*0.7),age:0,color:Math.random()<.2?'#ffffff':color,size:1.2+Math.random()*2.4,g:grav});
  }
  kick();
}
function ring(x,y,color,max,dur=0.9,w=3){ rings.push({x,y,color,max,dur,age:0,w}); kick(); }
function kick(){ if(!raf) { last=performance.now(); raf=requestAnimationFrame(loop); } }
let last=0;
function loop(t){
  const dt=Math.min((t-last)/1000,0.05); last=t;
  cx.clearRect(0,0,W,H);
  cx.globalCompositeOperation='lighter';
  rings=rings.filter(r=>(r.age+=dt)<r.dur);
  rings.forEach(r=>{ const p=r.age/r.dur, e=1-Math.pow(1-p,3);
    cx.strokeStyle=hexA(r.color,(1-p)*.9); cx.lineWidth=r.w*(1-p)+.5; cx.beginPath(); cx.arc(r.x,r.y,r.max*e,0,6.283); cx.stroke(); });
  parts=parts.filter(p=>(p.age+=dt)<p.life);
  parts.forEach(p=>{
    p.vy+=p.g*dt; p.vx*=0.985; p.vy*=0.985; p.x+=p.vx*dt; p.y+=p.vy*dt;
    const a=1-p.age/p.life;
    cx.fillStyle=hexA(p.color[0]==='#'?(p.color.length===7?p.color:'#ffffff'):'#ffffff',a);
    cx.beginPath(); cx.arc(p.x,p.y,p.size*(0.4+a*.6),0,6.283); cx.fill();
    cx.fillStyle=hexA(p.color.length===7?p.color:'#ffffff',a*.18);
    cx.beginPath(); cx.arc(p.x,p.y,p.size*3.2*a,0,6.283); cx.fill();
  });
  if(parts.length||rings.length) raf=requestAnimationFrame(loop); else { raf=0; cx.clearRect(0,0,W,H); }
}
function flash(x,y,color){
  const f=$('flash'); f.style.setProperty('--fx',x+'px'); f.style.setProperty('--fy',y+'px'); f.style.setProperty('--fc',hexA(color,.55));
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}
function shake(){ const s=$('stage'); s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake'); setTimeout(()=>s.classList.remove('shake'),520); }
function fireworks(color,n=9){
  for(let i=0;i<n;i++) setTimeout(()=>{
    const x=W*(0.12+Math.random()*0.76), y=H*(0.12+Math.random()*0.5);
    const c=Math.random()<.55?GOLD:(Math.random()<.5?color:'#ffffff');
    burst(x,y,c,70,220,1.5,90); ring(x,y,c,60+Math.random()*50,.8,2);
  }, i*230);
}

// audio
let ac=null;
function tone(f,t0,dur,type='sine',vol=.12){
  if(!settings.sound) return;
  try{
    ac=ac||new (window.AudioContext||window.webkitAudioContext)();
    if(ac.state==='suspended') ac.resume();
    const o=ac.createOscillator(), g=ac.createGain();
    o.type=type; o.frequency.value=f;
    const t=ac.currentTime+t0;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+.015); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t+dur+.05);
  }catch(e){}
}
const N = s => 440*Math.pow(2,(s-9)/12);                  // semitones from C4
const sfx = {
  city(){ const b=[0,4,7,12][Math.floor(Math.random()*4)]; tone(N(b+12),0,.5,'triangle',.11); tone(N(b+19),.07,.6,'sine',.07); },
  country(){ [0,4,7,12,16].forEach((s,i)=>tone(N(s+12),i*.085,.9,'triangle',.1)); tone(N(0),0,1.3,'sine',.08); },
  continent(){ [0,7,12,16,19,24].forEach((s,i)=>tone(N(s+12),i*.11,1.6,'triangle',.11)); [0,7,12].forEach(s=>tone(N(s),.3,2.2,'sawtooth',.04)); },
  remove(){ tone(N(5),0,.25,'sine',.06); }
};

/* =========================================================
   Game actions
   ========================================================= */
function toast(html,color){
  const el=document.createElement('div'); el.className='toast'; el.style.setProperty('--c',color||GOLD); el.innerHTML=html;
  $('toasts').appendChild(el); setTimeout(()=>el.remove(),2700);
  while($('toasts').children.length>3) $('toasts').firstChild.remove();
}
function banner(kicker,title,sub,color,cont=false){
  const b=$('banner'); b.className=''; void b.offsetWidth;
  b.style.setProperty('--c',color);
  b.querySelector('.k').textContent=kicker; b.querySelector('.t').textContent=title; b.querySelector('.s').textContent=sub;
  b.className='go'+(cont?' cont':'');
}

let busy=false;
async function toggleCity(i, {fly=false}={}){
  if(viewing) return;
  const c=cities[i];
  if(visited.has(i)){                    // un-visit (quiet)
    visited.delete(i); sfx.remove();
    D=derive(visited); paintAll(false); updateHud(); refreshPanel(); save(); return;
  }
  const before=D;
  const [sx,sy]=toScreen(c.lon,c.lat);
  const offscreen = sx<40||sx>W-40||sy<90||sy>H-40;
  if(fly||offscreen){ busy=true; await flyTo(c.lon,c.lat,Math.max(K,Math.min(4.5,K<3?4.5:K)),1000); busy=false; }
  visited.add(i);
  const after=derive(visited); D=after;
  const newCountries=[...after.countries].filter(n=>!before.countries.has(n));
  const newConts=[...after.conts].filter(n=>!before.conts.has(n));
  paintAll(true,i,newCountries,newConts);
  celebrate(c,newCountries,newConts);
  updateHud(true); refreshPanel(); save();
  $('searchWrap').classList.add('has');
}

async function celebrate(c,newCountries,newConts){
  const [x,y]=toScreen(c.lon,c.lat);
  const col=COLORS[c.cont];
  burst(x,y,col,36,150,1.0); ring(x,y,col,46,.8); ring(x,y,'#ffffff',26,.55,2);
  sfx.city();
  toast(`✦ ${c.n}<b>+${PTS.city}</b>`,col);

  if(newCountries.length){
    const name=newCountries[0];
    setTimeout(async()=>{
      sfx.country();
      burst(x,y,col,150,300,1.4,80); ring(x,y,col,150,1.1,4); ring(x,y,GOLD,90,.9,3);
      flash(x,y,col);
      banner('Country unlocked',name,`+${PTS.country} pts`,col);
      toast(`⚑ ${name} unlocked<b>+${PTS.country}</b>`,col);
      const f=featByName.get(name);
      if(!newConts.length){ await sleep(500); fitPoly(mainPoly[f.i],7); }
    },420);
  }
  if(newConts.length){
    const k=newConts[0];
    setTimeout(async()=>{
      sfx.continent(); shake();
      const v=VIEWS[k]; await flyTo(v[0],v[1],v[2],1500);
      flash(W/2,H/2,GOLD);
      banner('Continent unlocked',k,`+${PTS.continent} pts`,GOLD,true);
      toast(`🌍 ${k} unlocked<b>+${PTS.continent}</b>`,GOLD);
      fireworks(COLORS[k],11);
      if(D.conts.size===CONTS.length) setTimeout(()=>{ banner('World complete','Earth, lit','You have seen it all',GOLD,true); fireworks(GOLD,16); },3600);
    },newCountries.length?1700:420);
  }
}

/* =========================================================
   HUD
   ========================================================= */
let shown=0, scoreAnim=0;
function countTo(target){
  cancelAnimationFrame(scoreAnim);
  const from=shown, t0=performance.now(), dur=Math.min(1400,300+Math.abs(target-from)*3);
  const step=t=>{ const p=Math.min((t-t0)/dur,1), e=1-Math.pow(1-p,3); shown=Math.round(from+(target-from)*e);
    $('scoreNum').textContent=shown.toLocaleString(); if(p<1) scoreAnim=requestAnimationFrame(step); };
  scoreAnim=requestAnimationFrame(step);
}
function updateHud(pop=false){
  const set=active(), score=D.score;
  countTo(score);
  if(pop){ const n=$('scoreNum'); n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
  const lit=litSet(D); let area=0; features.forEach((f,i)=>{ if(lit.has(f.properties.name)) area+=areaOf[i]; });
  const earth=area/totalArea*100;
  const nCountries=byCountry.size;
  $('stCities').textContent=`${set.size} / ${cities.length}`; $('barCities').style.width=(set.size/cities.length*100)+'%';
  $('stCountries').textContent=`${D.countries.size} / ${nCountries}`; $('barCountries').style.width=(D.countries.size/nCountries*100)+'%';
  $('stConts').textContent=`${D.conts.size} / ${CONTS.length}`; $('barConts').style.width=(D.conts.size/CONTS.length*100)+'%';
  $('stEarth').textContent=earth.toFixed(earth<10?1:0)+'%'; $('barEarth').style.width=Math.min(100,earth)+'%';
  const r=rankFor(score); $('rank').textContent=r[1];
  // next goal: closest country to unlocking, else closest continent
  let best=null;
  byCountry.forEach((list,name)=>{
    if(D.countries.has(name)) return;
    const need=countryNeed(list.length), have=D.vc.get(name)||0;
    if(have>0 && (!best || need-have<best.left || (need-have===best.left && have>best.have))) best={name,left:need-have,have,need};
  });
  const nx=$('next');
  if(viewing) nx.innerHTML='Viewing a shared map';
  else if(!set.size) nx.innerHTML='Search the first city you\'ve ever travelled to.';
  else if(best) nx.innerHTML=`<b>${best.left} more ${best.left===1?'city':'cities'}</b> in ${best.name} to unlock the whole country.`;
  else nx.innerHTML='Keep exploring — whole continents are within reach.';
}

/* =========================================================
   Tooltips + country panel
   ========================================================= */
const tip=$('tip');
function moveTip(e){ tip.style.left=Math.min(e.clientX,W-200)+'px'; tip.style.top=Math.min(e.clientY,H-80)+'px'; }
function hideTip(){ tip.classList.remove('show'); }
function countryLine(name){
  const list=byCountry.get(name); if(!list) return CONTINENT[name] ? `<span>${CONTINENT[name]}${D.conts.has(CONTINENT[name])?' · unlocked':''}</span>` : '';
  const have=D.vc.get(name)||0, need=countryNeed(list.length);
  return D.countries.has(name) ? '<span>Unlocked ✓</span>' : `<span>${have} / ${need} cities to unlock</span>`;
}
function hoverCountry(e,f){ const n=f.properties.name; tip.innerHTML=`<b>${n}</b><br>${countryLine(n)}`; tip.classList.add('show'); moveTip(e); }
function hoverCity(e,c){ tip.innerHTML=`<b>${c.n}</b><br><span>${c.c}${visitedHas(c.i)?' · visited':' · click to add'}</span>`; tip.classList.add('show'); moveTip(e); }
const visitedHas = i => active().has(i);

let panelCountry=null;
function openPanel(name){
  if(!byCountry.has(name)){ closePanel(); return; }
  panelCountry=name; refreshPanel(); $('panel').classList.add('open'); $('panel').setAttribute('aria-hidden','false');
}
function closePanel(){ panelCountry=null; $('panel').classList.remove('open'); $('panel').setAttribute('aria-hidden','true'); }
function refreshPanel(){
  if(!panelCountry) return;
  const name=panelCountry, list=byCountry.get(name), cont=CONTINENT[name], col=COLORS[cont];
  const p=$('panel'); p.style.setProperty('--c',col);
  $('pTag').textContent=cont; $('pName').textContent=name;
  const have=D.vc.get(name)||0, need=countryNeed(list.length);
  $('pBar').style.width=Math.min(100,have/need*100)+'%';
  $('pText').textContent = D.countries.has(name) ? `Country unlocked — ${have} of ${list.length} cities` : `${have} / ${need} cities to unlock this country`;
  const box=$('pChips'); box.innerHTML='';
  list.forEach(i=>{ const b=document.createElement('button'); b.textContent=cities[i].n; b.className=active().has(i)?'on':'';
    b.onclick=()=>toggleCity(i); box.appendChild(b); });
}
$('panelClose').onclick=closePanel;
svg.on('click.bg',e=>{ if(e.target===svg.node()||e.target.classList.contains('ocean')||e.target.classList.contains('grat')) closePanel(); });

/* =========================================================
   Search
   ========================================================= */
const q=$('q'), results=$('results');
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const index = cities.map(c=>({c,k:norm(c.n),k2:norm(c.c)}));
let sel=0, matches=[];
function runSearch(){
  const v=norm(q.value.trim()); results.innerHTML=''; matches=[];
  if(!v) return;
  matches = index.map(o=>{ let s=0;
    if(o.k===v) s=100; else if(o.k.startsWith(v)) s=80; else if(o.k.split(/[\s-]/).some(w=>w.startsWith(v))) s=60;
    else if(o.k.includes(v)) s=40; else if(o.k2.startsWith(v)) s=20; else if(o.k2.includes(v)) s=10;
    return {o,s}; }).filter(x=>x.s).sort((a,b)=>b.s-a.s||a.o.k.localeCompare(b.o.k)).slice(0,7).map(x=>x.o.c);
  sel=0;
  matches.forEach((c,n)=>{
    const li=document.createElement('li'); li.style.setProperty('--c',COLORS[c.cont]);
    li.innerHTML=`<span class="sw"></span>${c.n}${visited.has(c.i)?' <em>visited</em>':''}<small>${c.c}</small>`;
    li.onmousedown=e=>{ e.preventDefault(); pick(c); };
    li.onmouseenter=()=>{ sel=n; hl(); };
    results.appendChild(li);
  });
  hl();
}
function hl(){ [...results.children].forEach((li,n)=>li.classList.toggle('sel',n===sel)); }
async function pick(c){
  q.value=''; results.innerHTML=''; q.blur();
  if(viewing){ await flyTo(c.lon,c.lat,5); return; }
  if(visited.has(c.i)){ await flyTo(c.lon,c.lat,5); toast(`${c.n} is already lit`,COLORS[c.cont]); return; }
  await toggleCity(c.i,{fly:true});
}
q.addEventListener('input',runSearch);
q.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){ sel=Math.min(sel+1,matches.length-1); hl(); e.preventDefault(); }
  else if(e.key==='ArrowUp'){ sel=Math.max(sel-1,0); hl(); e.preventDefault(); }
  else if(e.key==='Enter'&&matches[sel]) pick(matches[sel]);
  else if(e.key==='Escape'){ q.value=''; results.innerHTML=''; q.blur(); }
});
q.addEventListener('blur',()=>setTimeout(()=>{ results.innerHTML=''; },120));
addEventListener('keydown',e=>{ if(e.key==='/'&&document.activeElement!==q&&document.activeElement.tagName!=='INPUT'){ e.preventDefault(); q.focus(); } if(e.key==='Escape'){ closePanel(); closeModal(); } });
document.querySelectorAll('#hint button').forEach(b=>b.onclick=()=>{ const c=cities.find(c=>c.n===b.dataset.try); if(c) pick(c); });

/* ---------- dock ---------- */
$('btnZoomIn').onclick=()=>svg.transition().duration(350).call(zoom.scaleBy,1.7);
$('btnZoomOut').onclick=()=>svg.transition().duration(350).call(zoom.scaleBy,1/1.7);
$('btnHome').onclick=()=>svg.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform,d3.zoomIdentity);
$('btnSound').onclick=()=>{ settings.sound=!settings.sound; $('btnSound').classList.toggle('off',!settings.sound); save(); if(settings.sound) sfx.city(); };
$('btnSound').classList.toggle('off',!settings.sound);

/* =========================================================
   Sharing
   ========================================================= */
function shareUrl(){
  const base=location.href.split('#')[0];
  const name=($('shareName').value||settings.name||'').trim();
  const p=new URLSearchParams(); p.set('s',encode(visited)); if(name) p.set('n',name);
  return base+'#'+p.toString();
}
function shareMessage(){
  const name=($('shareName').value||settings.name||'').trim();
  const r=rankFor(D.score)[1];
  return `${name?name+' has':"I've"} lit up ${visited.size} ${visited.size===1?'city':'cities'}, ${D.countries.size} ${D.countries.size===1?'country':'countries'} and ${D.conts.size} ${D.conts.size===1?'continent':'continents'} on Wanderlit — ${D.score.toLocaleString()} pts (${r}). Can you beat it?`;
}
function drawCard(canvas){
  const w=canvas.width, h=canvas.height, g=canvas.getContext('2d');
  const bg=g.createRadialGradient(w/2,h*.55,50,w/2,h*.55,w*.7); bg.addColorStop(0,'#0f2250'); bg.addColorStop(1,'#04060f');
  g.fillStyle=bg; g.fillRect(0,0,w,h);
  for(let i=0;i<140;i++){ g.fillStyle=`rgba(190,210,255,${Math.random()*.5})`; g.fillRect(Math.random()*w,Math.random()*h,1.4,1.4); }
  const pr=d3.geoNaturalEarth1().fitExtent([[40,150],[w-40,h-70]],sphere), pa=d3.geoPath(pr,g);
  g.beginPath(); pa(sphere); g.fillStyle='rgba(14,33,71,.55)'; g.fill(); g.strokeStyle='rgba(124,240,212,.25)'; g.lineWidth=1.2; g.stroke();
  const lit=litSet(D);
  features.forEach(f=>{ g.beginPath(); pa(f); g.fillStyle='#1a2b55'; g.fill(); g.strokeStyle='#3a5288'; g.lineWidth=.6; g.stroke(); });
  g.save(); g.globalCompositeOperation='lighter';
  active().forEach(i=>{ const c=cities[i]; const [x,y]=pr([c.lon,c.lat]); const rad=g.createRadialGradient(x,y,0,x,y,24);
    rad.addColorStop(0,hexA(COLORS[c.cont],.9)); rad.addColorStop(1,hexA(COLORS[c.cont],0)); g.fillStyle=rad; g.beginPath(); g.arc(x,y,24,0,6.283); g.fill(); });
  g.restore();
  features.forEach(f=>{ if(!lit.has(f.properties.name)) return; const col=COLORS[contOf(f.properties.name)];
    g.beginPath(); pa(f); g.fillStyle=hexA(col,.62); g.fill(); g.strokeStyle=col; g.lineWidth=1; g.stroke(); });
  D.conts.forEach(k=>{ g.beginPath(); pa(outlineFor(k)); g.strokeStyle='rgba(255,212,121,.35)'; g.lineWidth=7; g.lineJoin='round'; g.stroke(); g.strokeStyle='#ffe9b0'; g.lineWidth=1.8; g.stroke(); });
  active().forEach(i=>{ const c=cities[i]; const [x,y]=pr([c.lon,c.lat]); g.fillStyle='#fff'; g.beginPath(); g.arc(x,y,2.2,0,6.283); g.fill(); });
  // text
  const name=viewing?viewing.name:($('shareName')?.value||settings.name||'').trim();
  g.textBaseline='alphabetic';
  g.font='800 34px Sora, Inter, sans-serif'; const tg=g.createLinearGradient(40,0,300,0); tg.addColorStop(0,'#fff'); tg.addColorStop(1,'#ffd479');
  g.fillStyle=tg; g.fillText('Wanderlit',40,66);
  g.font='500 18px Inter, sans-serif'; g.fillStyle='#8c97b8'; g.fillText(name?`${name}'s map`:'my travel map',42,96);
  g.textAlign='right';
  g.font='800 72px Sora, Inter, sans-serif'; g.fillStyle='#fff'; g.fillText(D.score.toLocaleString(),w-40,84);
  g.font='700 15px Sora, Inter, sans-serif'; g.fillStyle='#ffd479'; g.fillText(rankFor(D.score)[1].toUpperCase()+'  ·  PTS',w-42,114);
  g.textAlign='left'; g.font='600 20px Inter, sans-serif'; g.fillStyle='#dbe3ff';
  g.fillText(`${active().size} ${active().size===1?'city':'cities'}   ·   ${D.countries.size} ${D.countries.size===1?'country':'countries'}   ·   ${D.conts.size} ${D.conts.size===1?'continent':'continents'}`,40,h-26);
  g.textAlign='right'; g.fillStyle='#7cf0d4'; g.font='600 18px Inter, sans-serif';
  g.fillText(location.host? location.host+location.pathname.replace(/index\.html$/,'') : 'Can you beat it?',w-40,h-26);
  g.textAlign='left';
}
function openModal(){
  $('shareName').value=settings.name||'';
  refreshShare(); $('modal').hidden=false;
}
function closeModal(){ $('modal').hidden=true; }
function refreshShare(){
  drawCard($('cardPreview'));
  $('shareText').textContent=shareMessage();
  $('shareLink').value=shareUrl();
  $('btnNative').hidden=!navigator.share;
}
$('btnShare').onclick=()=>{ if(viewing) return; if(!visited.size){ toast('Light up a city first ✦',COLORS['Asia']); q.focus(); return; } openModal(); };
$('modalClose').onclick=closeModal;
$('modal').addEventListener('mousedown',e=>{ if(e.target===$('modal')) closeModal(); });
$('shareName').addEventListener('input',()=>{ settings.name=$('shareName').value.trim(); save(); refreshShare(); });
$('btnCopy').onclick=async()=>{
  const text=`${shareMessage()}\n${shareUrl()}`;
  try{ await navigator.clipboard.writeText(text); }catch(e){ $('shareLink').select(); document.execCommand('copy'); }
  $('btnCopy').textContent='Copied ✓'; setTimeout(()=>$('btnCopy').textContent='Copy link',1800);
};
$('btnNative').onclick=()=>navigator.share({title:'Wanderlit',text:shareMessage(),url:shareUrl()}).catch(()=>{});
$('btnImage').onclick=()=>{ const a=document.createElement('a'); a.download='wanderlit.png'; a.href=$('cardPreview').toDataURL('image/png'); a.click(); };

/* ---------- shared-view mode ---------- */
function enterViewing(v){
  viewing=v; D=derive(v.visited);
  const nm=v.name||'A traveller';
  $('ribbon').hidden=false;
  $('ribbonText').innerHTML=`<b>${nm.replace(/[<>&]/g,'')}</b>'s map · ${D.score.toLocaleString()} pts — can you beat it?`;
  $('btnShare').hidden=true; $('searchWrap').classList.add('has'); closePanel();
  paintAll(false); updateHud(); shown=0; countTo(D.score);
}
function exitViewing(){
  viewing=null; history.replaceState(null,'',location.pathname+location.search);
  $('ribbon').hidden=true; $('btnShare').hidden=false;
  D=derive(visited); paintAll(false); updateHud(); shown=0; countTo(D.score);
  $('searchWrap').classList.toggle('has',visited.size>0);
}
$('ribbonBtn').onclick=exitViewing;
addEventListener('hashchange',()=>{ const v=readHash(); if(v) enterViewing(v); else if(viewing) exitViewing(); });

/* =========================================================
   Boot
   ========================================================= */
function boot(){
  layout(); sizeCanvas();
  updateHud();
  $('searchWrap').classList.toggle('has',visited.size>0);
  const v=readHash(); if(v) enterViewing(v);
  // little entrance: sweep unlocked layers in
  litG.style('opacity',0).transition().duration(1200).style('opacity',1);
  paintG.style('opacity',0).transition().duration(1200).style('opacity',1);
  let rt; addEventListener('resize',()=>{ clearTimeout(rt); rt=setTimeout(()=>{ layout(); sizeCanvas(); },120); });
}
boot();
window.__wanderlit = { visited, cities, toggleCity, derive, get D(){return D;} };   // handy for debugging
})();
