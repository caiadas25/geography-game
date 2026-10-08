/* Constellate — connect the places you've been */
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
const PTS = { city:10, minor:5, country:100, continent:1000 };
const MINOR_W = 0.5;                     // a minor city (flag m:1) counts half towards unlocking its country
const ptsOf = c => c.m ? PTS.minor : PTS.city;
const RANKS = [[0,'Homebody'],[10,'Day Tripper'],[100,'Wanderer'],[300,'Backpacker'],[800,'Explorer'],
  [2000,'Globetrotter'],[4500,'Nomad'],[9000,'Cartographer'],[16000,'World Walker'],[26000,'Legend']];
const HIT_R = 16;                        // max click radius (screen px) around a city dot
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

const countryNeedN = n => n<=3 ? n : Math.min(Math.ceil(n*0.6),5);
// the bar is set by a country's major cities only, so adding minor ones never makes a country harder to unlock
const countryNeed = name => { const list=byCountry.get(name), majors=list.filter(i=>!cities[i].m).length; return countryNeedN(majors||list.length); };
const fmt = x => Number.isInteger(x) ? x : x.toFixed(1);
const contNeed = n => Math.ceil(n*0.75);

function derive(visited){
  const vc = new Map();                  // country -> visited count
  let pts=0;
  visited.forEach(i=>{ const c=cities[i]; vc.set(c.c,(vc.get(c.c)||0)+(c.m?MINOR_W:1)); pts+=ptsOf(c); });
  const countries = new Set();
  byCountry.forEach((list,name)=>{ if((vc.get(name)||0) >= countryNeed(name)) countries.add(name); });
  const conts = new Set();
  contCountries.forEach((list,k)=>{ if(list.filter(n=>countries.has(n)).length >= contNeed(list.length)) conts.add(k); });
  const score = pts + countries.size*PTS.country + conts.size*PTS.continent;
  return { vc, countries, conts, score };
}
const rankFor = s => RANKS.reduce((r,x)=> s>=x[0]?x:r, RANKS[0]);

/* =========================================================
   State + persistence + share codec
   ========================================================= */
const KEY='wanderlit.v1';
let visited = new Set();
let settings = { sound:true, name:'', cardStyle:'starfield' };
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
  const soft=d3.interpolateRgb(c,'#ffffff');
  g.append('stop').attr('offset','0%').attr('stop-color',soft(.85)).attr('stop-opacity',.85);
  g.append('stop').attr('offset','30%').attr('stop-color',soft(.6)).attr('stop-opacity',.5);
  g.append('stop').attr('offset','65%').attr('stop-color',soft(.35)).attr('stop-opacity',.2);
  g.append('stop').attr('offset','100%').attr('stop-color',c).attr('stop-opacity',0);
  const l=defs.append('linearGradient').attr('id','lit-'+id).attr('x1',0).attr('y1',0).attr('x2',1).attr('y2',1);
  l.append('stop').attr('offset','0%').attr('stop-color',soft(.6)).attr('stop-opacity',.5);
  l.append('stop').attr('offset','100%').attr('stop-color',soft(.35)).attr('stop-opacity',.3);
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
dots.append('circle').attr('class','hit').attr('r',HIT_R);
// Vatican City is nudged west of Rome so the two dots can be told apart; its label goes on the left
const LEFT_LABEL = new Set(['Vatican City']);
dots.append('text').attr('x',c=>LEFT_LABEL.has(c.n)?-7:7).attr('y',3.5).style('text-anchor',c=>LEFT_LABEL.has(c.n)?'end':null).text(c=>c.n);
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

let geomDirty=true;                       // projected geometry must be rebuilt (layout/resize); otherwise paintAll leaves existing paths alone
function layout(){
  W=innerWidth; H=innerHeight;
  svg.attr('viewBox',`0 0 ${W} ${H}`);
  const padTop = W<960 ? 130 : 70, padBot = W<960 ? 170 : 60;
  projection.fitExtent([[W*0.02,padTop],[W*0.98,H-padBot]],sphere);
  zoomG.select('.ocean').attr('d',path(sphere));
  zoomG.select('.grat').attr('d',path(graticule));
  land.attr('d',path);
  clipSrc.selectAll('path').attr('d',(f)=>path(f));
  geomDirty=true;
  cities.forEach(c=>{ const p=projection([c.lon,c.lat]); c.x=p[0]; c.y=p[1]; });
  // nearest neighbour within 2*HIT_R, via a spatial grid (only crowding below that matters for click areas)
  const CELL=HIT_R*2, grid=new Map(), key=(i,j)=>i*100003+j;
  cities.forEach(c=>{ const k=key(Math.floor(c.x/CELL),Math.floor(c.y/CELL)); (grid.get(k)||grid.set(k,[]).get(k)).push(c); });
  cities.forEach(a=>{ let m=CELL; const gi=Math.floor(a.x/CELL), gj=Math.floor(a.y/CELL);
    for(let i=gi-1;i<=gi+1;i++) for(let j=gj-1;j<=gj+1;j++){ const l=grid.get(key(i,j)); if(l) for(const b of l){ if(b!==a){ const d=Math.hypot(a.x-b.x,a.y-b.y); if(d<m) m=d; } } }
    a.near=m; });
  dots.sort((a,b)=>b.i-a.i);              // earlier (bigger) cities sit on top of near-duplicates
  zoom.translateExtent([[-W*0.25,-H*0.25],[W*1.25,H*1.25]]);
  applyTransform(d3.zoomTransform(svg.node()));
  paintAll(false);
}

