// flex mockup --review also writes two pages for other pages to embed (an <iframe>), over the same frozen screens the
// review shows live, so a deck or a film places Flex's devices by reference instead of copying PNGs:
//
// - embed.html?screen=home@paul&device=android&theme=light[&finish=%231C5A26 | sage]: one device, its frame around the
//   frozen page, fitted to the iframe's width and top-aligned, on a transparent ground, padded as the PNG is (so an
//   iframe sized to the PNG's ratio lines up with it exactly). A still: it doesn't scroll or take clicks (&live=1 lets
//   it). finish sets the frame's finish: one of its named finishes (Android: graphite, porcelain, sage) or any colour
//   (#1C5A26: the frame tinted with it, where the frame has a tint finish: Android). The host decides, not the capture.
//
// - canvas.html: a 1920 × 1080 stage, transparent, scaled to the iframe, with devices under a camera.
//   · One device: screen, device, theme, finish as above; place=left,top,width puts it there, else it is fitted to the
//     stage, centred. Or several: d=screen/device/theme/finish:left,top,width, repeated (finish may be empty).
//   · The camera: camera=zoom,x,y is where it starts (stage point x, y at the middle; 1,960,540 is the whole stage).
//     views=name:zoom,x,y|name:zoom,x,y names framings, the first being the stage at rest; view=name starts on one.
//   · controls=all, or some of zoom,pan,views,devices,theme,states: Flex's own controls float over the canvas, as a
//     video embed's do, showing while the pointer moves and fading after (so stills and film frames stay clean).
//     zoom: − % + and Fit; pan: drag, scroll when zoomed in, pinch or ⌘-scroll to zoom; views: a button per view;
//     devices: the screen's other devices (one phone: the one it started on); theme: light or dark; states: the
//     screen's states, as its screens list declares them (a select per axis and a switch per toggle, or a list).
//     Devices, theme and states are for one device; a finish carries over where the new frame has it.
//   · The host drives it too: postMessage { flex: "camera", zoom, x, y, animate? } (animate: false jumps there),
//     { flex: "view", name }, or { flex: "set", name, value } (a control, as the controls below would: device, theme,
//     a state axis, or state). It tells the host { flex: "view", name, rest, camera: { zoom, x, y } } when the camera
//     moves (rest: on the first view, or the whole stage; at most ~10 a second while dragging, always the last),
//     { flex: "stage", w, h, items: [{ x, y, w, h, label }], views: [{ name, zoom, x, y, rest }] } for a minimap when
//     the devices are placed, { flex: "controls", controls: [{ name, label, value, options: [{ value, label }] }] }
//     (what "set" can set) and { flex: "state", screen, device, theme } when what it shows changes.
//
// Both read flex-embed.js beside them: the screens (rows), their index (states, labels), the frames with a slot for
// the page, and the frames' CSS.

export type EmbedRow = { screen: string; key: string; theme: string; family: string; page: string | null; frame: string; file: string; pad: [number, number, number, number] };
export type EmbedIndex = { screens: { name: string; label?: string; defaultLabel?: string; axes?: { name: string; label: string; toggle: boolean; options: { name: string; label: string }[] }[]; states: { name: string; label: string }[] }[] } | null;

