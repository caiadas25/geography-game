const fs=require('fs'),path=require('path');
const topo=require('world-atlas/countries-50m.json');
const wc=require('world-countries');
const geoms=topo.objects.countries.geometries;
const byCcn=Object.fromEntries(wc.map(c=>[c.ccn3,c]));
const manual={Kosovo:'Europe','N. Cyprus':'Asia',Somaliland:'Africa','Siachen Glacier':'Asia',
 'Ashmore and Cartier Is.':'Oceania','Br. Indian Ocean Ter.':'Asia','Indian Ocean Ter.':'Oceania',
 'S. Geo. and the Is.':'Antarctica','Heard I. and McDonald Is.':'Antarctica','Fr. S. Antarctic Lands':'Antarctica',
 'Antarctica':'Antarctica','Norfolk Island':'Oceania','Palestine':'Asia','Russia':'Europe'};
const continent={};
for(const g of geoms){
  const name=g.properties.name; let cont=manual[name];
  if(!cont){const c=byCcn[g.id]; if(c){
    const r=c.region, s=c.subregion;
    cont = r==='Americas' ? (s==='South America'?'South America':'North America')
         : r==='Oceania' ? 'Oceania' : r==='Antarctic' ? 'Antarctica' : r;
  }}
  if(!cont) console.warn('no continent for',name,g.id);
  continent[name]=cont||'Oceania';
}
const names=new Set(geoms.map(g=>g.properties.name));
const cities=[];
for(const line of fs.readFileSync('cities.txt','utf8').split('\n')){
  if(!line.trim()||line.startsWith('#'))continue;
  const [country,...rest]=line.split('|').map(s=>s.trim());
  if(!names.has(country)) console.warn('UNKNOWN COUNTRY',country);
  for(const r of rest){const m=r.match(/^(.*?)\s+(-?[\d.]+)\s+(-?[\d.]+)$/); if(!m){console.warn('bad',r);continue;}
    cities.push({n:m[1],c:country,lat:+m[2],lon:+m[3]});}
}
// keep topo lean: drop everything but names
topo.objects.countries.geometries.forEach(g=>{g.properties={name:g.properties.name}});
const out='../data/';
fs.writeFileSync(out+'world.js','window.WORLD_TOPO='+JSON.stringify(topo)+';');
fs.writeFileSync(out+'cities.js','window.CITIES='+JSON.stringify(cities)+';\nwindow.CONTINENT='+JSON.stringify(continent)+';');
fs.copyFileSync('node_modules/d3/dist/d3.min.js','../vendor/d3.min.js');
fs.copyFileSync('node_modules/topojson-client/dist/topojson-client.min.js','../vendor/topojson-client.min.js');
const cc={};cities.forEach(c=>cc[c.c]=(cc[c.c]||0)+1);
const perCont={};Object.keys(cc).forEach(k=>perCont[continent[k]]=(perCont[continent[k]]||0)+1);
console.log('cities',cities.length,'countries',Object.keys(cc).length,perCont);