/* ---------- zoom ---------- */
const zoom = d3.zoom().scaleExtent([1,70]).on('zoom',e=>scheduleTransform(e.transform));
svg.call(zoom).on('dblclick.zoom',null);
let dotNodes=null;
function applyTransform(t){
  K=t.k;
  zoomG.attr('transform',t);
  if(!dotNodes) dotNodes=dots.nodes();
  const m=40, x0=-m, x1=W+m, y0=-m, y1=H+m;
  for(let n=0;n<dotNodes.length;n++){            // only touch dots that are on screen
    const el=dotNodes[n], c=el.__data__, sx=t.x+t.k*c.x, sy=t.y+t.k*c.y;
    if(!(sx>x0&&sx<x1&&sy>y0&&sy<y1)){ if(c.vis!==false){ el.style.display='none'; c.vis=false; } continue; }
    if(c.vis!==true){ el.style.display=''; c.vis=true; }
    el.setAttribute('transform',`translate(${c.x.toFixed(2)},${c.y.toFixed(2)}) scale(${(1/K).toFixed(4)})`);
    const r=Math.max(3,Math.min(HIT_R,c.near*K/2));   // shrink the click area where cities crowd
    if(c.hr===undefined||Math.abs(r-c.hr)>0.4){ c.hr=r; el.lastElementChild.previousElementSibling.setAttribute('r',r.toFixed(1)); }
  }
  nameG.selectAll('text').attr('transform',function(){ const d=this.__data__; return `translate(${d.x},${d.y}) scale(${1/K})`; });
  const f=Math.max(1,1100/W);             // narrower screens need more zoom before labels stop colliding
  svg.classed('lv0',K<2).classed('lv1',K>=2.3*f).classed('lv2',K>=8*f).classed('lv3',K>=22*f);
}
let pendingT=null, tRaf=0;                // coalesce wheel/drag events into one update per frame
function scheduleTransform(t){ pendingT=t; if(!tRaf) tRaf=requestAnimationFrame(()=>{ tRaf=0; applyTransform(pendingT); }); }
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
const radiusOf = c => c.m ? CITY_RADIUS*0.5 : CITY_RADIUS;      // minor cities light a smaller patch
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
  dots.classed('on',c=>set.has(c.i)).classed('minor',c=>!!c.m);

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
    if(geomDirty) sel.attr('d',c=>circlePath(c,radiusOf(c)));
    const en = sel.enter().append('path').attr('class','glow').attr('fill',c=>`url(#glow-${gid(c.cont)})`);
    if(animate){
      // light blooms out with an overshoot, then settles; a white-hot flash fades behind it
      en.classed('fresh',true).attr('d',c=>circlePath(c,0.01)).transition().duration(1700).ease(d3.easeBackOut.overshoot(2.6))
        .attrTween('d',c=>t=>circlePath(c,radiusOf(c)*Math.max(t,0.001)))
        .on('end',function(){ d3.select(this).classed('fresh',false); });
    } else en.attr('d',c=>circlePath(c,radiusOf(c)));
  });

  // fully lit countries
  const ld = features.filter(f=>lit.has(f.properties.name));
  const lsel = litG.selectAll('path.lit').data(ld,f=>f.properties.name);
  lsel.exit().remove();
  if(geomDirty) lsel.attr('d',path);
  const len = lsel.enter().append('path').attr('class','lit').attr('d',path)
    .attr('fill',f=>`url(#lit-${gid(contOf(f.properties.name))})`)
    .attr('stroke',f=>COLORS[contOf(f.properties.name)]);
  if(animate){
    len.attr('opacity',0).classed('fresh',true).transition().duration(1300).attr('opacity',1);
  }

  // country names for lit countries
  const nd = ld.map(f=>{ const i=featByName.get(f.properties.name).i; const [x,y]=path.centroid(mainPoly[i]); return {name:f.properties.name,x,y,big:areaOf[i]>0.02,area:areaOf[i]}; })
    .filter(d=>isFinite(d.x) && d.area>5e-7);
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
  if(geomDirty) contG.selectAll('g.cont').each(function(k){ d3.select(this).selectAll('path').attr('d',path(outlineFor(k))); });
  if(animate) cen.style('opacity',0).transition().duration(1600).style('opacity',1);

  if(newCity!==null){
    dots.filter(c=>c.i===newCity).classed('bounce',true);
    setTimeout(()=>dots.classed('bounce',false),1000);
  }
  prev = { cities:new Set(set), lit, conts:new Set(D.conts) };
  geomDirty=false;
}

/* =========================================================
   FX (canvas particles) + audio
   ========================================================= */