export function embedFiles(rows: EmbedRow[], frames: Record<string, string>, css: string, finishes: Record<string, string[]>, index: EmbedIndex): Record<string, string> {
  const js = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
  const data = `// flex mockup --review: the data embed.html and canvas.html read (see their notes in Flex's server/embed.mts)
window.FLEX={rows:${js(rows)},frames:${js(frames)},css:${js(css)},finishes:${js(finishes)},index:${js(index)}};
(function(){
  const st=document.createElement("style");st.textContent=FLEX.css;document.head.appendChild(st);
  const q=new URLSearchParams(location.search);
  // which device: the page's own query, or o ({ screen, device, theme, finish }) for one of a canvas's several
  const ask=(o)=>o||{screen:q.get("screen"),device:q.get("device")||"android",theme:q.get("theme")||"light",finish:q.get("finish")};
  FLEX.pick=(o)=>{o=ask(o);return FLEX.rows.find(r=>r.screen===o.screen&&r.key===o.device&&r.theme===o.theme)};
  // one device into el, its frame (padded as its PNG) scaled to width w (a number, or a function read on resize);
  // still unless &live=1. Returns its height over its width, or 0 when there's no such screen.
  FLEX.device=(el,w,o)=>{
    o=ask(o);const r=FLEX.pick(o);if(!r){el.innerHTML='<div style="font:600 28px system-ui;color:#888;padding:40px">No '+o.screen+" on "+o.device+" ("+o.theme+")</div>";return 0}
    const [pt,pr,pb,pl]=r.pad,live=q.get("live")==="1";
    const inner=r.page&&FLEX.frames[r.frame]?FLEX.frames[r.frame].replace("__SRC__",encodeURI(r.page)).replace(' loading="lazy"',""):'<img src="'+encodeURI(r.file)+'" style="display:block">';
    el.innerHTML='<div class="fx" style="display:inline-block;padding:'+pt+'px '+pr+'px '+pb+'px '+pl+'px;transform-origin:0 0">'+inner+"</div>";
    const box=el.firstElementChild,fig=box.querySelector("figure");
    const fin=o.finish,names=FLEX.finishes[r.family]||[];
    if(fig&&fin&&(names.includes(fin)||r.family==="android")){
      // the run's finish off, the asked one on: a named finish by its class, a colour as the tint (where there is one)
      names.forEach(n=>fig.classList.remove(r.family+"--"+n));
      if(names.includes(fin))fig.classList.add(r.family+"--"+fin);
      else{fig.classList.add(r.family+"--tint");fig.style.setProperty("--tint",fin)}
    }
    if(!live)box.querySelectorAll("iframe").forEach(f=>f.style.pointerEvents="none");
    const fit=()=>{box.style.transform="scale("+(typeof w==="function"?w():w)/box.offsetWidth+")"};fit();
    if(typeof w==="function")addEventListener("resize",fit);
    return box.offsetHeight/box.offsetWidth;
  };
})();
`;
  const page = (title: string, head: string, body: string, script: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;background:transparent;color-scheme:normal;overflow:hidden}${head}</style><script src="flex-embed.js"></script></head>
<body>${body}<script>${script}</script></body></html>
`;
  const embed = page("Flex device", "", '<div id="d"></div>', `FLEX.device(document.getElementById("d"),()=>innerWidth);`);

  const canvasCss = `
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;touch-action:none}
#cam{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;transition:transform .5s cubic-bezier(.65,0,.35,1)}
#stage.grab{cursor:grab}#stage.grabbing{cursor:grabbing}#stage.grabbing #cam{transition:none}
#ui{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:8px;border-radius:16px;
  background:rgba(22,21,26,.84);color:#fff;font:600 22px/1 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);
  transition:opacity .3s;white-space:nowrap;z-index:5}
#ui.idle{opacity:0;pointer-events:none}
#ui button{font:inherit;color:inherit;background:transparent;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px}
#ui button:hover{background:rgba(255,255,255,.12)}#ui button[aria-pressed=true]{background:#fff;color:#16151a}
#ui button:disabled{opacity:.35;cursor:default}
#ui svg{width:26px;height:26px}#ui .sep{width:1px;height:30px;background:rgba(255,255,255,.22);margin:0 4px}
#ui .zv{min-width:84px;text-align:center;font-variant-numeric:tabular-nums}
#ui select{font:inherit;color:#fff;background:rgba(255,255,255,.12);border:0;border-radius:10px;padding:9px 12px}
#ui select option{color:#16151a}
#ui label{display:flex;align-items:center;gap:10px;padding:0 8px;opacity:.95}
#ui .sw{width:52px;height:30px;border-radius:15px;background:rgba(255,255,255,.3);position:relative;padding:0}
#ui .sw::after{content:"";position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s}
#ui .sw[aria-checked=true]{background:#319B42}#ui .sw[aria-checked=true]::after{left:26px}
`;
  const canvas = page("Flex canvas", canvasCss, '<div id="stage"><div id="cam"></div></div><div id="ui" class="idle"></div>',
    `const q=new URLSearchParams(location.search),stage=document.getElementById("stage"),cam=document.getElementById("cam"),ui=document.getElementById("ui");