const cv=$('fx'), cx=cv.getContext('2d');
let parts=[], rings=[], stars=[], raf=0, DPR=1;
function sizeCanvas(){ DPR=Math.min(devicePixelRatio||1,2); cv.width=W*DPR; cv.height=H*DPR; cx.setTransform(DPR,0,0,DPR,0,0); }
function hexA(h,a){ const n=parseInt(h.slice(1),16); return `rgba(${n>>16},${n>>8&255},${n&255},${a})`; }
function burst(x,y,color,n,speed,life=1,grav=60){
  for(let i=0;i<n;i++){
    const a=Math.random()*6.283, s=speed*(0.25+Math.random()*0.9);
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:life*(0.6+Math.random()*0.7),age:0,color:Math.random()<.2?'#ffffff':color,size:1.2+Math.random()*2.4,g:grav});
  }
  kick();
}
function starBurst(x,y,color,n=14){
  for(let i=0;i<n;i++){
    const a=-Math.PI/2+(Math.random()-.5)*2.2, sp=110+Math.random()*190;   // mostly upward, fanned out
    stars.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,rot:Math.random()*6.283,spin:(Math.random()-.5)*9,
      size:3.5+Math.random()*4.5,life:1.0+Math.random()*0.7,age:0,color:Math.random()<.35?'#ffffff':(Math.random()<.4?GOLD:color)});
  }
  kick();
}
function drawStar(x,y,r,rot){
  cx.beginPath();
  for(let i=0;i<10;i++){ const rr=i%2?r*0.42:r, a=rot+i*Math.PI/5-Math.PI/2; cx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr); }
  cx.closePath(); cx.fill();
}
function ring(x,y,color,max,dur=0.9,w=3){ rings.push({x,y,color,max,dur,age:0,w}); kick(); }
function kick(){ if(!raf) { last=performance.now(); raf=requestAnimationFrame(loop); } }
let last=0;
function loop(t){
  const dt=Math.max(0,Math.min((t-last)/1000,0.05)); last=t;
  cx.clearRect(0,0,W,H);
  cx.globalCompositeOperation='lighter';
  rings=rings.filter(r=>(r.age+=dt)<r.dur);
  rings.forEach(r=>{ const p=r.age/r.dur, e=1-Math.pow(1-p,3);
    cx.strokeStyle=hexA(r.color,(1-p)*.9); cx.lineWidth=r.w*(1-p)+.5; cx.beginPath(); cx.arc(r.x,r.y,r.max*e,0,6.283); cx.stroke(); });
  stars=stars.filter(p=>(p.age+=dt)<p.life);
  stars.forEach(p=>{
    p.vy+=520*dt; p.vx*=0.99; p.x+=p.vx*dt; p.y+=p.vy*dt; p.rot+=p.spin*dt;   // pop up, then arc back down
    const a=Math.min(1,(1-p.age/p.life)*1.6), tw=0.75+0.25*Math.sin(p.age*28+p.rot);
    cx.fillStyle=hexA(p.color,a*.22); drawStar(p.x,p.y,p.size*2.1*a,p.rot);
    cx.fillStyle=hexA(p.color,a*tw); drawStar(p.x,p.y,p.size*(0.5+a*.5),p.rot);
  });
  parts=parts.filter(p=>(p.age+=dt)<p.life);
  parts.forEach(p=>{
    p.vy+=p.g*dt; p.vx*=0.985; p.vy*=0.985; p.x+=p.vx*dt; p.y+=p.vy*dt;
    const a=1-p.age/p.life;
    cx.fillStyle=hexA(p.color[0]==='#'?(p.color.length===7?p.color:'#ffffff'):'#ffffff',a);
    cx.beginPath(); cx.arc(p.x,p.y,p.size*(0.4+a*.6),0,6.283); cx.fill();
    cx.fillStyle=hexA(p.color.length===7?p.color:'#ffffff',a*.18);
    cx.beginPath(); cx.arc(p.x,p.y,p.size*3.2*a,0,6.283); cx.fill();
  });
  if(parts.length||rings.length||stars.length) raf=requestAnimationFrame(loop); else { raf=0; cx.clearRect(0,0,W,H); }
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
  starBurst(x,y,col,16); burst(x,y,col,14,90,.7);
  sfx.city();
  toast(`✦ ${c.n}<b>+${ptsOf(c)}</b>`,col);

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
    const need=countryNeed(name), have=D.vc.get(name)||0;
    if(have>0 && (!best || need-have<best.left || (need-have===best.left && have>best.have))) best={name,left:need-have,have,need};
  });
  const nx=$('next');
  if(viewing) nx.innerHTML='Viewing a shared map';
  else if(!set.size) nx.innerHTML='Search the first city you\'ve ever travelled to.';
  else if(best) nx.innerHTML=`<b>${Math.ceil(best.left)} more ${Math.ceil(best.left)===1?'city':'cities'}</b> in ${best.name} to unlock the whole country.`;
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
  const have=D.vc.get(name)||0, need=countryNeed(name);
  return D.countries.has(name) ? '<span>Unlocked ✓</span>' : `<span>${fmt(have)} / ${need} cities to unlock</span>`;
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
  const have=D.vc.get(name)||0, need=countryNeed(name), seen=list.filter(i=>active().has(i)).length;
  $('pBar').style.width=Math.min(100,have/need*100)+'%';
  $('pText').textContent = D.countries.has(name) ? `Country unlocked — ${seen} of ${list.length} cities` : `${fmt(have)} / ${need} cities to unlock this country`;
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
addEventListener('keydown',e=>{ if(e.key==='/'&&document.activeElement!==q&&document.activeElement.tagName!=='INPUT'){ e.preventDefault(); q.focus(); } if(e.key==='Escape'){ closePanel(); closeModal(); closeConfirm(); } });
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
  return `${name?name+' has':"I've"} lit up ${visited.size} ${visited.size===1?'city':'cities'}, ${D.countries.size} ${D.countries.size===1?'country':'countries'} and ${D.conts.size} ${D.conts.size===1?'continent':'continents'} on Constellate — ${D.score.toLocaleString()} pts (${r}). Can you beat it?`;
}
/* ---------- share card: your cities as a constellation ---------- */
const CARD_W=1200, CARD_H=630;
const CARD_STYLES={ starfield:'Starfield', sky:'Star chart', atlas:'Atlas', paper:'Paper' };
const ink=(col,t)=>d3.interpolateRgb(col,'#141b3f')(t);

// zoom the projection onto wherever the stars are, so one region's trip still fills the picture
function fitCardProjection(area,ids){
  const pr=d3.geoNaturalEarth1().fitExtent([[area.x0,area.y0],[area.x1,area.y1]],sphere);
  const pc=ids.map(i=>pr([cities[i].lon,cities[i].lat])).filter(p=>isFinite(p[0]));
  if(pc.length){
    const xs=pc.map(p=>p[0]), ys=pc.map(p=>p[1]), bx0=Math.min(...xs), bx1=Math.max(...xs), by0=Math.min(...ys), by1=Math.max(...ys);
    const k=Math.max(1,Math.min(6,(area.x1-area.x0)/Math.max(bx1-bx0,1)*0.8,(area.y1-area.y0)/Math.max(by1-by0,1)*0.8));
    const t0=pr.translate(), mx=(area.x0+area.x1)/2, my=(area.y0+area.y1)/2, cx0=(bx0+bx1)/2, cy0=(by0+by1)/2;
    pr.scale(pr.scale()*k).translate([mx-(cx0-t0[0])*k, my-(cy0-t0[1])*k]);
  }
  return pr;
}
// constellation lines: minimum spanning tree (skipping hops too long to read as one figure) plus a few short loops
function constellationEdges(pts,maxEdge,loopEdge){
  const n=pts.length, dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y), edges=[];
  const inT=new Array(n).fill(false), best=new Array(n).fill(Infinity), from=new Array(n).fill(-1);
  for(let s0=0;s0<n;s0++){
    if(inT[s0]) continue; best[s0]=0;
    for(;;){
      let u=-1; for(let k=0;k<n;k++) if(!inT[k]&&best[k]<Infinity&&(u<0||best[k]<best[u])) u=k;
      if(u<0) break; inT[u]=true;
      if(from[u]>=0&&best[u]<=maxEdge) edges.push([from[u],u]);
      let m=Infinity;
      for(let k=0;k<n;k++) if(!inT[k]){ const d=dist(pts[u],pts[k]); if(d<best[k]){ best[k]=d; from[k]=u; } if(best[k]<m) m=best[k]; }
      if(m>maxEdge) break;
    }
    for(let k=0;k<n;k++) if(!inT[k]){ best[k]=Infinity; from[k]=-1; }
  }
  const seen=new Set(edges.map(e=>Math.min(...e)+'-'+Math.max(...e)));
  pts.forEach((p,a)=>{
    let n2=-1,d1=Infinity,d2=Infinity,n1=-1;                       // second-nearest neighbour
    pts.forEach((q,b)=>{ if(a===b) return; const d=dist(p,q); if(d<d1){ d2=d1; n2=n1; d1=d; n1=b; } else if(d<d2){ d2=d; n2=b; } });
    if(n2>=0 && d2<loopEdge && (a*7%5)<2){ const k=Math.min(a,n2)+'-'+Math.max(a,n2); if(!seen.has(k)){ seen.add(k); edges.push([a,n2]); } } });
  return edges;
}
// pick non-overlapping city labels, trying right, left, above, below of each star
function placeLabels(g,pts,font,pad=4){
  g.font=font; const boxes=[], out=[];
  pts.forEach(p=>{ const c=cities[p.i], tw=g.measureText(c.n).width, th=14;
    const opts=[[10,4,'left'],[-10,4,'right'],[0,-12,'center'],[0,20,'center']];
    for(const [dx,dy,al] of opts){
      const x=p.x+dx, y=p.y+dy, x0=al==='left'?x:al==='right'?x-tw:x-tw/2, bx=[x0-pad,y-th,x0+tw+pad,y+4];
      if(bx[0]<24||bx[2]>CARD_W-24||bx[1]<125||bx[3]>CARD_H-50) continue;
      if(boxes.some(o=>!(bx[2]<o[0]||bx[0]>o[2]||bx[3]<o[1]||bx[1]>o[3]))) continue;
      boxes.push(bx); out.push({x,y,al,n:c.n}); break;
    } });
  return out;
}
function cardHeader(g,w,h,T,name,stat){
  g.textBaseline='alphabetic';
  g.font='800 34px Sora, Inter, sans-serif'; const tg=g.createLinearGradient(40,0,300,0); tg.addColorStop(0,T.title0); tg.addColorStop(1,T.title1);
  g.fillStyle=tg; g.fillText('Constellate',40,66);
  g.font='500 18px Inter, sans-serif'; g.fillStyle=T.sub; g.fillText(name?`${name}'s constellation`:'my constellation',42,96);
  g.textAlign='right';
  g.font='800 72px Sora, Inter, sans-serif'; g.fillStyle=T.big; g.fillText(D.score.toLocaleString(),w-40,84);
  g.font='700 15px Sora, Inter, sans-serif'; g.fillStyle=T.accent; g.fillText(rankFor(D.score)[1].toUpperCase()+'  ·  PTS',w-42,114);
  g.textAlign='left'; g.font='600 20px Inter, sans-serif'; g.fillStyle=T.text; g.fillText(stat,40,h-26);
  g.textAlign='right'; g.fillStyle=T.link; g.font='600 18px Inter, sans-serif';
  g.fillText(location.host? location.host+location.pathname.replace(/index\.html$/,'') : 'Can you beat it?',w-40,h-26);
  g.textAlign='left';
}
function sparkle(g,x,y,r,color,alpha,diag){
  g.strokeStyle=hexA(color,alpha); g.lineWidth=1.1; g.lineCap='round'; g.beginPath();
  g.moveTo(x-r,y); g.lineTo(x+r,y); g.moveTo(x,y-r); g.lineTo(x,y+r);
  if(diag){ const d=r*.55; g.moveTo(x-d,y-d); g.lineTo(x+d,y+d); g.moveTo(x-d,y+d); g.lineTo(x+d,y-d); }
  g.stroke();
}
function drawCard(canvas,scale=1,style=settings.cardStyle||'starfield'){
  const w=CARD_W, h=CARD_H;
  if(canvas.width!==w*scale||canvas.height!==h*scale){ canvas.width=w*scale; canvas.height=h*scale; }
  const g=canvas.getContext('2d'); g.setTransform(scale,0,0,scale,0,0); g.imageSmoothingQuality='high';
  let seed=1337; const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const name=viewing?viewing.name:($('shareName')?.value||settings.name||'').trim();
  const ids=[...active()];
  const stat=`${ids.length} ${ids.length===1?'star':'stars'}   ·   ${D.countries.size} ${D.countries.size===1?'country':'countries'}   ·   ${D.conts.size} ${D.conts.size===1?'continent':'continents'}`;
  const paper=style==='paper', atlas=style==='atlas', sky=style==='sky';
  const T = paper ? {title0:'#141b3f',title1:'#8a5a00',sub:'#6b6a64',big:'#141b3f',accent:'#8a5a00',text:'#2b3358',link:'#2a6f62'}
                  : {title0:'#fff',title1:'#ffd479',sub:'#8c97b8',big:'#fff',accent:'#ffd479',text:'#dbe3ff',link:'#7cf0d4'};
  // ---- background
  if(paper){ const bg=g.createRadialGradient(w/2,h*.5,60,w/2,h*.5,w*.7); bg.addColorStop(0,'#fbf7ec'); bg.addColorStop(1,'#eadfc6'); g.fillStyle=bg; g.fillRect(0,0,w,h); }
  else { const bg=g.createRadialGradient(w/2,h*.55,40,w/2,h*.55,w*.75); bg.addColorStop(0,atlas?'#0d1b40':'#101f4a'); bg.addColorStop(.6,atlas?'#08112a':'#070d22'); bg.addColorStop(1,'#03050d'); g.fillStyle=bg; g.fillRect(0,0,w,h); }
  if(!paper && !atlas){ for(let i=0;i<(sky?420:260);i++){ g.fillStyle=`rgba(190,210,255,${rnd()*.5})`; const sz=rnd()<.07?2.2:1.2; g.fillRect(rnd()*w,rnd()*h,sz,sz); } }
  // ---- map
  const area={x0:70,y0:140,x1:w-70,y1:h-70};
  const pr=fitCardProjection(area,ids), pa=d3.geoPath(pr,g);
  if(atlas||paper){ g.beginPath(); pa(d3.geoGraticule10()); g.strokeStyle=paper?'rgba(120,100,60,.14)':'rgba(140,170,255,.10)'; g.lineWidth=.8; g.stroke(); }
  if(!sky){
    features.forEach(f=>{ g.beginPath(); pa(f);
      if(paper){ g.fillStyle='rgba(170,150,105,.20)'; g.fill(); g.strokeStyle='rgba(120,100,60,.35)'; g.lineWidth=.7; g.stroke(); }
      else if(atlas){ g.strokeStyle='rgba(150,180,255,.30)'; g.lineWidth=.8; g.stroke(); }
      else { g.fillStyle='rgba(120,150,230,.055)'; g.fill(); g.strokeStyle='rgba(140,170,255,.07)'; g.lineWidth=.6; g.stroke(); } });
  }
  const pts=ids.map(i=>{ const c=cities[i]; const [x,y]=pr([c.lon,c.lat]); return {x,y,col:COLORS[c.cont],i}; }).filter(p=>isFinite(p.x));
  const edges=constellationEdges(pts,w*0.2,w*0.06);
  // ---- soft nebula glow under clusters
  if(!paper && !atlas){ g.save(); g.globalCompositeOperation='lighter';
    pts.forEach(p=>{ const r=70, rad=g.createRadialGradient(p.x,p.y,0,p.x,p.y,r); rad.addColorStop(0,hexA(p.col,.07)); rad.addColorStop(1,hexA(p.col,0)); g.fillStyle=rad; g.beginPath(); g.arc(p.x,p.y,r,0,6.283); g.fill(); });
    g.restore(); }
  // ---- lines
  g.lineCap='round';
  edges.forEach(([a,b])=>{ const A=pts[a], B=pts[b];
    if(paper){ g.strokeStyle='rgba(43,58,103,.55)'; g.lineWidth=1.4; g.setLineDash([2,5]); g.beginPath(); g.moveTo(A.x,A.y); g.lineTo(B.x,B.y); g.stroke(); g.setLineDash([]); return; }
    const base=atlas?'#ffd479':null, lg=g.createLinearGradient(A.x,A.y,B.x,B.y);
    lg.addColorStop(0,hexA(base||A.col,.7)); lg.addColorStop(1,hexA(base||B.col,.7));
    g.strokeStyle=lg; g.lineWidth=atlas?1:1.3; g.beginPath(); g.moveTo(A.x,A.y); g.lineTo(B.x,B.y); g.stroke();
    if(!atlas){ g.globalAlpha=.18; g.lineWidth=4; g.stroke(); g.globalAlpha=1; } });
  // ---- stars
  const sized=pts.map(p=>({...p,r:(2.4+rnd()*2.6)*(cities[p.i].m?0.65:1)}));
  g.save(); if(!paper&&!atlas) g.globalCompositeOperation='lighter';
  sized.forEach(p=>{
    if(paper){ const c=ink(p.col,.45); g.fillStyle=hexA(c,.18); g.beginPath(); g.arc(p.x,p.y,p.r*2.6,0,6.283); g.fill(); sparkle(g,p.x,p.y,p.r*2.4,c,.9,p.r>3.6); g.fillStyle=c; g.beginPath(); g.arc(p.x,p.y,p.r*.75+.8,0,6.283); g.fill(); return; }
    if(atlas){ g.strokeStyle=hexA(p.col,.95); g.lineWidth=1.6; g.beginPath(); g.arc(p.x,p.y,p.r*1.7+2,0,6.283); g.stroke(); g.fillStyle='#fff'; g.beginPath(); g.arc(p.x,p.y,p.r*.7+.6,0,6.283); g.fill(); return; }
    const gr=p.r*4.2, rad=g.createRadialGradient(p.x,p.y,0,p.x,p.y,gr);
    rad.addColorStop(0,hexA(p.col,.55)); rad.addColorStop(.35,hexA(p.col,.18)); rad.addColorStop(1,hexA(p.col,0)); g.fillStyle=rad; g.beginPath(); g.arc(p.x,p.y,gr,0,6.283); g.fill();
    if(p.r>3.2) sparkle(g,p.x,p.y,p.r*3.2,'#ffffff',.55,p.r>4.4);
  });
  g.restore();
  if(!paper && !atlas){ sized.forEach(p=>{ g.fillStyle='#fff'; g.beginPath(); g.arc(p.x,p.y,1.5+p.r*.18,0,6.283); g.fill(); }); }
  // ---- labels: star chart, atlas and paper name the cities
  if(sky||atlas||paper){
    const labels=placeLabels(g,sized.slice(0,200),'500 13px Inter, sans-serif');
    g.font='500 13px Inter, sans-serif'; g.textBaseline='alphabetic';
    labels.forEach(l=>{ g.textAlign=l.al; g.fillStyle=paper?'rgba(43,51,88,.9)':'rgba(205,216,245,.85)'; g.fillText(l.n,l.x,l.y); });
    g.textAlign='left';
  }
  // ---- frame
  if(sky||atlas||paper){ g.strokeStyle=paper?'rgba(120,100,60,.45)':'rgba(190,210,255,.22)'; g.lineWidth=1.2; g.strokeRect(14,14,w-28,h-28); if(!atlas){ g.strokeStyle=paper?'rgba(120,100,60,.2)':'rgba(190,210,255,.1)'; g.strokeRect(20,20,w-40,h-40); } }
  cardHeader(g,w,h,T,name,stat);
}
function openModal(){
  $('shareName').value=settings.name||'';
  refreshShare(); $('modal').hidden=false;
}
function closeModal(){ $('modal').hidden=true; }
function refreshShare(){
  drawCard($('cardPreview'),1.5);
  document.querySelectorAll('#styleRow button').forEach(b=>b.classList.toggle('on',b.dataset.style===(settings.cardStyle||'starfield')));
  $('shareText').textContent=shareMessage();
  $('shareLink').value=shareUrl();
  $('btnNative').hidden=!navigator.share;
}
/* ---------- onboarding ---------- */
const ONB_KEY='constellate.onboarded';
const ONB_ART={
  search:`<svg viewBox="0 0 300 150"><rect x="30" y="52" width="240" height="46" rx="23" fill="rgba(255,255,255,.06)" stroke="rgba(124,240,212,.45)"/><circle cx="62" cy="75" r="8" fill="none" stroke="#7cf0d4" stroke-width="2"/><path d="M68 81l6 6" stroke="#7cf0d4" stroke-width="2" stroke-linecap="round"/><text x="86" y="80" fill="#e8edff" font-size="15" font-family="Inter,sans-serif">Lisbon</text><circle cx="212" cy="75" r="4" fill="#fff"/><circle cx="212" cy="75" r="12" fill="#7cf0d4" opacity=".25" class="twinkle"/></svg>`,
  stars:`<svg viewBox="0 0 300 150"><g stroke="#7cf0d4" stroke-opacity=".6" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M50 108L100 50L158 82L214 36L252 96"/><path d="M158 82L148 124"/></g><g fill="#fff"><circle cx="100" cy="50" r="5"/><circle cx="158" cy="82" r="6"/><circle cx="148" cy="124" r="4.5"/><circle cx="252" cy="96" r="5"/></g><circle cx="214" cy="36" r="6" fill="#ffd479"/><circle cx="50" cy="108" r="4.5" fill="#7cf0d4"/><g fill="#7cf0d4" opacity=".2" class="twinkle"><circle cx="158" cy="82" r="18"/><circle cx="214" cy="36" r="16"/><circle cx="100" cy="50" r="14"/></g></svg>`,
  unlock:()=>{                              // the real outline of the UK, with a few real cities lit
    const uk=featByName.get('United Kingdom').f;
    const pr=d3.geoMercator().fitExtent([[24,8],[150,142]],uk), pa=d3.geoPath(pr);
    const dots=['London','Manchester','Edinburgh','Cardiff','Belfast'].map(n=>cities.find(c=>c.n===n&&c.c==='United Kingdom')).filter(Boolean)
      .map(c=>{ const [x,y]=pr([c.lon,c.lat]); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#7cf0d4" opacity=".22" class="twinkle"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="#fff"/>`; }).join('');
    return `<svg viewBox="0 0 300 150"><path d="${pa(uk)}" fill="rgba(124,240,212,.24)" stroke="#7cf0d4" stroke-opacity=".8" stroke-linejoin="round"/>${dots}<text x="172" y="66" fill="#ffd479" font-size="15" font-weight="700" font-family="Sora,sans-serif">⚑ Country</text><text x="172" y="86" fill="#ffd479" font-size="15" font-weight="700" font-family="Sora,sans-serif">unlocked</text><text x="172" y="106" fill="#8c97b8" font-size="11" font-family="Inter,sans-serif">United Kingdom</text></svg>`;
  },
  share:`<svg viewBox="0 0 300 150"><rect x="55" y="22" width="190" height="106" rx="12" fill="#0a1330" stroke="rgba(124,240,212,.5)"/><g stroke="#7cf0d4" stroke-opacity=".55" fill="none"><path d="M85 100L120 60L160 78L200 48L222 92"/></g><g fill="#fff"><circle cx="120" cy="60" r="3.5"/><circle cx="160" cy="78" r="4"/><circle cx="222" cy="92" r="3.5"/></g><circle cx="200" cy="48" r="4" fill="#ffd479"/><circle cx="85" cy="100" r="3.5" fill="#7cf0d4"/></svg>`
};
const ONB_STEPS=[
  {art:'search', title:'Welcome to Constellate', text:"A map of everywhere you've been. Search any city you've visited and it lights up on the world map."},
  {art:'stars', title:'Every city is a star', text:"Add cities and watch them join up into your own personal constellation. Small towns count too, just for a little less."},
  {art:'unlock', title:'Unlock countries & continents', text:"Visit enough cities in a country to unlock it, then enough countries to unlock a whole continent. Climb the ranks as your score grows."},
  {art:'share', title:'Share it with your friends', text:"When you're done, hit Share my map for a picture of your constellation and a link. Send it to your friends and see whose is brighter."}
];
let onbStep=0;
function renderOnboarding(){
  const st=ONB_STEPS[onbStep], last=onbStep===ONB_STEPS.length-1;
  const art=ONB_ART[st.art]; $('onbArt').innerHTML=typeof art==='function'?art():art; $('onbTitle').textContent=st.title; $('onbText').textContent=st.text;
  $('onbDots').innerHTML=ONB_STEPS.map((_,i)=>`<i class="${i===onbStep?'on':''}"></i>`).join('');
  $('onbBack').style.visibility=onbStep?'visible':'hidden';
  $('onbNext').textContent=last?"Let's go ✦":'Next';
}
function openOnboarding(){ onbStep=0; renderOnboarding(); $('onboard').hidden=false; $('onbNext').focus(); }
function closeOnboarding(){ $('onboard').hidden=true; try{ localStorage.setItem(ONB_KEY,'1'); }catch(e){} }
$('onbNext').onclick=()=>{ if(onbStep<ONB_STEPS.length-1){ onbStep++; renderOnboarding(); } else { closeOnboarding(); q.focus(); } };
$('onbBack').onclick=()=>{ if(onbStep>0){ onbStep--; renderOnboarding(); } };
$('onbClose').onclick=closeOnboarding;
$('btnHelp').onclick=openOnboarding;
$('onboard').addEventListener('mousedown',e=>{ if(e.target===$('onboard')) closeOnboarding(); });
addEventListener('keydown',e=>{ if($('onboard').hidden) return; if(e.key==='Escape') closeOnboarding(); else if(e.key==='ArrowRight') $('onbNext').click(); else if(e.key==='ArrowLeft') $('onbBack').click(); });
// first visit only (and not when someone opens a friend's shared map)
try{ if(!localStorage.getItem(ONB_KEY) && !location.hash.includes('s=')) setTimeout(openOnboarding,500); }catch(e){}

function openConfirm(){
  if(viewing) return;
  if(!visited.size){ toast('Nothing to reset yet',COLORS['Asia']); return; }
  const n=visited.size;
  $('confirmText').textContent=`This will remove all ${n} ${n===1?'city':'cities'} you've lit up. This can't be undone.`;
  $('confirmModal').hidden=false; $('confirmNo').focus();
}
function closeConfirm(){ $('confirmModal').hidden=true; }
$('btnReset').onclick=openConfirm;
$('confirmNo').onclick=closeConfirm;
$('confirmModal').addEventListener('mousedown',e=>{ if(e.target===$('confirmModal')) closeConfirm(); });
$('confirmYes').onclick=()=>{
  visited.clear(); D=derive(visited); closeConfirm(); closePanel();
  paintAll(false); updateHud(); shown=0; countTo(D.score); save();
  toast('Map reset',COLORS['Asia']);
};
$('btnShare').onclick=()=>{ if(viewing) return; if(!visited.size){ toast('Light up a city first ✦',COLORS['Asia']); q.focus(); return; } openModal(); };
$('styleRow').innerHTML=Object.entries(CARD_STYLES).map(([k,v])=>`<button data-style="${k}">${v}</button>`).join('');
$('styleRow').onclick=e=>{ const k=e.target.dataset&&e.target.dataset.style; if(!k) return; settings.cardStyle=k; save(); refreshShare(); };
$('modalClose').onclick=closeModal;
$('modal').addEventListener('mousedown',e=>{ if(e.target===$('modal')) closeModal(); });
$('shareName').addEventListener('input',()=>{ settings.name=$('shareName').value.trim(); save(); refreshShare(); });
$('btnCopy').onclick=async()=>{
  const text=`${shareMessage()}\n${shareUrl()}`;
  try{ await navigator.clipboard.writeText(text); }catch(e){ $('shareLink').select(); document.execCommand('copy'); }
  $('btnCopy').textContent='Copied ✓'; setTimeout(()=>$('btnCopy').textContent='Copy link',1800);
};
$('btnNative').onclick=()=>navigator.share({title:'Constellate',text:shareMessage(),url:shareUrl()}).catch(()=>{});
$('btnImage').onclick=()=>{            // render a crisp 2x copy for download
  const big=document.createElement('canvas'); drawCard(big,2);
  const a=document.createElement('a'); a.download='constellate.png'; a.href=big.toDataURL('image/png'); a.click();
};

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

/* ---------- performance meter: fps + frame time, toggle with P (or load the page with ?perf) ---------- */
const perf = (()=>{
  const box=$('perf'), gc=$('pGraph').getContext('2d'), N=120, times=new Float32Array(N);
  let on=false, raf=0, last=0, idx=0, filled=0, acc=0, accN=0, lastReport=0;
  const cls=(el,ms)=>{ el.className = ms>33 ? 'bad' : ms>20 ? 'ok' : 'good'; };
  function frame(t){
    if(!on) return;
    if(last){ const dt=t-last; times[idx]=dt; idx=(idx+1)%N; filled=Math.min(filled+1,N); acc+=dt; accN++; }
    last=t;
    if(t-lastReport>500 && accN){                       // refresh the numbers twice a second
      const avg=acc/accN, fps=1000/avg; acc=0; accN=0; lastReport=t;
      const arr=Array.from(times.subarray(0,filled)).sort((a,b)=>a-b);
      const worst=arr[arr.length-1]||0, low=arr[Math.floor(arr.length*0.99)]||worst;
      $('pFps').textContent=Math.round(fps); cls($('pFps'),avg);
      $('pMs').textContent=avg.toFixed(1); cls($('pMs'),avg);
      $('pWorst').textContent=worst.toFixed(0)+'ms'; $('pLow').textContent=(1000/low).toFixed(0)+'fps';
      $('pDom').textContent=document.getElementsByTagName('*').length.toLocaleString();
      $('pDots').textContent=dots.nodes().filter(n=>n.style.display!=='none').length.toLocaleString();
    }
    // frame-time graph: one bar per recent frame, red above 33ms (under 30fps), line at 16.7ms
    const w=180,h=40; gc.clearRect(0,0,w,h);
    const max=50, bw=w/N;
    for(let k=0;k<filled;k++){ const v=times[(idx-filled+k+N)%N], bh=Math.min(v,max)/max*h;
      gc.fillStyle=v>33?'#ff8aa0':v>20?'#ffd479':'#7cf0d4'; gc.fillRect(k*bw,h-bh,Math.max(bw-0.5,1),bh); }
    gc.fillStyle='rgba(255,255,255,.35)'; gc.fillRect(0,h-16.7/max*h,w,1);
    raf=requestAnimationFrame(frame);
  }
  function set(v){
    on=v; box.hidden=!v; last=0; idx=0; filled=0; acc=0; accN=0; lastReport=0;
    cancelAnimationFrame(raf); if(v) raf=requestAnimationFrame(frame);   // the loop only runs while the meter is visible
    try{ localStorage.setItem('constellate.perf',v?'1':'0'); }catch(e){}
  }
  addEventListener('keydown',e=>{ if((e.key==='p'||e.key==='P') && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) set(!on); });
  let want=false; try{ want = new URLSearchParams(location.search).has('perf') || localStorage.getItem('constellate.perf')==='1'; }catch(e){}
  if(want) set(true);
  return {set};
})();
boot();
window.__constellate = { visited, cities, toggleCity, derive, get D(){return D;} };   // handy for debugging
})();