// the canvas is a 1920 × 1080 stage scaled to the iframe; the camera moves over it
const fitStage=()=>{document.body.style.zoom=innerWidth/1920};fitStage();addEventListener("resize",fitStage);
const ALL=["zoom","pan","views","devices","theme","states"],c=q.get("controls")||"";
const CTL=new Set(c==="all"?ALL:c.split(",").filter(Boolean));
const VIEWS=(q.get("views")||"").split("|").filter(Boolean).map(v=>{const i=v.lastIndexOf(":");return {name:v.slice(0,i),c:v.slice(i+1).split(",").map(Number)}});
// what it shows: several placed devices, or one (which the controls may change)
const MULTI=q.getAll("d").map(s=>{const i=s.lastIndexOf(":"),ref=s.slice(0,i),at=s.slice(i+1);const [screen,device,theme,finish]=ref.split("/");return {o:{screen,device,theme,finish:finish||null},at:at.split(",").map(Number)}});
const S={screen:q.get("screen"),device:q.get("device")||"android",theme:q.get("theme")||"light",finish:q.get("finish")};
const PLACE=q.get("place")?q.get("place").split(",").map(Number):null;
const kind=(k)=>/landscape/.test(k)?"land":/ipad|tablet/.test(k)?"tablet":/iphone|android/.test(k)?"phone":/mac|display|pc/.test(k)?"laptop":"window";
const PHONE=kind(S.device)==="phone"?S.device:(FLEX.rows.find(r=>r.key==="iphone")?"iphone":"android");

// the devices' rectangles on the stage, for a host's minimap ({ flex: "stage" })
let ITEMS=[];
const item=(o,x,y,w,ratio)=>ITEMS.push({x,y,w,h:w*(ratio||0),label:NAME[kind(o.device)]||o.device});
function render(){
  cam.innerHTML="";ITEMS=[];
  if(MULTI.length){for(const it of MULTI){const d=document.createElement("div");d.style.cssText="position:absolute;left:"+it.at[0]+"px;top:"+it.at[1]+"px;width:"+it.at[2]+"px";cam.appendChild(d);item(it.o,it.at[0],it.at[1],it.at[2],FLEX.device(d,it.at[2],it.o))}return stageTold()}
  const d=document.createElement("div");d.style.position="absolute";cam.appendChild(d);
  if(PLACE){d.style.cssText+=";left:"+PLACE[0]+"px;top:"+PLACE[1]+"px;width:"+PLACE[2]+"px";item(S,PLACE[0],PLACE[1],PLACE[2],FLEX.device(d,PLACE[2],S));return stageTold()}
  // fitted: measured once at any width, then sized to the stage with a margin, centred
  const ratio=FLEX.device(d,1000,S);if(!ratio)return stageTold();
  const w=Math.min(1920-240,(1080-150)/ratio),h=w*ratio,box=d.firstElementChild;
  // rescaled, not rendered again: a second render would cancel the frozen page's first load
  d.style.cssText+=";left:"+(1920-w)/2+"px;top:"+(1080-h)/2+"px;width:"+w+"px";box.style.transform="scale("+w/box.offsetWidth+")";
  item(S,(1920-w)/2,(1080-h)/2,w,ratio);stageTold();
}
function stageTold(){
  if(parent!==window)parent.postMessage({flex:"stage",w:1920,h:1080,items:ITEMS,views:VIEWS.map((v,i)=>({name:v.name,zoom:v.c[0],x:v.c[1],y:v.c[2],rest:i===0}))},"*");
}

// ── the camera ──
let Z=1,X=960,Y=540;
function camera(z,x,y,instant){
  Z=Math.min(8,Math.max(.5,z));X=x;Y=y;
  if(instant)cam.style.transition="none";
  cam.style.transform="translate("+(960-X*Z)+"px,"+(540-Y*Z)+"px) scale("+Z+")";
  if(instant)requestAnimationFrame(()=>requestAnimationFrame(()=>{cam.style.transition=""}));
  tell();
}
const near=(v)=>Math.abs(v.c[0]-Z)<1e-3&&Math.abs(v.c[1]-X)<.5&&Math.abs(v.c[2]-Y)<.5;
const home=()=>VIEWS.length?VIEWS[0].c:[1,960,540];
// the host hears where the camera is (its target: a move animates there), at most ~10 times a second while dragging,
// and always the last
let told=0,later=0;
function report(){
  const v=VIEWS.find(near),rest=VIEWS.length?v===VIEWS[0]:Z===1;
  told=Date.now();if(parent!==window)parent.postMessage({flex:"view",name:v?v.name:null,rest,camera:{zoom:Z,x:X,y:Y}},"*");
}
function tell(){
  const v=VIEWS.find(near);
  clearTimeout(later);if(Date.now()-told>=100)report();else later=setTimeout(report,100-(Date.now()-told));
  ui.querySelectorAll("[data-view]").forEach(b=>b.setAttribute("aria-pressed",!!v&&b.dataset.view===v.name));
  const zv=ui.querySelector(".zv");if(zv)zv.textContent=Math.round(Z*100)+"%";
}

// ── the controls ──
const I=(d)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+d+"</svg>";
const ICON={phone:I('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),tablet:I('<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  land:I('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M18 11v2"/>'),laptop:I('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),window:I('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 8.5h18"/>'),
  light:I('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  dark:I('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),fit:I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')};
const NAME={phone:"Phone",tablet:"Tablet",land:"Tablet landscape",laptop:"Laptop",window:"Window"};
const esc=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const one=!MULTI.length;
function controls(){
  const parts=[];
  if(CTL.has("views")&&VIEWS.length)parts.push(VIEWS.map(v=>'<button data-view="'+esc(v.name)+'">'+esc(v.name)+"</button>").join(""));
  if(CTL.has("zoom"))parts.push('<button data-z="out" title="Zoom out" aria-label="Zoom out">−</button><span class="zv"></span><button data-z="in" title="Zoom in" aria-label="Zoom in">+</button><button data-z="fit" title="Fit" aria-label="Fit">'+ICON.fit+"</button>");
  if(one&&CTL.has("devices")){
    const ks=[...new Set(FLEX.rows.filter(r=>r.screen===S.screen&&r.theme===S.theme).map(r=>r.key))].filter(k=>kind(k)!=="phone"||k===PHONE);
    if(ks.length>1)parts.push(ks.map(k=>'<button data-dev="'+k+'" title="'+NAME[kind(k)]+'" aria-label="'+NAME[kind(k)]+'" aria-pressed="'+(k===S.device)+'">'+ICON[kind(k)]+"</button>").join(""));
  }
  if(one&&CTL.has("theme")){
    const ts=[...new Set(FLEX.rows.filter(r=>r.screen===S.screen&&r.key===S.device).map(r=>r.theme))].sort((a,b)=>(a==="light"?0:1)-(b==="light"?0:1));
    if(ts.length>1)parts.push(ts.map(t=>'<button data-theme="'+t+'" title="'+t+'" aria-label="'+t+'" aria-pressed="'+(t===S.theme)+'">'+(ICON[t]||t)+"</button>").join(""));
  }
  if(one&&CTL.has("states"))parts.push(statesUi());
  ui.innerHTML=parts.filter(Boolean).join('<span class="sep"></span>');
  ui.style.display=ui.innerHTML?"flex":"none";
  ui.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{const v=VIEWS.find(v=>v.name===b.dataset.view);camera(...v.c)});
  ui.querySelectorAll("[data-z]").forEach(b=>b.onclick=()=>{const z=b.dataset.z;if(z==="fit")camera(...home());else camera(Z*(z==="in"?1.25:.8),X,Y)});
  ui.querySelectorAll("[data-dev]").forEach(b=>b.onclick=()=>show({device:b.dataset.dev}));
  ui.querySelectorAll("[data-theme]").forEach(b=>b.onclick=()=>show({theme:b.dataset.theme}));
  ui.querySelectorAll("[data-axis]").forEach(el=>{const f=()=>show({screen:stateName()});if(el.tagName==="SELECT")el.onchange=f;else el.onclick=()=>{el.setAttribute("aria-checked",el.getAttribute("aria-checked")!=="true");f()}});
  ui.querySelectorAll("[data-states]").forEach(el=>el.onchange=()=>show({screen:base()+(el.value?"@"+el.value:"")}));
  if(parent!==window)parent.postMessage({flex:"controls",controls:model()},"*");
  tell();
}
// what the controls can set, for a host's own controls ({ flex: "controls" }): one device's device, theme and states,
// whichever it has more than one of (several devices: none). { flex: "set", name, value } sets one.
function model(){
  if(!one)return [];
  const out=[],e=entry(),parts=(S.screen.split("@")[1]||"").split("+").filter(Boolean);
  const ks=[...new Set(FLEX.rows.filter(r=>r.screen===S.screen&&r.theme===S.theme).map(r=>r.key))].filter(k=>kind(k)!=="phone"||k===PHONE);
  if(ks.length>1)out.push({name:"device",label:"Device",value:S.device,options:ks.map(k=>({value:k,label:NAME[kind(k)]}))});
  const ts=[...new Set(FLEX.rows.filter(r=>r.screen===S.screen&&r.key===S.device).map(r=>r.theme))].sort((a,b)=>(a==="light"?0:1)-(b==="light"?0:1));
  if(ts.length>1)out.push({name:"theme",label:"Theme",value:S.theme,options:ts.map(t=>({value:t,label:t==="light"?"Light":"Dark"}))});
  if(e.axes&&e.axes.length)for(const ax of e.axes)out.push(ax.toggle
    ?{name:ax.name,label:ax.label,value:parts.includes(ax.name)?"on":"off",options:[{value:"off",label:"Off"},{value:"on",label:"On"}]}
    :{name:ax.name,label:ax.label,value:(ax.options.find(o=>parts.includes(o.name))||ax.options[0]).name,options:ax.options.map(o=>({value:o.name,label:o.label}))});
  else if(e.states.length)out.push({name:"state",label:"State",value:parts.join("+"),options:[{value:"",label:e.defaultLabel||"Default"},...e.states.map(s=>({value:s.name,label:s.label}))]});
  return out;
}
function set(name,value){
  if(!one)return;
  if(name==="device"||name==="theme")return show({[name]:value});
  if(name==="state")return show({screen:base()+(value?"@"+value:"")});
  const ax=(entry().axes||[]).find(a=>a.name===name);if(!ax)return;
  let parts=(S.screen.split("@")[1]||"").split("+").filter(Boolean);
  if(ax.toggle)parts=parts.filter(p=>p!==ax.name).concat(value==="on"?[ax.name]:[]);
  else parts=parts.filter(p=>!ax.options.some(o=>o.name===p)).concat(value!==ax.options[0].name?[value]:[]);
  // the axes' order, as stateName() writes it
  const order=(entry().axes||[]).flatMap(a=>a.toggle?[a.name]:a.options.map(o=>o.name));
  parts.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  show({screen:base()+(parts.length?"@"+parts.join("+"):"")});
}
// a screen's states: base@state, the state named by its axes (non-default options and toggles on, joined by +)
const base=()=>S.screen.split("@")[0];
const entry=()=>(FLEX.index&&FLEX.index.screens.find(e=>e.name===base()))||{states:[]};
function statesUi(){
  const e=entry(),parts=(S.screen.split("@")[1]||"").split("+").filter(Boolean);
  if(e.axes&&e.axes.length)return e.axes.map(ax=>ax.toggle
    ?'<label>'+esc(ax.label)+'<button class="sw" role="switch" data-axis="'+esc(ax.name)+'" aria-checked="'+parts.includes(ax.name)+'"></button></label>'
    :'<select data-axis="'+esc(ax.name)+'" aria-label="'+esc(ax.label)+'">'+ax.options.map(o=>'<option value="'+esc(o.name)+'"'+(parts.includes(o.name)||(!ax.options.some(x=>parts.includes(x.name))&&o===ax.options[0])?" selected":"")+">"+esc(o.label)+"</option>").join("")+"</select>").join("");
  if(e.states.length)return '<select data-states aria-label="State"><option value="">'+esc(e.defaultLabel||"Default")+"</option>"+e.states.map(s=>'<option value="'+esc(s.name)+'"'+(parts.join("+")===s.name?" selected":"")+">"+esc(s.label)+"</option>").join("")+"</select>";
  return "";
}
function stateName(){
  const e=entry(),on=[];
  for(const ax of e.axes||[]){const el=ui.querySelector('[data-axis="'+ax.name+'"]');
    if(ax.toggle){if(el.getAttribute("aria-checked")==="true")on.push(ax.name)}else if(el.value!==ax.options[0].name)on.push(el.value)}
  return base()+(on.length?"@"+on.join("+"):"");
}
function show(o){
  Object.assign(S,o);render();controls();
  if(!PLACE)camera(1,960,540,true);
  if(parent!==window)parent.postMessage({flex:"state",screen:S.screen,device:S.device,theme:S.theme},"*");
}

// ── pan and zoom by hand ──
if(CTL.has("pan")){
  stage.classList.add("grab");let drag=null;
  stage.addEventListener("pointerdown",(e)=>{drag={x:e.clientX,y:e.clientY,X,Y};stage.setPointerCapture(e.pointerId);stage.classList.add("grabbing")});
  stage.addEventListener("pointermove",(e)=>{if(!drag)return;const r=1920/innerWidth;camera(Z,drag.X-(e.clientX-drag.x)*r/Z,drag.Y-(e.clientY-drag.y)*r/Z,true)});
  const end=()=>{drag=null;stage.classList.remove("grabbing")};stage.addEventListener("pointerup",end);stage.addEventListener("pointercancel",end);
  // pinch (a trackpad's arrives as ⌘/ctrl-scroll) zooms about the pointer; plain scroll pans once zoomed in, else
  // the page around scrolls as usual
  addEventListener("wheel",(e)=>{
    const r=1920/innerWidth,px=e.clientX*r,py=e.clientY*r;
    if(e.ctrlKey||e.metaKey){e.preventDefault();const z=Math.min(8,Math.max(.5,Z*Math.exp(-e.deltaY*.01)));const sx=X+(px-960)/Z,sy=Y+(py-540)/Z;camera(z,sx-(px-960)/z,sy-(py-540)/z,true);return}
    if(Z>1.001){e.preventDefault();camera(Z,X+e.deltaX/Z,Y+e.deltaY/Z,true)}
  },{passive:false});
  let g0=1;addEventListener("gesturestart",(e)=>{e.preventDefault();g0=Z});addEventListener("gesturechange",(e)=>{e.preventDefault();camera(g0*e.scale,X,Y,true)});
}
// the controls show while the pointer moves over the canvas, and fade after
let idle;const wake=()=>{ui.classList.remove("idle");clearTimeout(idle);idle=setTimeout(()=>{if(!ui.matches(":hover")&&!ui.contains(document.activeElement))ui.classList.add("idle")},2200)};
addEventListener("pointermove",wake);addEventListener("pointerdown",wake);ui.addEventListener("focusin",wake);
document.documentElement.addEventListener("pointerleave",()=>{clearTimeout(idle);if(!ui.contains(document.activeElement))ui.classList.add("idle")});

addEventListener("message",(e)=>{const m=e.data||{};
  if(m.flex==="camera")camera(m.zoom??1,m.x??960,m.y??540,m.animate===false);
  if(m.flex==="view"&&m.name){const v=VIEWS.find(v=>v.name===m.name);if(v)camera(...v.c)}
  if(m.flex==="set"&&typeof m.name==="string")set(m.name,String(m.value??""))});

render();controls();
const v0=VIEWS.find(v=>v.name===q.get("view")),c0=v0?v0.c:q.get("camera")?q.get("camera").split(",").map(Number):home();
camera(...c0,true);`);
  return { "flex-embed.js": data, "embed.html": embed, "canvas.html": canvas };
}
