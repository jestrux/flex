// flex mockup --review: one page over a run's PNGs, to check them before they go into a film or a deck. Every image on
// it is a file the run wrote (by relative path, beside the page): it re-renders nothing.
//
// Laid out like KinPay's Frame Studio: a control panel on the left and a dotted canvas with a floating toolbar.
// - Devices, by category (Phone, Tablet, Tablet landscape, Laptop): a click shows that one, Shift-click a range from the
//   last click, ⌘-click adds or removes one (as Finder; none on = all). The zoom bar stays put over the canvas. Android is left out (the
//   phone category shows the iPhone render when both exist).
// - Screens: All (each device in turn, every screen in a numbered grid, in the run's order from flex screens'
//   order.json) or One (that screen on each device, as large as the canvas allows; ← → step, Esc back to All). In One,
//   the screen is picked from a panel that slides over the left panel (grid or list, search; close, Esc).
// - Theme: light or dark.
// Finishes are a frame's colour, not a layout: each device shows in the run's first finish. State lives in the URL.
// Live (One, when the run's input was a flex screens folder): each device is its CSS frame around the frozen page
// itself (pages/<device>/<file>, copied beside this page), so it scrolls and stays sharp at any size; Render shows the
// PNG instead, the check before a film. A screen's states (screens.json "states", frozen as screen@state) are listed
// in the left panel when that screen is open; ↑ ↓ step through them. index.json sets the order, labels and the first
// number (0 for an app-shell screen 00). The whole folder opens with a double-click: no server.

export type ReviewRow = { file: string; screen: string; device: string; key: string; theme: string; finish: string; status: string; scale: number; page?: string | null; frame?: string; href?: string };
export type ReviewIndex = { numberFrom?: number; screens: { name: string; label?: string; defaultLabel?: string; axes?: { name: string; label: string; toggle: boolean; options: { name: string; label: string }[] }[]; states: { name: string; label: string }[] }[] };
export type ReviewExtra = { frames?: Record<string, string>; css?: string; index?: ReviewIndex | null; canvas?: boolean; notes?: { flow: string; logo?: string | null; name?: string } };

export function reviewPage(all: ReviewRow[], title: string, extra: ReviewExtra = {}): string {
  const firstFinish = new Map<string, string>();
  for (const r of all) if (!firstFinish.has(r.key)) firstFinish.set(r.key, r.finish);
  const rows = all.filter((r) => r.finish === firstFinish.get(r.key));
  const js = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${extra.notes ? (extra.notes.name ? extra.notes.name.replace(/</g, "&lt;") + " · review" : "Flow Review") : extra.canvas ? "Screen Canvas" : "Mockup Review"}</title><style>
:root{--bg:#f4f4f6;--panel:#fff;--ink:#16151a;--sub:#6b6873;--line:#e6e5ea;--soft:#f1f0f4;--on:#16151a;--onInk:#fff;--dot:#d6d5dc;--canvas:#ececf0}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121115;--panel:#1b1a1f;--ink:#f2f1f5;--sub:#a19faa;--line:#2c2a31;--soft:#24232a;--on:#f2f1f5;--onInk:#121115;--dot:#2f2d35;--canvas:#16151a}}
:root[data-theme=dark]{--bg:#121115;--panel:#1b1a1f;--ink:#f2f1f5;--sub:#a19faa;--line:#2c2a31;--soft:#24232a;--on:#f2f1f5;--onInk:#121115;--dot:#2f2d35;--canvas:#16151a}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--ink);font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;display:flex}
button{font:inherit;color:inherit;cursor:pointer}
aside{width:320px;flex:none;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;height:100vh;position:relative;overflow:hidden}
.head{padding:16px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center}
.mark{width:34px;height:34px;border-radius:9px;background:var(--on);color:var(--onInk);display:flex;align-items:center;justify-content:center;font-weight:800}
.head small{display:block;color:var(--sub);font-size:11.5px}.head b{font-size:16px}
.head select{font:inherit;font-weight:700;font-size:15px;color:var(--ink);background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:5px 8px;max-width:100%;margin-top:2px}
.head .hb{width:34px;height:34px;flex:none;border:1px solid var(--line);background:var(--panel);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px}
.head .hb:hover{background:var(--soft)}.head .ht{flex:1;min-width:0}.head .ht b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head .hn{display:flex;gap:4px}.head .hn button{width:28px;height:28px;border:0;border-radius:7px;background:var(--soft);font-size:16px;font-weight:700;color:var(--sub)}.head .hn button:hover{color:var(--ink)}
.subsec{margin-top:12px}.subsec[hidden]{display:none}.sublab{font-size:11.5px;color:var(--sub);margin-bottom:6px}
.sec{padding:14px 16px;border-bottom:1px solid var(--line)}
.lab{font-size:12.5px;font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between}.lab span{color:var(--sub);font-weight:500;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.card{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px}
.card img{width:40px;height:66px;object-fit:cover;object-position:top;border-radius:6px;background:var(--soft);flex:none}
.card div{flex:1;min-width:0}.card b{display:block;font-size:14px}.card i{display:block;font-style:normal;font-size:11.5px;color:var(--sub)}
.card button{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:6px 11px;font-weight:700;font-size:12.5px}
.num{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--sub);font-weight:600}
.seg{display:flex;background:var(--soft);border-radius:9px;padding:3px;gap:2px}
.seg button{flex:1;border:0;background:transparent;border-radius:7px;padding:7px 6px;font-size:12.5px;font-weight:600;color:var(--sub);display:flex;flex-direction:column;align-items:center;gap:3px}
.seg button[aria-pressed=true]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.seg svg{width:18px;height:18px}
.seg .ic{display:inline-flex;align-items:center;gap:7px}.seg .ic svg{width:16px;height:16px}
.seg.devs button{padding:9px 6px}.seg.devs svg{width:20px;height:20px}
.picked{margin-top:8px;font-size:11.5px;color:var(--sub)}
.bar .grp{display:flex;background:var(--soft);border-radius:8px;padding:2px;gap:2px}
.bar .grp button{padding:4px 10px;font-size:12px}.bar .grp button[aria-pressed=true]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.grow{flex:1}
.foot{padding:12px 16px;border-top:1px solid var(--line);display:grid;gap:8px}
.foot a{display:flex;justify-content:center;gap:8px;background:var(--on);color:var(--onInk);border-radius:10px;padding:11px;font-weight:700;text-decoration:none}
.foot a[hidden]{display:none}
.foot small{color:var(--sub);font-family:ui-monospace,Menlo,monospace;font-size:11px;text-align:center}
/* the screen picker: a panel over the left panel */
.picker{position:absolute;inset:0;background:var(--panel);z-index:5;display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .22s cubic-bezier(.2,.7,.2,1)}
.picker.on{transform:none}
.ptop{border-bottom:1px solid var(--line)}
.ph{padding:16px 16px 4px;display:flex;align-items:center;gap:12px}
.ph .ht{flex:1;min-width:0}.ph .ht small{display:block;color:var(--sub);font-size:11.5px}.ph .ht b{font-size:16px}
.ph .hb{width:34px;height:34px;flex:none;border:1px solid var(--line);background:var(--panel);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px}.ph .hb:hover{background:var(--soft)}
.plist{flex:1;overflow:auto;padding:8px}
.pi{width:100%;border:0;background:transparent;border-radius:10px;padding:8px;display:flex;gap:12px;align-items:center;text-align:left}
.pi:hover{background:var(--soft)}.pi[aria-current=true]{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--on)}
.pv{width:auto;flex:none}.pv button{flex:none;padding:0;width:34px;height:32px;display:flex;align-items:center;justify-content:center}.pv svg{width:16px;height:16px}
.ps{padding:10px 16px 14px;display:flex;gap:8px;align-items:center}.ps input{flex:1;min-width:0;border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:9px;padding:9px 11px;font:inherit;outline:none}
.ps input:focus{border-color:var(--on)}
.plist.g{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start}
.plist.g .pi{flex-direction:column;align-items:stretch;gap:6px;padding:8px}
.plist.g .pi img{width:100%;height:auto;object-fit:contain}
.plist.g .pi div{text-align:center}
.pnone{color:var(--sub);padding:16px;text-align:center}
.pi img{width:40px;height:66px;object-fit:cover;object-position:top;border-radius:6px;background:var(--soft);flex:none}
.pi b{display:block;font-size:13.5px}.pi .psub{display:block;color:var(--sub);font-size:12px;font-weight:500;margin-top:1px}
main{flex:1;position:relative;height:100vh;overflow:auto;background-color:var(--canvas);background-image:radial-gradient(var(--dot) 1px,transparent 1.2px);background-size:18px 18px}
.bar{position:fixed;top:14px;left:calc(320px + (100vw - 320px) / 2);transform:translateX(-50%);z-index:3;width:max-content;display:flex;align-items:center;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:5px 6px;box-shadow:0 4px 14px rgba(0,0,0,.06)}
.bar b{padding:0 8px;font-size:13px}.bar .zv{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace;font-size:12px}.bar button{border:0;background:transparent;border-radius:7px;padding:5px 9px;color:var(--sub);font-weight:700}
.bar button:hover{background:var(--soft);color:var(--ink)}.bar .sep{width:1px;height:18px;background:var(--line);margin:0 2px}
.stage{min-height:100vh;display:flex;align-items:safe center;justify-content:safe center;padding:84px 40px 72px}
.one{display:flex;flex-direction:column;align-items:center;gap:10px}
.cap{font-size:12.5px;color:var(--ink);font-weight:700;text-align:center;line-height:1.35}.cap span{display:block;color:var(--sub);font-weight:500;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.cap .num{display:inline;margin-right:6px}.cap .cst,h3 .cst{display:block;color:var(--sub);font-weight:500;font-size:12px;margin-top:2px}h3 .cst{display:inline;margin:0 0 0 8px}
.one img{max-height:calc(100vh - 170px);max-width:calc(100vw - 420px);display:block}
.one.actual img{max-height:none;max-width:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cell,220px),1fr));gap:28px 22px;width:100%;align-items:start}
.rows{width:100%;display:grid;gap:44px;align-content:start}
.dsec h3{margin:0 0 16px;font-size:14px;display:flex;gap:8px;align-items:center}.dsec h3 svg{width:18px;height:18px}.dsec h3 span{color:var(--sub);font-weight:500;font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
.srow2 h3{margin:0 0 12px;font-size:13.5px;display:flex;gap:8px;align-items:baseline}
.srow2 .devs{display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}
.srow2 figure,.multi figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:zoom-in}
.multi{display:flex;gap:36px;align-items:flex-start;justify-content:center}
.multi figure{cursor:default}
.grid figure{margin:0;display:grid;gap:8px;justify-items:center;cursor:zoom-in}.grid img{width:100%;height:auto}
.empty{color:var(--sub)}
.states{display:flex;flex-direction:column;gap:2px}
.states button{display:flex;align-items:center;gap:10px;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px;color:var(--sub);font-weight:600}
.states button i{width:7px;height:7px;border-radius:50%;background:var(--line);flex:none}
.states button[aria-pressed=true]{background:var(--soft);color:var(--ink)}.states button[aria-pressed=true] i{background:var(--on)}
.axis{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0}.axis>span{font-weight:600;color:var(--sub)}
.axis select{flex:1;max-width:190px;font:inherit;font-weight:600;color:var(--ink);background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
.sw{width:38px;height:22px;border-radius:11px;border:0;background:color-mix(in srgb,var(--sub) 45%,transparent);position:relative;padding:0;flex:none}.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}
.sw[aria-checked=true]{background:var(--on)}.sw[aria-checked=true]::after{left:19px}
.live{position:relative;flex:none}.live.lt{overflow:hidden;width:0;height:0}
.grid figure,.plist.g .pi,.srow2 figure{min-width:0}.live.lt iframe{pointer-events:none}
.card .live.lt{border-radius:6px;flex:none}.live .lz{position:absolute;left:0;top:0;transform-origin:0 0}
.multi .live+.cap{margin-top:18px}
${extra.css ?? ""}
${extra.notes ? NOTES_CSS : ""}
</style></head><body>
<aside>
  <div class="head" id="head"></div>
  <div class="sec"><div class="lab">Screens <span id="scount"></span></div><div class="seg" id="smode"></div><div class="card" id="card" style="margin-top:10px"></div>
    <div class="subsec" id="groupsec" hidden><div class="sublab">Group by</div><div class="seg" id="group"></div></div>
    <div class="subsec" id="viewsec" hidden><div class="sublab">View</div><div class="seg" id="view"></div></div></div>
  <div class="sec" id="statesec" hidden><div class="lab">States <span id="stcount"></span></div><div class="seg" id="stmode"></div><div class="states" id="states" style="margin-top:8px"></div></div>
  <div class="sec"><div class="lab">Devices <span id="devname"></span></div><div class="seg devs" id="devices"></div><div class="picked" id="devpicked"></div></div>
  <div class="sec"><div class="lab">Theme</div><div class="seg" id="themes"></div></div>
  <div class="grow"></div>
  <div class="foot"><a id="open" target="_blank">Open PNG</a><small id="fmeta"></small></div>
  <div class="picker" id="picker" role="dialog" aria-label="Screens"><div class="ptop"><div class="ph"><button class="hb" id="pclose" title="Back (Esc)" aria-label="Back">←</button><div class="ht"><small id="pcount"></small><b>Choose a screen</b></div></div><div class="ps"><div class="seg pv" id="pview"></div><input id="psearch" type="search" placeholder="Search screens" autocomplete="off"></div></div><div class="plist" id="plist"></div></div>
</aside>
<main id="main"><div class="bar" id="bar"></div><div class="stage" id="stage"></div></main>
${extra.notes ? notesHtml(extra.notes.logo, extra.notes.name) : ""}
<script>
const ROWS=${js(rows)}, FRAMES=${js(extra.frames ?? {})};
const INDEX=${js(extra.index ?? null)}, FROM=INDEX&&typeof INDEX.numberFrom==="number"?INDEX.numberFrom:1;
const uniq=(a)=>[...new Set(a)];
// screens in the run's order, their states (screen@state renders) apart
const SCREENS=INDEX?INDEX.screens.map(s=>s.name).filter(n=>ROWS.some(r=>r.screen===n)):uniq(ROWS.map(r=>r.screen.split("@")[0])), THEMES=uniq(ROWS.map(r=>r.theme)).sort((a,b)=>(a==="light"?0:1)-(b==="light"?0:1));
/* a flow another lends this one (flex review's "use") is one item here, like a screen: its screens together, opened
   the way a screen opens on its states. ITEMS: the host's own list, a screen or such a flow */
const grp=(s)=>entry(s).group||"";
const ITEMS=()=>{const out=[];for(const s of SCREENS){const g=grp(s),last=out[out.length-1];if(g&&last&&last.g===g){last.ss.push(s);continue}out.push(g?{g,ss:[s]}:{s,ss:[s]})}return out};
const itemOf=(s)=>ITEMS().find(it=>it.ss.includes(s));
const inum=(i)=>String(i+FROM).padStart(2,"0");
const num=(s)=>{const its=ITEMS(),i=its.findIndex(it=>it.ss.includes(s)),it=its[i];return it&&it.g?inum(i)+"."+(it.ss.indexOf(s)+1):inum(i<0?SCREENS.indexOf(s):i)};
const entry=(s)=>(INDEX&&INDEX.screens.find(x=>x.name===s))||{name:s,states:[]};
const lbl=(s)=>(entry(s).label||s).replace(/</g,"&lt;");
const states=(s)=>entry(s).states.filter(st=>ROWS.some(r=>r.screen===s+"@"+st.name));
const LIVE=ROWS.some(r=>(r.page||r.href)&&r.frame&&FRAMES[r.frame]);
// a live canvas (flex mockup --canvas): no PNGs at all, every picture is the device frame running the app at its link
const CANVAS=ROWS.length>0&&ROWS.every(r=>!r.file&&r.href);
const liveSrc=(r)=>r.page?encodeURI(r.page):r.href;
const ICON={phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
tablet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
land:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M18 11v2"/></svg>',
laptop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
window:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 8.5h18"/></svg>'};
const UI={all:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
one:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3.5" width="14" height="17" rx="2"/></svg>',
light:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
dark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'};
const kind=(k)=>/landscape/.test(k)?"land":/ipad|tablet/.test(k)?"tablet":/iphone|android/.test(k)?"phone":/mac|display|pc/.test(k)?"laptop":"window";
const label=(k)=>(ROWS.find(r=>r.key===k)||{}).device||k;
const NAME={phone:"Phone",tablet:"Tablet",land:"Tablet landscape",laptop:"Laptop",window:"Window"};
// one device per category, Android left out unless it's the only phone
const keys=uniq(ROWS.map(r=>r.key));
const CATS=[];for(const c of ["phone","tablet","land","laptop","window"]){const ks=keys.filter(k=>kind(k)===c);const k=ks.find(k=>!/^android/.test(k))||ks[0];if(k)CATS.push({c,k})}
const Q=new URLSearchParams(location.search);
const TITLE=${js(title)};
let Z=1; /* the canvas zoom: −/+, ⌘ −/+/0, pinch; back to 1 whenever the view changes */
const S0V=Q.get("view");
// landing: a list of one screen opens on that screen; a screen with states opens on all of them (stmode "all" is a
// no-op for a screen without states)
const S={sub:Q.get("sub")||"",stmode:Q.has("stmode")&&Q.get("stmode")!=="all"?"one":"all",view:CANVAS?"live":S0V==="render"||!LIVE?"render":"live",state:Q.get("state")||"",group:Q.get("group")==="screen"?"screen":"device",screens:Q.get("screens")==="one"||(!Q.has("screens")&&SCREENS.length===1)?"one":"all",screen:SCREENS.includes(Q.get("screen"))?Q.get("screen"):SCREENS[0],
  devs:new Set((Q.has("devices")?Q.get("devices"):(CATS.some(x=>x.c==="phone")?"phone":"")).split(",").filter(c=>CATS.some(x=>x.c===c))),theme:THEMES.includes(Q.get("theme"))?Q.get("theme"):THEMES[0]};
let ANCHOR=0; /* the device picker's last plain or ⌘ click, where a Shift-click range starts */
const shown=()=>CATS.filter(x=>!S.devs.size||S.devs.has(x.c));
const row=(screen,key,theme)=>ROWS.find(r=>r.screen===screen&&r.key===key&&r.theme===theme);
const thumb=(s)=>row(s,(shown()[0]||CATS[0]).k,S.theme)||ROWS.find(r=>r.screen===s);
const src=(r)=>encodeURI(r.file);
// a screen as a picture: its PNG, or on a canvas the device frame running the app (lazy: a frame loads when it shows)
/* a canvas's small picture of a screen: its device frame running the app (flex review: a snapshot instead) */
let THUMB=(r)=>FRAMES[r.frame].replace("__SRC__",liveSrc(r));
/* a screen opened on its own: its device frame running the app (flex review's published copy: a frame with a setup is its snapshot) */
let LIVE1=(r)=>FRAMES[r.frame].replace("__SRC__",liveSrc(r)).replace(' loading="lazy"',"");
const pic=(r,extra)=>CANVAS?'<div class="live lt" data-r="'+ROWS.indexOf(r)+'" '+(extra||"")+'><div class="lz">'+THUMB(r)+"</div></div>":'<img '+(extra||"")+' loading="lazy" src="'+src(r)+'" alt="">';
// live pictures take their box's width (a grid cell, a card's thumb: data-w), once laid out
function fitLive(root){root.querySelectorAll(".live.lt").forEach(l=>{const z=l.firstElementChild,f=z.firstElementChild;if(!f)return;const p=l.parentElement,cs=getComputedStyle(p),box=+l.dataset.w||p.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);const w=f.offsetWidth,h=f.offsetHeight,k=box/w;z.style.transform="scale("+k+")";l.style.width=w*k+"px";l.style.height=h*k+"px"})}
const cur1=()=>S.state?S.screen+"@"+S.state:S.screen;
function keep(){const q=new URLSearchParams({sub:S.sub,stmode:S.stmode,view:S.view,state:S.state,group:S.group,screens:S.screens,screen:S.screen,theme:S.theme,devices:[...S.devs].join(",")});history.replaceState(null,"",location.pathname+"?"+q)}
function seg(el,items,isOn,on,render){el.innerHTML="";for(const it of items){const b=document.createElement("button");b.setAttribute("aria-pressed",isOn(it));b.innerHTML=render(it);b.onclick=(e)=>on(it,e);el.appendChild(b)}}
const IC=(d)=>'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">'+d+"</svg>";
const UI2={flow:IC('<path d="M5 6h7a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h1"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/>'),device:IC('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>'),screen:IC('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>'),
live:IC('<path d="M5 3.5l14 8.5-14 8.5z"/>'),render:IC('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>')};
// a screen canvas can sit among others (one per screens list): their lists.json, beside it or one folder up, gives a
// switcher in the header
let LISTS=null;
if(CANVAS)fetch("lists.json").then(r=>r.ok?r.json():fetch("../lists.json").then(r=>r.ok?r.json():null)).then(j=>{if(j&&j.length>1){LISTS=j;head()}}).catch(()=>{});
function listSwitch(){
  if(!LISTS)return "<b>"+TITLE.replace(/</g,"&lt;")+"</b>";
  const here=location.pathname.replace(/index\.html$/,"");
  return '<select id="lists" aria-label="Screens list">'+LISTS.map(l=>'<option value="'+l.href+'"'+(here===l.href?" selected":"")+">"+l.title.replace(/</g,"&lt;")+"</option>").join("")+"</select>";
}
function head(){
  const h=document.getElementById("head");
  if(S.screens!=="one"){h.innerHTML='<div class="mark">F</div><div class="ht"><small>'+(CANVAS?${extra.notes ? '"Flow review"' : '"Screen canvas"'}:"Flex · mockup review")+'</small>'+(CANVAS?listSwitch():"<b>"+TITLE.replace(/</g,"&lt;")+"</b>")+"</div>";
    const sel=document.getElementById("lists");if(sel)sel.onchange=()=>{location.href=sel.value};return}
  h.innerHTML='<button class="hb" id="hback" title="All screens (Esc)" aria-label="All screens">←</button><div class="ht"><small>Screen '+num(S.screen)+" of "+num(SCREENS[SCREENS.length-1])+"</small><b>"+lbl(S.screen)+'</b></div><div class="hn"><button id="hprev" title="Previous (←)" aria-label="Previous screen">‹</button><button id="hnext" title="Next (→)" aria-label="Next screen">›</button></div>';
  document.getElementById("hback").onclick=()=>{S.screens="all";go()};
  document.getElementById("hprev").onclick=()=>step(-1);document.getElementById("hnext").onclick=()=>step(1);
}
function panel(){
  head();
  const gs=document.getElementById("groupsec");gs.hidden=!(S.screens==="all"&&shown().length>1);
  seg(document.getElementById("group"),["device","screen"],(g)=>S.group===g,(g)=>{S.group=g;go()},(g)=>'<span class="ic">'+UI2[g]+(g==="device"?"Device":"Screen")+"</span>");
  const vs=document.getElementById("viewsec");vs.hidden=CANVAS||!(LIVE&&S.screens==="one"&&!(states(S.screen).length&&S.stmode==="all"));
  seg(document.getElementById("view"),["live","render"],(v)=>S.view===v,(v)=>{S.view=v;go()},(v)=>'<span class="ic">'+UI2[v]+(v==="live"?"Live":"Render")+"</span>");
  seg(document.getElementById("stmode"),["one","all"],(m)=>S.stmode===m,(m)=>{S.stmode=m;go()},(m)=>'<span class="ic">'+UI[m==="all"?"all":"one"]+(m==="all"?"All":"One")+"</span>");
  seg(document.getElementById("smode"),["all","one"],(m)=>S.screens===m,(m)=>{S.screens=m;go()},(m)=>'<span class="ic">'+UI[m]+(m==="all"?"All":"One")+"</span>");
  document.getElementById("scount").textContent=S.screens==="one"?num(S.screen)+" of "+num(SCREENS[SCREENS.length-1]):SCREENS.length+" screens";
  const card=document.getElementById("card"),t=thumb(S.screen);
  card.style.display=S.screens==="one"?"flex":"none";
  card.innerHTML=(t?pic(t,'data-w="40"'):"")+'<div><span class="num">'+num(S.screen)+'</span><b>'+lbl(S.screen)+'</b></div><button id="change">Change</button>';
  document.getElementById("change").onclick=openPicker;
  fitLive(card);
  seg(document.getElementById("devices"),CATS,(x)=>S.devs.has(x.c),(x,e)=>{
    // as Finder: a click shows that one, Shift-click the range from the last click, ⌘-click adds or removes one
    const i=CATS.indexOf(x);
    if(e&&e.shiftKey){const a=Math.min(ANCHOR,i),b=Math.max(ANCHOR,i);S.devs=new Set(CATS.slice(a,b+1).map(y=>y.c))}
    else if(e&&(e.metaKey||e.ctrlKey)){S.devs.has(x.c)?S.devs.delete(x.c):S.devs.add(x.c);ANCHOR=i}
    else{S.devs=new Set([x.c]);ANCHOR=i}
    go()},(x)=>ICON[x.c]);
  document.querySelectorAll("#devices button").forEach((b,i)=>{b.title=NAME[CATS[i].c]+" (Shift-click: a range, ⌘-click: add or remove)";b.setAttribute("aria-label",NAME[CATS[i].c])});
  const picked=document.getElementById("devpicked");picked.textContent=S.devs.size>1?[...S.devs].map(c=>NAME[c]).join(" · "):"";picked.style.display=S.devs.size>1?"block":"none";
  document.getElementById("devname").textContent=S.devs.size===1?NAME[[...S.devs][0]]:S.devs.size?S.devs.size+" of "+CATS.length:"all";
  seg(document.getElementById("themes"),THEMES,(t)=>t===S.theme,(t)=>{S.theme=t;go()},(t)=>'<span class="ic">'+(UI[t]||"")+t[0].toUpperCase()+t.slice(1)+"</span>");
  const sts=states(S.screen),sec=document.getElementById("statesec");
  sec.hidden=S.screens!=="one"||!sts.length;
  document.getElementById("stcount").textContent=sts.length+1+"";
  const sl=document.getElementById("states");sl.innerHTML="";sl.style.display=S.stmode==="all"?"none":"flex";
  const axes=entry(S.screen).axes||[];
  if(axes.length){
    // composable states: a select or a switch per axis; the state's name is the non-default picks and the toggles on
    const parts=S.state?S.state.split("+"):[];
    const val=axes.map(ax=>ax.toggle?parts.includes(ax.name):(ax.options.find(o=>parts.includes(o.name))||ax.options[0]).name);
    const name=(v)=>axes.flatMap((ax,i)=>ax.toggle?(v[i]?[ax.name]:[]):(v[i]!==ax.options[0].name?[v[i]]:[])).join("+");
    const set=(v)=>{const n=name(v);S.state=!n||states(S.screen).some(x=>x.name===n)?n:S.state;go()};
    axes.forEach((ax,i)=>{const r=document.createElement("label");r.className="axis";r.innerHTML="<span>"+ax.label.replace(/</g,"&lt;")+"</span>";
      if(ax.toggle){const b=document.createElement("button");b.className="sw";b.setAttribute("role","switch");b.setAttribute("aria-checked",val[i]);b.onclick=(e)=>{e.preventDefault();const v=[...val];v[i]=!v[i];set(v)};r.appendChild(b)}
      else{const sel=document.createElement("select");sel.innerHTML=ax.options.map(o=>'<option value="'+o.name+'"'+(o.name===val[i]?" selected":"")+">"+o.label.replace(/</g,"&lt;")+"</option>").join("");sel.onchange=()=>{const v=[...val];v[i]=sel.value;set(v)};r.appendChild(sel)}
      sl.appendChild(r)});
  }else
  for(const st of [{name:"",label:entry(S.screen).defaultLabel||"Default"},...sts]){const b=document.createElement("button");b.setAttribute("aria-pressed",S.state===st.name);b.innerHTML="<i></i>"+st.label.replace(/</g,"&lt;");b.onclick=()=>{S.state=st.name;go()};sl.appendChild(b)}
  const cur=S.screens==="one"&&shown().length===1?row(cur1(),shown()[0].k,S.theme):null,open=document.getElementById("open");
  open.hidden=!cur||CANVAS;document.getElementById("fmeta").textContent=cur?cur.file:shown().length+" device"+(shown().length===1?"":"s")+" · "+S.theme;if(cur)open.href=src(cur);
}
let PV=(()=>{try{return localStorage.getItem("flex-review-picker")||"grid"}catch{return "grid"}})();
/* the picker's thumbnails are always the phone render, so list and grid read alike whatever devices are shown */
const phoneKey=(CATS.find(x=>x.c==="phone")||CATS[0]).k;
const pthumb=(s)=>row(s,phoneKey,S.theme)||ROWS.find(r=>r.screen===s);
function fillPicker(){
  const q=document.getElementById("psearch").value.trim().toLowerCase();
  seg(document.getElementById("pview"),["list","grid"],(v)=>v===PV,(v)=>{PV=v;try{localStorage.setItem("flex-review-picker",v)}catch{};fillPicker()},(v)=>v==="list"?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>':UI.all);
  document.querySelectorAll("#pview button").forEach((b,i)=>{const n=["List","Grid"][i];b.title=n;b.setAttribute("aria-label",n)});
  document.getElementById("pcount").textContent=SCREENS.length+" screens";
  const l=document.getElementById("plist");l.className="plist"+(PV==="grid"?" g":"");l.innerHTML="";
  const hits=SCREENS.filter(s=>!q||s.toLowerCase().includes(q)||lbl(s).toLowerCase().includes(q)||num(s).includes(q));
  for(const s of hits){const t=pthumb(s);const b=document.createElement("button");b.className="pi";b.setAttribute("aria-current",s===S.screen);
    const ns=states(s).length+1;
    b.innerHTML=(t?pic(t,PV==="grid"?"":'data-w="40"'):"")+'<div><span class="num">'+num(s)+'</span><b>'+lbl(s)+'</b><small class="psub">'+ns+" state"+(ns===1?"":"s")+"</small></div>";
    b.onclick=()=>{closePicker();openScreen(s)};l.appendChild(b)}
  requestAnimationFrame(()=>fitLive(l));
  if(!hits.length)l.innerHTML='<div class="pnone">No screen matches “'+q.replace(/</g,"&lt;")+'”.</div>';
}
function openPicker(){
  document.getElementById("psearch").value="";fillPicker();
  document.getElementById("picker").classList.add("on");
  setTimeout(()=>document.getElementById("psearch").focus(),50);
}
document.getElementById("psearch").addEventListener("input",fillPicker);
document.getElementById("psearch").addEventListener("keydown",(e)=>{if(e.key==="Enter"){const f=document.querySelector("#plist .pi");if(f)f.click()}});
function closePicker(){document.getElementById("picker").classList.remove("on")}
const pickerOpen=()=>document.getElementById("picker").classList.contains("on");
document.getElementById("pclose").onclick=closePicker;
function bar(){
  // the canvas keeps only its zoom: what's shown is set in the left panel
  const b=document.getElementById("bar");
  b.innerHTML='<button id="zout" title="Zoom out (⌘−)" aria-label="Zoom out">−</button><b class="zv" id="zv"></b><button id="zin" title="Zoom in (⌘+)" aria-label="Zoom in">+</button><span class="sep"></span><button id="zfit" title="Fit (⌘0)">Fit</button>';
  document.getElementById("zout").onclick=()=>zoom(Z/1.25);document.getElementById("zin").onclick=()=>zoom(Z*1.25);document.getElementById("zfit").onclick=()=>zoom(1);
  zoomLabel();
}
function zoomLabel(){const v=document.getElementById("zv");if(v)v.textContent=Math.round(Z*100)+"%"}
function zoom(z,cx,cy){
  const m=document.getElementById("main"),c=CUR();if(!c)return;
  z=Math.min(6,Math.max(0.2,z));
  // keep the point under the cursor (or the canvas middle) where it is
  const r=m.getBoundingClientRect(),px=(cx??r.left+r.width/2)-r.left,py=(cy??r.top+r.height/2)-r.top;
  const fx=(m.scrollLeft+px)/Z,fy=(m.scrollTop+py)/Z;
  // a transform, not CSS zoom: zoom reaches into the live frames, where an app's measured sizes then disagree with its
  // layout. The content keeps its own size (width fixed, as it was laid out) and its margins take up what the scale adds
  if(!c.dataset.w){c.dataset.w=c.offsetWidth;c.dataset.h=c.offsetHeight}
  const w=+c.dataset.w,h=+c.dataset.h;
  Z=z;zoomLabel();
  Object.assign(c.style,{transformOrigin:"0 0",transform:Z===1?"":"scale("+Z+")",width:w+"px",flex:"none",marginRight:w*(Z-1)+"px",marginBottom:h*(Z-1)+"px"});
  m.scrollLeft=fx*Z-px;m.scrollTop=fy*Z-py;
}
const fig=(r,c)=>'<figure data-s="'+r.screen+'"><img src="'+src(r)+'" data-s2="'+r.scale+'" alt="">'+(shown().length>1?'<div class="cap">'+NAME[c]+"</div>":"")+"</figure>";
/* true relative size: an image's points (pixels / its scale) times one factor k */
function size(imgs,k){imgs.forEach(i=>{i.style.width=i.naturalWidth/+i.dataset.s2*k+"px"})}
function stage(){
  // st0 the stage, st where this view is drawn: the stage itself (flex review: one of its views, or none when the view
  // it keeps for this is already there)
  const st0=document.getElementById("stage");st0.style.alignItems=S.screens==="all"?"flex-start":"safe center";
  const st=HOST(st0);if(!st)return;
  const devs=shown();
  if(S.screens==="one"&&S.stmode==="all"&&states(S.screen).length){
    // every state of this screen, each device in turn
    const all=[{name:"",label:entry(S.screen).defaultLabel||"Default"},...states(S.screen)];
    st0.style.alignItems="flex-start";
    st.innerHTML='<div class="rows">'+devs.map(x=>{const fs=all.map(z=>({z,r:row(z.name?S.screen+"@"+z.name:S.screen,x.k,S.theme)})).filter(o=>o.r)
      .map(o=>'<figure data-st="'+o.z.name+'">'+pic(o.r)+'<div class="cap">'+o.z.label.replace(/</g,"&lt;")+"</div></figure>").join("");
      return fs?'<section class="dsec">'+(devs.length>1?'<h3>'+ICON[x.c]+NAME[x.c]+'</h3>':'')+'<div class="grid" style="--cell:'+({phone:"220px",tablet:"280px",land:"360px",laptop:"400px"}[x.c]||"300px")+'">'+fs+"</div></section>":""}).join("")+"</div>";
    fitLive(st);
    st.querySelectorAll("figure[data-st]").forEach(f=>f.onclick=()=>{S.state=f.dataset.st;S.stmode="one";go()});
    return}
  if(S.screens==="one"){
    const rs=devs.map(x=>({x,r:row(cur1(),x.k,S.theme)})).filter(o=>o.r);
    if(S.view==="live"&&rs.some(o=>(o.r.page||o.r.href)&&FRAMES[o.r.frame])){
      // each device's CSS frame around its frozen page, laid out at its own size, then scaled as one to fit
      st.innerHTML='<div class="multi">'+rs.map(o=>'<figure><div class="live" data-r="'+ROWS.indexOf(o.r)+'"><div class="lz">'+((o.r.page||o.r.href)&&FRAMES[o.r.frame]?LIVE1(o.r):'<img src="'+src(o.r)+'" alt="">')+'</div></div>'+(rs.length>1?'<div class="cap">'+NAME[o.x.c]+"</div>":"")+"</figure>").join("")+"</div>";
      const ls=[...st.querySelectorAll(".lz")],pts=ls.map(z=>({w:z.firstElementChild.offsetWidth||z.offsetWidth,h:z.firstElementChild.offsetHeight||z.offsetHeight}));
      const W=st0.clientWidth-80-36*(ls.length-1),H=window.innerHeight-200,k=Math.min(1,W/pts.reduce((a,p)=>a+p.w,0),H/Math.max(...pts.map(p=>p.h)));
      ls.forEach((z,i)=>{z.style.transform="scale("+k+")";z.parentElement.style.width=pts[i].w*k+"px";z.parentElement.style.height=pts[i].h*k+"px"});
      return}
    st.innerHTML=rs.length?'<div class="multi">'+rs.map(o=>fig(o.r,o.x.c)).join("")+"</div>":'<div class="empty">No '+S.theme+" render of "+S.screen+".</div>";
    const imgs=[...st.querySelectorAll("img")];
    Promise.all(imgs.map(i=>i.decode().catch(()=>{}))).then(()=>{if(!imgs.length)return;
      const pts=imgs.map(i=>({w:i.naturalWidth/+i.dataset.s2,h:i.naturalHeight/+i.dataset.s2}));
      const W=st0.clientWidth-80-36*(imgs.length-1),H=window.innerHeight-200;
      size(imgs,Math.min(W/pts.reduce((a,p)=>a+p.w,0),H/Math.max(...pts.map(p=>p.h))))});
    return}
  if(S.group==="screen"&&devs.length>1){
    // each screen in turn, its devices side by side at their true relative size
    st.innerHTML='<div class="rows">'+SCREENS.map(sc=>{const fs=devs.map(x=>{const r=row(sc,x.k,S.theme);return r?'<figure data-s="'+r.screen+'">'+(CANVAS?pic(r):'<img src="'+src(r)+'" data-s2="'+r.scale+'" alt="">')+'<div class="cap">'+NAME[x.c]+'</div></figure>':""}).join("");
      return fs?'<section class="srow2"><h3><span class="num">'+num(sc)+"</span>"+lbl(sc)+stCount(sc)+'</h3><div class="devs">'+fs+"</div></section>":""}).join("")+"</div>";
    if(CANVAS){
      // true relative size: one scale for every frame, the tallest 300 px high
      const ls=[...st.querySelectorAll(".live.lt")],H=Math.max(...ls.map(l=>l.firstElementChild.firstElementChild.offsetHeight));
      ls.forEach(l=>{const f=l.firstElementChild.firstElementChild;l.dataset.w=f.offsetWidth*300/H});fitLive(st);
    }else{
    const imgs=[...st.querySelectorAll("img")];
    Promise.all(imgs.map(i=>i.decode().catch(()=>{}))).then(()=>{const H=Math.max(...imgs.map(i=>i.naturalHeight/+i.dataset.s2));size(imgs,300/H)});
    }
    st.querySelectorAll("figure[data-s]").forEach(f=>f.onclick=()=>openScreen(f.dataset.s));st.querySelectorAll("figure[data-g]").forEach(f=>f.onclick=()=>openGroup(f.dataset.g));
    return}
  // each device in turn, its screens following one grid (cell width by the device's kind)
  st.innerHTML='<div class="rows">'+devs.map(x=>{
    const figOf=(sc)=>{const r=row(sc,x.k,S.theme);return r?'<figure data-s="'+r.screen+'">'+pic(r)+'<div class="cap"><span class="num">'+num(r.screen)+"</span>"+lbl(r.screen)+stCount(r.screen)+"</div></figure>":""};
    // an opened used flow: its screens; else the host's items, a used flow as one tile (its first screen's picture)
    const fs=S.sub?SCREENS.filter(sc=>grp(sc)===S.sub).map(figOf).join(""):ITEMS().map((it,i)=>{if(!it.g)return figOf(it.s);
      const r=row(it.ss[0],x.k,S.theme);return r?'<figure data-g="'+it.g.replace(/"/g,"&quot;")+'">'+pic(r)+'<div class="cap"><span class="num">'+inum(i)+"</span>"+it.g.replace(/</g,"&lt;")+'<small class="cst">'+it.ss.length+" screen"+(it.ss.length===1?"":"s")+"</small></div></figure>":""}).join("");
    return fs?'<section class="dsec">'+(devs.length>1?'<h3>'+ICON[x.c]+NAME[x.c]+'</h3>':'')+'<div class="grid" style="--cell:'+({phone:"200px",tablet:"260px",land:"340px",laptop:"380px"}[x.c]||"300px")+'">'+fs+"</div></section>":""}).join("")+"</div>";
  fitLive(st);
  st.querySelectorAll("figure[data-s]").forEach(f=>f.onclick=()=>openScreen(f.dataset.s));st.querySelectorAll("figure[data-g]").forEach(f=>f.onclick=()=>openGroup(f.dataset.g));
}
/* open a screen the way every way in does (the pickers, the grid, ←/→ rolling over): all its states when it has some */
function openScreen(s){S.screen=s;S.sub=grp(s);S.state="";S.screens="one";S.stmode="all";go()}
/* Esc: one rung up the ladder — a state → its screen's states → (inside a used flow) the used flow → all screens */
function up(){
  if(S.screens==="one"&&S.stmode==="one"&&states(S.screen).length){S.stmode="all";S.state="";go();return}
  if(S.screens==="one"){S.screens="all";go();return}
  if(S.sub){S.sub="";go()}}
/* a used flow opened: its screens, the way a screen opened shows its states */
function openGroup(g){S.sub=g;S.screens="all";S.state="";go()}
function openItem(it){if(it.g)openGroup(it.g);else openScreen(it.s)}
/* the next or previous list (flow) among its siblings, opened the way the flow picker opens one; flex review sets it */
let LISTSTEP=null;
/* ←/→ move among what's showing, rolling over into the level above at either end (and wrapping at the last list):
   all screens → lists · one screen (or all its states) → the list's screens, then the next list · one state → the
   screen's states, then the next screen (all its states) */
/* a screen's caption, under its name: how many states it has, as the flow cards say how many screens */
const stCount=(sc)=>{const n=states(sc).length+1;return '<small class="cst">'+n+" state"+(n===1?"":"s")+"</small>"};
function step(d){
  if(S.screens!=="one"&&S.sub){const its=ITEMS(),i=its.findIndex(it=>it.g===S.sub)+d;
    if(i>=0&&i<its.length){openItem(its[i]);return}if(LISTSTEP){LISTSTEP(d);return}openItem(its[(i+its.length)%its.length]);return}
  if(S.screens!=="one"){if(LISTSTEP)LISTSTEP(d);return}
  const sts=states(S.screen);
  if(sts.length&&S.stmode==="one"){const all=["",...sts.map(x=>x.name)],i=all.indexOf(S.state)+d;if(i>=0&&i<all.length){S.state=all[i];go();return}}
  // within an opened used flow, its screens; leaving it (or meeting one from outside), the next item opens as an item
  const to=(n)=>{if(S.sub&&grp(n)===S.sub)openScreen(n);else openItem(itemOf(n))};
  const j=SCREENS.indexOf(S.screen)+d;
  if(j>=0&&j<SCREENS.length){to(SCREENS[j]);return}
  if(LISTSTEP){LISTSTEP(d);return}
  to(SCREENS[(j+SCREENS.length)%SCREENS.length])}
/* after the canvas is drawn (the notes' pins, flex review) */
let AFTER=()=>{};
/* where stage() draws (HOST) and what the zoom scales (CUR): the stage and its content, unless flex review keeps
   views of its own */
let HOST=(s)=>s,CUR=()=>document.getElementById("stage").firstElementChild;
function go(){Z=1;if(!states(S.screen).some(x=>x.name===S.state))S.state="";keep();panel();bar();stage();AFTER()}
function stepState(d){const all=["",...states(S.screen).map(x=>x.name)];S.state=all[(all.indexOf(S.state)+d+all.length)%all.length];go()}
addEventListener("keydown",e=>{
  if(e.key==="Escape"){if(pickerOpen())closePicker();else up();return}
  if(pickerOpen())return;
  if(S.screens==="one"&&(e.key==="ArrowDown"||e.key==="ArrowUp")&&states(S.screen).length&&S.stmode==="one"){e.preventDefault();stepState(e.key==="ArrowDown"?1:-1)}
  if((S.screens==="one"||LISTSTEP)&&(e.key==="ArrowRight"||e.key==="ArrowLeft")){e.preventDefault();step(e.key==="ArrowRight"?1:-1)}});
// on a Deck page slide: the keys the board doesn't use go back to the deck (its ←/→, F, P), so slides still move
addEventListener("keydown",e=>{if(parent===window||e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||pickerOpen())return;
  const t=e.target,typing=t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));if(typing)return;
  const arrow=e.key==="ArrowLeft"||e.key==="ArrowRight";if(arrow&&(S.screens==="one"||LISTSTEP))return;
  if(arrow||e.key==="PageUp"||e.key==="PageDown"||e.key===" "||/^[fFpP]$/.test(e.key)){e.preventDefault();try{parent.postMessage({deck:"key",key:e.key},"*")}catch(_){}}});
addEventListener("resize",()=>{stage();Z=1;zoomLabel();AFTER()});
document.getElementById("main").addEventListener("wheel",(e)=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(Z*Math.exp(-e.deltaY*0.01),e.clientX,e.clientY)},{passive:false});
let G0=1;addEventListener("gesturestart",(e)=>{e.preventDefault();G0=Z});addEventListener("gesturechange",(e)=>{e.preventDefault();zoom(G0*e.scale,e.clientX,e.clientY)});
addEventListener("keydown",(e)=>{if(!(e.metaKey||e.ctrlKey))return;if(e.key==="="||e.key==="+"){e.preventDefault();zoom(Z*1.25)}else if(e.key==="-"){e.preventDefault();zoom(Z/1.25)}else if(e.key==="0"){e.preventDefault();zoom(1)}});
${extra.notes ? notesScript(extra.notes.flow) : ""}
go();
</script></body></html>`;
}

/* ── flex review's notes (extra.notes): the author pins a note to a spot on a frame, the agent replies in the notes
   file, Send hands the drafts over as a round. The page reads and writes the notes through flex review's server
   (/api/notes), polls them every 3 s, and lays an overlay over each live frame's screen for the pins (and, in Comment
   mode, the clicks that make a note; off, the frames take the clicks). ── */
const NOTES_CSS = `
:root{--pin:#2f6bff;--pinInk:#fff;--claude:#c96442}
.bar button[aria-pressed=true]{background:var(--on);color:var(--onInk)}
/* the canvas edge to edge: a slim bar across the top (the flow, View, Notes); the view controls and the notes' index
   drop down under their buttons; a note's thread floats by its pin; the tools and zoom float at the bottom */
body{display:block}main{width:100vw}.stage{padding-top:76px}
.ntop{position:fixed;z-index:30;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--panel);border-bottom:1px solid var(--line)}
.ngone{display:none!important}
.nperson{display:flex;align-items:center;justify-content:center}.nperson b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nperson small{color:var(--sub);font-size:12px;white-space:nowrap}.nav{flex:0 0 auto!important;width:26px!important;height:26px!important;min-width:26px;max-width:26px;border-radius:50%!important;padding:0!important}button[data-p]{align-items:center!important}[data-p] .nav{width:36px!important;height:36px!important;min-width:36px;max-width:36px;font-size:12.5px}.nav{flex:none;width:24px;height:24px;border-radius:50%;background:var(--pin);color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center}
.npl button{display:flex;align-items:center;gap:10px;border:0;background:none;border-radius:8px;padding:7px 9px;text-align:left;width:100%}.npl button:hover{background:var(--soft)}
.npl button span{flex:1;min-width:0}.npl button span b{display:block;font-size:13.5px}.npl button span small{color:var(--sub);font-size:12px}.npl .tick{flex:none;color:var(--pin);font-weight:800}
.npl button:disabled{opacity:.45;cursor:not-allowed}.npl button.cur{background:var(--soft)}.nstatic #nnotes,.nstatic #nside{display:none!important}.nstatic .nsnapw.nwait{animation:none}
.nsnapw.nwait.dk{background:linear-gradient(100deg,#1d1c22 35%,#2a2930 50%,#1d1c22 65%) 0 0/300% 100% #1d1c22}.nsnapw.dk .nshim{color:#77747f}
.nstgtag{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#5b5fc7;border-radius:6px;padding:3px 8px}
.nstgtag[data-env=staging]{background:#d9480f}.nstgtag[data-env=local]{background:#0d8a6a}
.seg button:disabled{opacity:.45;cursor:not-allowed}
.chev{margin-left:2px;color:var(--ink);flex:none;transition:transform .15s}[aria-expanded=true]>.chev{transform:rotate(180deg)}
.nhost{display:contents}.nhost[hidden]{display:none}
.nsnapw{overflow:hidden;background:var(--soft)}.nmoved{position:absolute;left:50%;bottom:56px;transform:translateX(-50%);white-space:nowrap;z-index:2;padding:8px 14px;border-radius:12px;background:#b45309;color:#fff;font:700 24px/1 -apple-system,system-ui,sans-serif;letter-spacing:.01em;box-shadow:0 2px 8px rgba(0,0,0,.25)}.nsnapw img{display:block;width:100%;height:100%;object-fit:cover}
.nsnapw.nwait{background:linear-gradient(100deg,#e9e7ee 35%,#f6f5f8 50%,#e9e7ee 65%) 0 0/300% 100% #e9e7ee;animation:nshim 1.6s linear infinite}
@keyframes nshim{from{background-position:100% 0}to{background-position:0 0}}
.nshim{position:absolute;left:0;right:0;top:46%;text-align:center;font:600 24px/1 -apple-system,system-ui,sans-serif;color:#9a97a3;letter-spacing:.02em}
.nname{font-size:14px;white-space:nowrap}.ncount{font-size:13px;color:var(--sub);font-weight:600}
.nscr{display:flex;align-items:center;gap:7px;border:1px solid transparent;background:none;border-radius:8px;padding:5px 9px;max-width:440px;min-width:0}
.nscr:hover,.nscr[aria-expanded=true]{background:var(--soft);border-color:var(--line)}.nscr b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nscr i{font-style:normal;color:var(--sub);font-size:13px;white-space:nowrap}.nscr .pic{display:flex;flex:none;color:var(--sub)}.nscr .car{color:var(--sub);font-size:11px}
.nspick{position:fixed;z-index:46;width:360px;max-width:calc(100vw - 24px);overflow-x:hidden;max-height:min(560px,calc(100vh - 80px));background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.16);display:flex;flex-direction:column;overflow:hidden}
.nspick input{margin:10px 10px 4px;border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:9px;padding:8px 10px;font:inherit;outline:none}.nspick input:focus{border-color:var(--pin)}
.nsl{overflow-y:auto;overflow-x:hidden;padding:6px;display:flex;flex-direction:column;gap:1px}
.nsl button{display:flex;align-items:baseline;gap:9px;border:0;background:none;border-radius:8px;padding:7px 9px;text-align:left;font-weight:600}
.nsl button>span{min-width:0}.nsl button:hover{background:var(--soft)}.nsl button.cur{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--on)}
.nsl button.sub{padding-left:42px;font-weight:500;color:var(--sub)}.nsl button.sub.cur{color:var(--ink)}
.nsl em{font-style:normal;font-size:10.5px;font-weight:700;background:var(--pin);color:#fff;border-radius:10px;padding:1px 7px}
.nlogo{height:28px;width:auto;max-width:140px;object-fit:contain;flex:none}.ntop>div>.mark{width:28px;height:28px;font-size:13px;border-radius:8px;flex:none}
.nflow{display:flex;align-items:center;border:1px solid transparent;background:none;border-radius:8px;padding:5px 8px;max-width:340px;min-width:0;color:var(--ink)}
.nflow b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nflow:hover,.nflow[aria-expanded=true]{background:var(--soft);border-color:var(--line)}
#ntl{flex:1;min-width:0;display:flex;align-items:center;gap:10px}.ndiv{width:1px;height:22px;background:var(--line);flex:none}
.ntop [hidden]{display:none!important}#head{display:none}
.ntb.ic{display:flex;align-items:center;gap:6px;padding:6px 9px;color:var(--ink)}.ntb.ic span{font-size:12.5px;font-variant-numeric:tabular-nums}
aside.nzp{width:auto;height:auto;padding:6px}.nzp .bar{display:flex}
.nmh{display:flex;gap:8px;align-items:center;padding:10px 10px 4px}.nmh input{flex:1;min-width:0;margin:0}
.nmh .pv{margin:0}.nth.nalltile{display:flex;align-items:center;justify-content:center;color:var(--sub)}.nth.nalltile svg{width:28px;height:28px}
.nsl.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(var(--min,150px),100%),1fr));gap:8px;align-content:start}
.nic svg{width:15px;height:15px;vertical-align:-3px;display:block}
.nlab{display:flex;gap:7px;align-items:baseline;flex:1;min-width:0}.nlab .num{flex:none;white-space:nowrap}
.nlw{flex:1;min-width:0;display:flex;flex-direction:column}.nlt{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nlw small{color:var(--sub);font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nsl.g button{flex-direction:column;align-items:stretch;gap:5px;padding:6px;font-size:12px}
.nth{display:block;width:100%;border-radius:6px;background:var(--soft);object-fit:cover;object-position:top;border:1px solid var(--line)}
.nth.nwait{background:linear-gradient(100deg,#e9e7ee 35%,#f6f5f8 50%,#e9e7ee 65%) 0 0/300% 100% #e9e7ee;animation:nshim 1.6s linear infinite}
.nsl.g button{min-width:0;position:relative}.nsl.g .nlab{flex:none;gap:5px;line-height:1.25}.nsl.g em{position:absolute;top:10px;right:10px}
.nfl button{display:flex;align-items:center;gap:9px;border:0;background:none;border-radius:8px;padding:8px 10px;text-align:left;font-weight:600}
.nfl button:hover{background:var(--soft)}.nfl button.cur{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--on)}.nfl button span{flex:1;min-width:0}.nfl small{color:var(--sub);font-weight:500;font-size:12px}
.ntop .head .hb svg{width:16px;height:16px}
.ntop .head{padding:0;border:0;flex:1;min-width:0;gap:10px}.ntop .head .mark{width:30px;height:30px;font-size:14px}.ntop .head .hb{width:30px;height:30px}
.ntop .head .ht{flex:none;max-width:420px}.ntop .head small{display:none}.ntop .head select{margin:0}
.ntb{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:7px 12px;font-weight:700;font-size:13px;white-space:nowrap}
.ntb:hover,.ntb[aria-expanded=true]{background:var(--soft)}.ntb{position:relative}
.ntb.due::after{content:"";position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:var(--pin);border:2px solid var(--panel)}
aside{position:fixed;z-index:29;top:60px;height:auto;max-height:calc(100vh - 72px);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.16);display:none}
aside.open{display:flex}aside:has(.picker.on){height:min(680px,calc(100vh - 72px))}.nlist{min-height:0}aside .foot,aside .grow{display:none}
aside.nside{width:380px}
.nfoot{padding:12px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px}.nfoot .nsend{width:100%}.nfoot small{color:var(--sub);font-size:11.5px;text-align:center}
.nzp .bar{position:static;transform:none;box-shadow:none;border:1px solid var(--line);border-radius:9px;padding:2px 4px;background:var(--panel);width:auto}
.ntoast{position:fixed;z-index:40;top:64px;left:50%;transform:translateX(-50%);background:var(--on);color:var(--onInk);border-radius:10px;padding:12px 20px;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .25s;pointer-events:none}.ntoast.on{opacity:1}
.nsend{border:0;background:var(--pin);color:#fff;border-radius:9px;padding:9px 14px;font-weight:700;white-space:nowrap}.nsend:disabled{background:var(--soft);color:var(--sub);cursor:default}
.ntools{padding:8px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--sub)}
.ntools label{display:flex;gap:6px;align-items:center}.ntools span.err{color:#d33}
.nlist{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
.nempty{color:var(--sub);padding:24px 12px;text-align:center;line-height:1.5}
.nlist{gap:2px;padding:6px}
.nrow{width:100%;border:0;background:transparent;border-radius:10px;padding:9px 10px;display:flex;gap:10px;align-items:flex-start;text-align:left}
.nrow:hover{background:var(--soft)}.nrow.sel{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--pin)}.nrow.done{opacity:.6}
.nrow .nwhere span{display:block;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;font-weight:500}
.nmeta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11px;color:var(--sub);white-space:nowrap}
.nunread{width:8px;height:8px;border-radius:50%;background:var(--claude);display:inline-block;margin-right:4px}
.nwhere{flex:1;min-width:0}.nwhere b{display:block;font-size:13px}.nwhere small{display:block;color:var(--sub);font-size:11px}
/* a note's thread: by its pin, over the canvas */
.nthread{position:fixed;z-index:45;width:330px;max-height:min(560px,calc(100vh - 80px));background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.2);display:flex;flex-direction:column}
.nthread header{display:flex;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)}
.nthread header .nx{border:0;background:none;color:var(--sub);font-size:18px;padding:0 4px}
.nthread header .nhb{border:1px solid var(--line);background:var(--soft);border-radius:7px;padding:3px 8px;font-weight:700;font-size:11.5px}
.nthread .nbody{flex:1;padding:12px;overflow:auto;display:flex;flex-direction:column;gap:3px;min-height:0}
.nthread .nact{padding:10px 12px;border-top:1px solid var(--line);align-items:flex-end}.nthread .nact textarea{resize:none;max-height:120px}
.nthread .nact button{background:var(--pin);border-color:var(--pin);color:#fff}
/* the thread as a chat: the author's messages right, in the accent; Claude's left, neutral; a run from one sender
   grouped under one name */
.nwho{font-size:11px;font-weight:700;color:var(--sub);margin:8px 0 2px;display:flex;align-items:center;gap:6px}.nwho:first-child{margin-top:0}
.nwho.me{align-self:flex-end}.nwho i{width:18px;height:18px;border-radius:50%;background:var(--claude);color:#fff;font-style:normal;font-size:10px;display:flex;align-items:center;justify-content:center}
.nreset{width:100%;border:1px solid var(--line);background:none;border-radius:8px;padding:7px 10px;color:var(--sub);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}.nreset:hover{background:var(--soft);color:var(--ink)}
.nmsg{max-width:82%;padding:7px 11px;border-radius:14px;font-size:13px;line-height:1.4;overflow-wrap:anywhere}
.nmd>*{margin:0}.nmd>*+*{margin-top:7px}.nmd ul,.nmd ol{padding-left:18px}.nmd li+li{margin-top:2px}.nmd code{font:12px ui-monospace,Menlo,monospace;background:color-mix(in srgb,currentColor 12%,transparent);padding:1px 4px;border-radius:4px}.nmd pre{background:color-mix(in srgb,currentColor 10%,transparent);padding:8px 10px;border-radius:8px;overflow:auto}.nmd pre code{background:none;padding:0}.nmd a{color:inherit;text-decoration:underline}
.nmsg.me{align-self:flex-end;background:var(--pin);color:#fff;border-bottom-right-radius:4px}
.nmsg.claude{align-self:flex-start;background:var(--soft);color:var(--ink);border-bottom-left-radius:4px}
.nmsg time{display:block;font-size:10.5px;opacity:.7;margin-top:3px;text-align:right}
.nmsg.unsent{background:color-mix(in srgb,var(--pin) 16%,transparent);color:var(--ink);outline:1px dashed var(--pin)}.nmsg.unsent time{color:var(--pin);opacity:1;font-weight:600}
.nmsg .ncrop{margin-top:6px;width:120px;height:120px;border:0}
.nchip{font-size:10.5px;font-weight:700;border-radius:20px;padding:2px 8px;background:var(--soft);color:var(--sub);white-space:nowrap}.nchip.draft{background:color-mix(in srgb,var(--pin) 14%,transparent);color:var(--pin)}
.ntext{margin:0;white-space:pre-wrap;font-size:13.5px}
.ncrop{display:block;width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.nwait,.nerr{font-size:11.5px;color:var(--sub)}.nerr{color:#d33}
.nreps{display:flex;flex-direction:column;gap:6px}.nreps:empty{display:none}
.nrep{border-left:2px solid var(--line);padding:2px 0 2px 10px;font-size:13px}.nrep.claude{border-color:var(--claude)}
.nrep b{font-size:11.5px}.nrep.claude b{color:var(--claude)}.nrep i{font-style:normal;font-size:10.5px;color:var(--pin);font-weight:700}.nrep p{margin:2px 0 0;white-space:pre-wrap}
.nact{display:flex;gap:6px}.nact textarea,.ncomp textarea{flex:1;resize:vertical;min-height:32px;font:inherit;font-size:13px;color:var(--ink);background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:6px 8px;outline:none}
.nact textarea:focus,.ncomp textarea:focus{border-color:var(--pin)}
.nact button,.nthread footer button,.ncb button{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:5px 10px;font-weight:700;font-size:12px}
.nlay{position:absolute;z-index:20;pointer-events:none}
.shifting .nlay{pointer-events:auto;cursor:crosshair}
.alting .nlay{pointer-events:auto;cursor:default}.alting .nlay.ahov{background:rgba(22,21,26,.5)}
.alting .nlay.ahov::after{content:"Click to copy";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(var(--ik,1));padding-top:44px;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'/><circle cx='12' cy='13' r='3.5'/></svg>") center top/34px 34px no-repeat;color:#fff;font:600 14px/1.2 system-ui,sans-serif;white-space:nowrap;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.3)}
.ntoast.pic{display:flex;align-items:center;gap:14px;padding:10px 20px 10px 12px}.ntoast img{height:44px;width:auto;border-radius:5px;transform:rotate(-5deg);box-shadow:0 2px 6px rgba(0,0,0,.35);border:1.5px solid rgba(255,255,255,.85)}
.npin{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;transform:scale(var(--ik,1));border-radius:50% 50% 50% 4px;border:2px solid #fff;background:var(--pin);color:var(--pinInk);
  font:700 12px/1 -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.npin.draft{background:#fff;color:var(--pin);border-color:var(--pin)}.npin.done{background:#8a8794}.npin.sel{outline:3px solid color-mix(in srgb,var(--pin) 45%,transparent)}
.npin.ghost{opacity:.7}.nrow .npin,.nthread header .npin{position:static;margin:0;transform:none;flex:none;box-shadow:none}
.ncomp{position:fixed;z-index:50;width:300px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:8px}
.nct{font-size:11.5px;color:var(--sub);font-weight:600}.ncb{display:flex;gap:6px;align-items:center}.ncb span{flex:1;font-size:11px;color:var(--sub)}
.ncb .nc1{background:var(--pin);border-color:var(--pin);color:#fff}`;
/** the top bar and the notes' index; at the left, the product's logo (the flow's "logo", as a data URI) or Flex's mark */
const notesHtml = (logo?: string | null, name?: string) => `<div class="ntop" id="ntop"><div id="ntl">${logo ? `<img class="nlogo" src="${logo}" alt="${(name ?? "").replace(/"/g, "&quot;")}" title="${(name ?? "").replace(/"/g, "&quot;")}">` : `<div class="mark" title="${(name ?? "").replace(/"/g, "&quot;")}">F</div>`}
  <span class="ndiv"></span><button class="nscr" id="nflowb" aria-expanded="false" title="Choose a flow"><span class="pic" id="nflowic"></span><b id="nflowt"></b><svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
  <span class="ndiv" id="nscrdiv"></span><button class="nscr" id="nscr" aria-expanded="false" title="Choose a screen"></button>
  <span class="ndiv" id="nstdiv" hidden></span><button class="nscr" id="nst" aria-expanded="false" title="Choose a state" hidden></button></div>
  <button class="ntb nperson" id="nperson" aria-expanded="false" title="Signed in as" aria-label="Signed in as" hidden></button>
  <span class="nstgtag" id="nstg" title="Frames show this environment's build, signed in to its gateway" hidden></span>
  <button class="ntb ic" id="nview" aria-expanded="false" title="View: devices, theme, language, data" aria-label="View"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg></button>
  <button class="ntb ic" id="nnotes" aria-expanded="false" title="Notes" aria-label="Notes"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg><span id="nncount">0</span></button>
  <button class="ntb ic" id="nzoom" aria-expanded="false" title="Zoom" aria-label="Zoom"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg><span id="nzv">100%</span></button></div>
<aside class="nzp" id="nzoomp"></aside>
<div class="ntoast" id="ntoast">Frames updated</div><div class="ntoast" id="nrec">Reconnecting…</div>
<aside class="nside" id="nside">
  <div class="ntools"><label><input type="checkbox" id="nhide"> Hide resolved</label><span id="nsync"></span></div>
  <div class="nlist" id="nlist"></div>
  <div class="nfoot"><button class="nsend" id="nsend" disabled>Send</button><small id="nsub"></small></div>
</aside>`;
/** the notes' script, after the page's own (it uses ROWS, S, go, lbl, entry, kind, CATS, THEMES); no backticks or
 *  template holes in it */
function notesScript(flow: string): string {
  return `const NFLOW=${JSON.stringify(flow).replace(/</g, "\\u003c")};
let NOTES={notes:[],rounds:[]},NSTR="",NSEL=null,HIDE=false,BUILD,LANG="en",SHIFT=false;
const LANGS=[["en","English"],["sw","Kiswahili"]];
// what each picker picks: a flow, a screen, a state (on its trigger, and on each row of its list)
const PIC={flow:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/></svg>',screen:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',state:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></svg>'};
const CHEV='<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
/* the view controls (devices, theme, language) remembered per project; the address (?devices=…&theme=…, which an
   automatic reload keeps) goes first */
const PKEY="flex-review:"+location.pathname.slice(0,location.pathname.indexOf("/f/"))+":";
const mem=(k,v)=>{try{if(v===undefined)return localStorage.getItem(PKEY+k);localStorage.setItem(PKEY+k,v)}catch{return null}};
try{HIDE=localStorage.getItem("flex-review-hide")==="1";const l=mem("lang")||localStorage.getItem("flex-review-lang");if(LANGS.some(x=>x[0]===l))LANG=l}catch{}
if(!Q.has("devices")){const d=mem("devices");if(d!==null){const set=d.split(",").filter(c=>CATS.some(x=>x.c===c));S.devs=new Set(set.length||!d?set:[CATS[0].c])}}
if(!Q.has("theme")){const t=mem("theme");if(THEMES.includes(t))S.theme=t}
function remember(){mem("devices",[...S.devs].join(","));mem("theme",S.theme);mem("lang",LANG)}
/* the language every frame shows, as the theme is: each link's lang= set to it (added where a link has none); the
   flow's own links stay as they are */
const withLang=(u,l)=>/[?&]lang=[^&]*/.test(u)?u.replace(/([?&])lang=[^&]*/,"$1lang="+l):u+(u.includes("?")?"&":"?")+"lang="+l;
/* the data the frames show: the app's demo, or (the project's "staging") its staging build signed in to the real
   gateway. One mode for the whole page: a cookie tells flex review's proxy, and a staging frame starts at its sign-in
   (api/stage), which redirects to its seed link with the persona's token */
const ENVS=typeof FLEXENVS!=="undefined"?FLEXENVS:[];
let MODE=ENVS.some(e=>e.key===mem("mode"))?mem("mode"):"static",TESTER=mem("tester")==="1"?1:0,SIGNAL=mem("signal")==="0"?0:1;
/* signal: on (offline=0) or off (offline=1) on every frame; the flow's "signal": false screens and states always off */
const SIGOFF=new Set(typeof FLEXSIGOFF!=="undefined"?FLEXSIGOFF:[]);
const offOf=(name)=>SIGOFF.has(name)||!SIGNAL?1:0;
/* signed in as: each frame's person, from the flow (FLEXPEOPLE: its default, who it offers, whether its link signs in
   itself). The person picked (remembered per project and flow) applies where a frame offers them; elsewhere the
   frame's default. null: signed out (signout=1) */
const PEOPLE=typeof FLEXPEOPLE!=="undefined"?FLEXPEOPLE:{all:{},frames:{},flow:{person:null,people:[]}};
let PERSON=mem("person:"+NFLOW)||"";
const pinfo=(name)=>PEOPLE.frames[name];
// a published copy's grids have pictures of each screen's default person only (the views rule below): there a pick
// made in Single (the live app) doesn't apply, and the menu offers only those defaults
const picked=()=>{if(typeof FLEXSTATIC==="undefined"||!FLEXSTATIC||!FLEXSTATIC.views)return PERSON;try{return oneView()?PERSON:""}catch{return PERSON}};
const personOf=(name)=>{const i=pinfo(name);if(!i||i.fixed)return null;const P=picked();return P&&i.people.includes(P)?P:i.person};
const pkey=(name)=>{const i=pinfo(name);return !i||i.fixed?"link":personOf(name)||"none"};
/* the link parameters (the project's signinParam, signoutParam; null: none added) */
const PARAMS=typeof FLEXPARAMS!=="undefined"?FLEXPARAMS:{signin:"signin",signout:"signout"};
function withPerson(u,name){const i=pinfo(name);if(!i||i.fixed||new RegExp("[?&]"+PARAMS.signin+"=").test(u))return u;const p=personOf(name);if(!p&&!PARAMS.signout)return u;const add=p?PARAMS.signin+"="+encodeURIComponent(p):PARAMS.signout+"=1";
  return /[?&]to=/.test(u)?u.replace(/([?&])to=/,"$1"+add+"&to="):u+(u.includes("?")?"&":"?")+add}
/* a published copy (flex review export): no server behind the page, its snapshots in FLEXSTATIC; no notes, no
   Shift+Click, no Data switch, no polling */
const STATIC=typeof FLEXSTATIC!=="undefined"?FLEXSTATIC:null;
if(STATIC)document.body.classList.add("nstatic");
const cookie=()=>{if(!STATIC)document.cookie="flex_mode="+MODE+"; path=/; SameSite=Lax"};cookie();
const NRS=location.pathname.slice(0,location.pathname.indexOf("/f/"));
/** the variant's query (data mode and tester tools), for the server's snapshots and covers */
const VQ=()=>"&mode="+MODE+"&tester="+TESTER+"&signal="+SIGNAL+"&person="+encodeURIComponent(PERSON);
const withParam=(u,k,v)=>new RegExp("[?&]"+k+"=[^&]*").test(u)?u.replace(new RegExp("([?&])"+k+"=[^&]*"),"$1"+k+"="+v):u+(u.includes("?")?"&":"?")+k+"="+v;
const withTester=(u)=>/[?&]tester=[^&]*/.test(u)?u.replace(/([?&])tester=[^&]*/,"$1tester="+TESTER):u+(u.includes("?")?"&":"?")+"tester="+TESTER;
/* the frames with a setup (the project's "setup" command, or declared "storage"): each starts at flex review's
   api/setup-frame, which runs it and opens the frame's link (or the setup's url). A published copy has no server to run
   them: there those frames are their snapshots only */
const SETUPN=new Set(typeof FLEXSETUP!=="undefined"?FLEXSETUP:[]);
/* the page on a *.localhost name (flex review prints one when a flow has a setup): each setup frame on a host of its own
   under it (f<key>.<the page's host>, one per flow, screen, person, language and data mode), so frames for different
   people keep their own cookies and storage. Elsewhere (localhost, 127.0.0.1) they share the page's origin */
const ISO=/\.localhost$/.test(location.hostname);
const fhash=(s)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};
const frameOrigin=(r)=>ISO?location.protocol+"//f"+fhash([NFLOW,r.screen,personOf(r.screen)||"",LANG,MODE].join("|"))+"."+location.host:"";
function relink(){ROWS.forEach(r=>{if(!r.href)return;if(r.href0===undefined)r.href0=r.href;const u=withParam(withTester(withLang(r.href0,LANG)),"offline",offOf(r.screen));
  const w=withPerson(u,r.screen);
  r.href=SETUPN.has(r.screen)&&!STATIC?frameOrigin(r)+NRS+"/api/setup-frame?flow="+encodeURIComponent(NFLOW)+"&name="+encodeURIComponent(r.screen)+"&device="+encodeURIComponent(r.key)+"&env="+(MODE!=="static"?encodeURIComponent(MODE):"")+"&link="+encodeURIComponent(w)
    :MODE!=="static"?NRS+"/api/stage?env="+encodeURIComponent(MODE)+"&link="+encodeURIComponent(w):w})}
/* tester tools off: the flow's "tester": true screens and states are left out (FLEXTESTER, their names) */
const TNAMES=new Set(typeof FLEXTESTER!=="undefined"?FLEXTESTER:[]),ALLSCREENS=[...SCREENS];
(INDEX?INDEX.screens:[]).forEach(e=>{e.states0=e.states});
function testerFilter(){SCREENS.length=0;SCREENS.push(...ALLSCREENS.filter(s=>TESTER||!TNAMES.has(s)));
  (INDEX?INDEX.screens:[]).forEach(e=>{e.states=TESTER?e.states0:e.states0.filter(st=>!TNAMES.has(e.name+"@"+st.name))});
  if(SCREENS.length&&!SCREENS.includes(S.screen)){S.screen=SCREENS[0];S.state=""}}
testerFilter();relink();
function setLang(l,quiet){LANG=l;mem("lang",l);relink();langSeg();if(!quiet)go()}
function setMode(m){MODE=m;mem("mode",m);cookie();relink();modeSeg();go()}
function setTester(t){TESTER=t;mem("tester",String(t));testerFilter();relink();modeSeg();go()}
function setSignal(v){SIGNAL=v;mem("signal",String(v));relink();sigSeg();go()}
function sigSeg(){seg(document.getElementById("nsignal"),[[1,"On"],[0,"Off"]],(x)=>x[0]===SIGNAL,(x)=>setSignal(x[0]),(x)=>'<span class="ic">'+x[1]+"</span>")}
const envLabel=(k)=>k==="static"||k==="demo"||!k?"Static":(ENVS.find(e=>e.key===k)||{label:k}).label;
function modeSeg(){seg(document.getElementById("nmodes"),[["static","Static"],...ENVS.map(e=>[e.key,e.label])],(x)=>x[0]===MODE,(x)=>setMode(x[0]),(x)=>'<span class="ic">'+String(x[1]).replace(/</g,"&lt;")+"</span>");
  if(!ENVS.length)document.querySelectorAll("#nmodes button").forEach(b=>{b.disabled=true;b.title="No environments in .flex/project.json"});
  seg(document.getElementById("ntester"),[[0,"Off"],[1,"On"]],(x)=>x[0]===TESTER,(x)=>setTester(x[0]),(x)=>'<span class="ic">'+x[1]+"</span>");
  const t=document.getElementById("nstg");if(t){t.hidden=MODE==="static";t.textContent=envLabel(MODE);t.dataset.env=MODE}}
function langSeg(){seg(document.getElementById("nlangs"),LANGS,(x)=>x[0]===LANG,(x)=>setLang(x[0]),(x)=>'<span class="ic">'+x[1]+"</span>")}
document.getElementById("themes").closest(".sec").insertAdjacentHTML("afterend",'<div class="sec"><div class="lab">Signal</div><div class="seg" id="nsignal"></div></div><div class="sec"><div class="lab">Language</div><div class="seg" id="nlangs"></div></div>');
sigSeg();
langSeg();
document.getElementById("nlangs").closest(".sec").insertAdjacentHTML("afterend",'<div class="sec"><div class="lab">Data</div><div class="seg" id="nmodes"></div></div><div class="sec"><div class="lab">Tester tools</div><div class="seg" id="ntester"></div></div>');
modeSeg();
if(STATIC)document.getElementById("nmodes").closest(".sec").style.display="none";
/* Setup (a flow with setup frames, live only): the project's setup command may write data, so it runs only when allowed,
   for this server's session (flex review --allow-setup, or this switch); off, those frames say so */
let SETUPON=false;
function setupSeg(){const el=document.getElementById("nsetup");if(!el)return;seg(el,[[false,"Off"],[true,"On"]],(x)=>x[0]===SETUPON,async(x)=>{
  try{const r=await fetch(NRS+"/api/setup-allow",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({on:x[0]})});SETUPON=!!(await r.json()).on}catch{}
  setupSeg();document.querySelectorAll("#stage iframe").forEach(f=>{if(f.src.includes("/api/setup-frame")){f.dataset.hyd="";f.src=f.src}});hydrateAll();snaps(true)},(x)=>'<span class="ic">'+x[1]+"</span>")}
if(SETUPN.size&&!STATIC){document.getElementById("nmodes").closest(".sec").insertAdjacentHTML("afterend",'<div class="sec"><div class="lab">Setup</div><div class="seg" id="nsetup" title="Runs the project’s setup command for frames with a setup (it may write data)"></div></div>');
  setupSeg();fetch(NRS+"/api/setup-allow",{cache:"no-store"}).then(r=>r.json()).then(j=>{SETUPON=!!j.on;setupSeg()}).catch(()=>{})}
// back to the project's defaults: what this page remembers (devices, theme, language, signal, tester tools, data, the
// pickers' display) is forgotten and the page loads again without its address's view settings
document.getElementById("ntester").closest(".sec").insertAdjacentHTML("afterend",'<div class="sec"><button class="nreset" id="nreset" title="Devices, theme, language, signal, tester tools and data back to the project’s defaults">Reset to defaults</button></div>');
document.getElementById("nreset").onclick=async()=>{
  // the setups run again when next wanted
  if(!STATIC)await fetch(NR+"/api/setup-reset",{method:"POST"}).catch(()=>{});
  try{Object.keys(localStorage).filter(k=>k.startsWith(PKEY)||k==="flex-review-lang"||k==="flex-review-picker").forEach(k=>localStorage.removeItem(k));sessionStorage.clear()}catch{}
  document.cookie="flex_mode=static;path=/;max-age=31536000";location.href=location.pathname};
const esc=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
// where the review's own paths start (/ncaa, /_flex…): everything before /f/<flow>/ in this page's address
const NR=location.pathname.slice(0,location.pathname.indexOf("/f/"));
// a note or reply as Markdown (escaped first, so only these few forms become markup): paragraphs, line breaks, **bold**,
// *italic*, inline code, fenced code blocks, - / 1. lists and [links](https://…)
const md=(s)=>{const blocks=[];let t=esc(s).replace(/>/g,"&gt;").replace(/\\x60\\x60\\x60\\w*\\n?([\\s\\S]*?)\\x60\\x60\\x60/g,(_,c)=>{blocks.push("<pre><code>"+c+"</code></pre>");return "\\u0000"+(blocks.length-1)+"\\u0000"});
  const inl=(x)=>x.replace(/\\x60([^\\x60]+)\\x60/g,"<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>").replace(/(^|[^*\\w])\\*([^*\\n]+)\\*(?!\\w)/g,"$1<i>$2</i>").replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s"]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t.trim().split(/\\n{2,}/).map((p)=>{const q=p.trim();if(/^\\u0000\\d+\\u0000$/.test(q))return blocks[+q.slice(1,-1)];
    const L=q.split("\\n");
    if(L.every((l)=>/^\\s*[-*] /.test(l)))return "<ul>"+L.map((l)=>"<li>"+inl(l.replace(/^\\s*[-*] /,""))+"</li>").join("")+"</ul>";
    if(L.every((l)=>/^\\s*\\d+[.)] /.test(l)))return "<ol>"+L.map((l)=>"<li>"+inl(l.replace(/^\\s*\\d+[.)] /,""))+"</li>").join("")+"</ol>";
    return "<p>"+inl(L.join("<br>"))+"</p>"}).join("").replace(/\\u0000(\\d+)\\u0000/g,(_,i)=>blocks[+i])};
// a frame's note fields from its row: screen@state apart, the device's key, the theme
const nid=(r)=>{const i=r.screen.indexOf("@");return{screen:i<0?r.screen:r.screen.slice(0,i),state:i<0?null:r.screen.slice(i+1),device:r.key,theme:r.theme,lang:LANG,mode:MODE,tester:TESTER,offline:offOf(r.screen),person:personOf(r.screen)}};
// a pin shows on its own frame: screen, state, device, theme and language (a note from before languages, in any)
const onFrame=(n,f)=>n.screen===f.screen&&(n.state||null)===f.state&&n.device===f.device&&n.theme===f.theme&&(!n.lang||n.lang===f.lang)&&(!n.mode||n.mode==="demo"?"static":n.mode)===f.mode&&(n.tester==null||n.tester===f.tester)&&(n.offline==null||n.offline===f.offline)&&(n.person===undefined||(n.person||null)===f.person);
const langName=(l)=>(LANGS.find(x=>x[0]===l)||[l,l])[1];
const stLabel=(s,st)=>((entry(s).states||[]).find(x=>x.name===st)||{label:st}).label;
const devLabel=(k)=>(ROWS.find(r=>r.key===k)||{}).device||k;
const where=(n)=>(n.state?stLabel(n.screen,n.state)+" · ":"")+devLabel(n.device)+" · "+n.theme+(n.lang?" · "+langName(n.lang):"")+(n.mode&&n.mode!=="static"&&n.mode!=="demo"?" · "+envLabel(n.mode):"")+(n.tester?" · Tester":"")+(n.offline?" · No signal":"")+(n.person?" · "+((PEOPLE.all[n.person]||{}).name||n.person):"");
async function api(b){
  const r=await fetch(NR+"/api/notes?flow="+encodeURIComponent(NFLOW),b?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}:{cache:"no-store"});
  const j=await r.json();if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j}
function sync(err){const s=document.getElementById("nsync");s.className=err?"err":"";s.textContent=err||"Updated "+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function take(doc){const s=JSON.stringify(doc);if(s===NSTR)return;NSTR=s;NOTES=doc;rebuilt(doc.build);list();pins();fillThread();if(MENUREF)MENUREF()}
/* the app rebuilt: the agent sets the notes file's "build" (a timestamp) after a round's changes, and every frame
   loads its link again (an open note box and typed replies stay as they are) */
let TOAST=0;
/* a short word at the top centre: "Frames updated", "Copied to clipboard" */
function flash(text,pic){const t=document.getElementById("ntoast");
  t.innerHTML=(pic?'<img src="'+pic+'" alt="">':"")+"<span></span>";t.lastChild.textContent=text;t.classList.toggle("pic",!!pic);t.classList.add("on");clearTimeout(TOAST);TOAST=setTimeout(()=>t.classList.remove("on"),2200)}
function rebuilt(b){const was=BUILD;BUILD=b||null;if(was===undefined||was===BUILD)return;
  document.querySelectorAll("iframe").forEach(f=>{f.src=f.src});snaps();flash("Frames updated")}
/* ⌥-click a screen: its picture (the frame's snapshot) onto the clipboard. The blob is handed over as a promise so the
   write happens inside the click, which Safari requires */
/* "Confirm it's you · Round 2": a frame's screen and, when it shows one, its state, as the pickers name them */
function shotName(r){const i=r.screen.indexOf("@"),sc=i<0?r.screen:r.screen.slice(0,i),st=i<0?"":r.screen.slice(i+1);
  const name=lbl(sc).replace(/&lt;/g,"<").replace(/&amp;/g,"&"),z=st&&states(sc).find(x=>x.name===st);return z?name+" · "+z.label:name}
function copyShot(r){const s=r&&SNAPS[snapKey(r)];if(!s||!s.url){flash("No picture of this screen yet");return}
  const png=fetch(s.url).then(x=>x.blob()).then(b=>b.type==="image/png"?b:new Blob([b],{type:"image/png"}));
  navigator.clipboard.write([new ClipboardItem({"image/png":png})]).then(()=>flash("Copied "+shotName(r),s.url),(e)=>flash("Couldn't copy: "+e.message))}
// ⌥-click on a screen outside its frame (a snapshot, the frame's edge): the same copy
addEventListener("click",(e)=>{if(!e.altKey||STATIC)return;const l=e.target.closest&&e.target.closest(".live[data-r]");if(!l)return;
  e.preventDefault();e.stopPropagation();copyShot(ROWS[+l.dataset.r])},true);
async function poll(){if(STATIC){if(PLACE0)restorePlace();return}try{take(await api());sync("");if(PLACE0)restorePlace();if(NOTE0){const id=NOTE0;NOTE0=null;select(id)}}catch(e){sync("Can't read the notes: "+e.message)}snaps();checkVersion()}
/* the page reloads itself when the server has a new one (a new Flex, the flow or project edited, the server restarted),
   and comes back where the author was: the view (in the address), zoom and scroll, the open thread, what was being
   typed in it or in a new note (sessionStorage, used once) */
const PLACE="flex-review-place:"+location.pathname;
let PLACE0=null,COMP=null,VFAIL=0;
// a note asked for in the address (#note=<id>, from the home's notes), opened once the notes are in
let NOTE0=(location.hash.match(/^#note=(.+)$/)||[])[1];NOTE0=NOTE0?decodeURIComponent(NOTE0):null;try{PLACE0=JSON.parse(sessionStorage.getItem(PLACE)||"null");sessionStorage.removeItem(PLACE)}catch{}
function savePlace(){const m=document.getElementById("main"),c=document.getElementById("ncomp"),t=document.getElementById("nthread");
  const p={Z,sx:m.scrollLeft,sy:m.scrollTop,thread:THREAD,reply:t?t.querySelector("textarea").value:"",comp:c&&COMP?Object.assign({},COMP,{text:c.querySelector("textarea").value}):null};
  try{sessionStorage.setItem(PLACE,JSON.stringify(p))}catch{}}
addEventListener("pagehide",savePlace);
function restorePlace(){const p=PLACE0;PLACE0=null;if(!p)return;
  if(p.Z&&p.Z!==1)zoom(p.Z);const m=document.getElementById("main");m.scrollLeft=p.sx||0;m.scrollTop=p.sy||0;
  if(p.thread&&NOTES.notes.some(n=>n.id===p.thread)){openThread(p.thread);const t=document.querySelector("#nthread textarea");if(t&&p.reply)t.value=p.reply}
  if(p.comp){const l=document.querySelector('#stage .live[data-r="'+p.comp.ri+'"]'),o=l&&l.querySelector(".nlay");
    if(o&&o.offsetParent){const b=o.getBoundingClientRect();compose(ROWS[p.comp.ri],o,p.comp.x,p.comp.y,b.left+p.comp.x*b.width,b.top+p.comp.y*b.height,p.comp.at);document.querySelector("#ncomp textarea").value=p.comp.text||""}}}
async function checkVersion(){if(STATIC)return;
  let j;try{const r=await fetch(NR+"/api/version?flow="+encodeURIComponent(NFLOW),{cache:"no-store"});j=await r.json()}
  catch{if(++VFAIL>=2)document.getElementById("nrec").classList.add("on");return}
  VFAIL=0;document.getElementById("nrec").classList.remove("on");
  if(j&&j.v&&typeof FLEXV!=="undefined"&&j.v!==FLEXV){savePlace();location.reload()}}
/* the grid's pictures: snapshots the server takes of each screen (per device, theme and language), not live frames;
   one not taken yet is a placeholder, swapped for its picture when it comes (the poll asks again) */
let SNAPS={};
const snapKey=(r)=>r.screen+"."+r.key+"."+r.theme+"."+LANG+"."+MODE+".t"+TESTER+".s"+(offOf(r.screen)?0:1)+".p-"+pkey(r.screen);
// (a published copy has no picture of some views: the live app shows when the screen is opened)
// a snapshot whose frame's "expect" wasn't on the page: kept, flagged (the app's shared data may have moved on)
const movedB=(s)=>s&&s.moved?'<b class="nmoved" title="'+esc(s.moved).replace(/"/g,"&quot;")+'">data moved?</b>':"";
const snapIn=(k,none)=>SNAPS[k]&&SNAPS[k].url?'<img src="'+SNAPS[k].url+'" alt="">'+movedB(SNAPS[k]):'<span class="nshim">'+(none||(STATIC?"Open for the live app":"Capturing…"))+"</span>";
THUMB=(r)=>{const k=snapKey(r);return FRAMES[r.frame].replace(/<iframe src="__SRC__" title="" loading="lazy" style="([^"]*)"><\\/iframe>/,(m,st)=>
  '<div class="nsnapw'+(SNAPS[k]&&SNAPS[k].url?"":" nwait")+(r.theme==="dark"?" dk":"")+'" data-snap="'+esc(k)+'" style="'+(st.includes("position:absolute")?"":"position:relative;")+st.replace(/background:#fff;?/,"")+'">'+snapIn(k,STATIC&&SETUPN.has(r.screen)?"No snapshot of this view":"")+"</div>")};
// a published copy: a frame with a setup can't run it (no server), so on its own it is its snapshot
if(STATIC){Object.assign(SNAPS,Object.fromEntries(Object.entries(STATIC.snaps).map(([k,u])=>[k,{url:u,fresh:true}])));const L0=LIVE1;LIVE1=(r)=>SETUPN.has(r.screen)?THUMB(r):L0(r)}
async function snaps(force){
  if(oneView()&&!force)return;const devs=shown().map(x=>x.k);if(!devs.length)return;
  let j;if(STATIC)j=Object.fromEntries(Object.entries(STATIC.snaps).map(([k,u])=>[k,{url:u,fresh:true}]));else try{const r=await fetch(NR+"/api/snaps?flow="+encodeURIComponent(NFLOW)+"&devices="+devs.join(",")+"&theme="+S.theme+"&lang="+LANG+VQ()+"&show="+encodeURIComponent([...new Set([...document.querySelectorAll("[data-snap]")].map(w=>w.dataset.snap.split(".")[0]))].join(",")),{cache:"no-store"});if(!r.ok)return;j=await r.json()}catch{return}
  Object.assign(SNAPS,j);
  document.querySelectorAll("[data-snap]").forEach(w=>{const s=SNAPS[w.dataset.snap],i=w.querySelector("img");if(!s||!s.url)return;
    const mb=()=>{const o=w.querySelector(".nmoved");if(o)o.remove();if(s.moved)w.insertAdjacentHTML("beforeend",movedB(s))};
    if(i&&i.getAttribute("src")===s.url){if(!!w.querySelector(".nmoved")!==!!s.moved)mb();return}
    const img=new Image();img.alt="";img.onload=()=>{w.replaceChildren(img);mb();w.classList.remove("nwait")};img.src=s.url})}
/* the views the stage keeps: the grid, and the last few live screens (hidden, not destroyed), so going back to one
   is instant and nothing reloads a live frame but a change of its screen, state, devices, theme or language */
const KEEP=4;let LASTSETUP=null;
const oneView=()=>S.screens==="one"&&!(S.stmode==="all"&&states(S.screen).length);
HOST=(st0)=>{
  [...st0.children].forEach(c=>{if(!c.classList.contains("nhost"))c.remove()});
  const one=oneView(),sig=one?JSON.stringify([cur1(),shown().map(x=>x.k),S.theme,LANG,MODE,TESTER,SIGNAL,PERSON]):"grid";
  let h=[...st0.children].find(e=>e.dataset.sig===sig);
  [...st0.children].forEach(e=>{e.hidden=e!==h});
  if(h)h.dataset.used=Date.now();
  // (sharing the page's origin) a setup's cookies are the origin's: a kept view with a setup shown again after another's runs its own again (its
  // frames reload through api/setup-frame), so the frame in view has its own session
  if(one&&SETUPN.has(cur1())&&!ISO){if(h&&LASTSETUP!==sig)h.querySelectorAll("iframe").forEach(f=>{f.dataset.hyd="";f.src=f.src});LASTSETUP=sig}
  if(h&&one){refitOne(h);return null}
  if(!h){h=document.createElement("div");h.className="nhost";h.dataset.sig=sig;h.dataset.used=Date.now();st0.appendChild(h)}
  [...st0.children].filter(e=>e.dataset.sig!=="grid"&&e!==h).sort((a,b)=>b.dataset.used-a.dataset.used).slice(KEEP-1).forEach(e=>e.remove());
  return h};
CUR=()=>{const h=[...document.getElementById("stage").children].find(e=>!e.hidden);return h&&h.firstElementChild};
/* a kept live view shown again: back to zoom 1, scaled to fit the stage as it is now */
function refitOne(h){const c=h.firstElementChild,ls=[...h.querySelectorAll(".lz")];if(!c||!ls.length)return;
  Object.assign(c.style,{transform:"",marginRight:"0px",marginBottom:"0px"});
  const pts=ls.map(z=>({w:z.firstElementChild.offsetWidth,h:z.firstElementChild.offsetHeight})),st0=document.getElementById("stage");
  const W=st0.clientWidth-80-36*(ls.length-1),H=innerHeight-200,k=Math.min(1,W/pts.reduce((a,p)=>a+p.w,0),H/Math.max(...pts.map(p=>p.h)));
  ls.forEach((z,i)=>{z.style.transform="scale("+k+")";z.parentElement.style.width=pts[i].w*k+"px";z.parentElement.style.height=pts[i].h*k+"px"})}
async function act(b){try{take(await api(b));sync("")}catch(e){sync(e.message)}}
/* the pins: an overlay over each live frame's screen (its iframe's box), the pins counter-scaled to stay readable */
function pins(){
  document.querySelectorAll("#stage .live[data-r]").forEach(l=>{
    const f=l.querySelector("iframe,.nsnapw"),r=ROWS[+l.dataset.r];if(!f||!r||!f.offsetParent)return;
    const z=l.querySelector(".lz"),m=/scale\\(([^)]+)\\)/.exec((z&&z.style.transform)||""),k=m?+m[1]:1;
    l.style.setProperty("--ik",String(1/(k||1)));
    let o=l.querySelector(".nlay");
    if(!o){o=document.createElement("div");o.className="nlay";f.offsetParent.appendChild(o);
      // Shift held: the overlay takes the click (also a frame that isn't on this origin)
      o.addEventListener("click",(e)=>{e.stopPropagation();if(e.altKey&&!e.shiftKey){copyShot(r);return}if(!e.shiftKey||e.target!==o)return;const b=o.getBoundingClientRect();compose(r,o,(e.clientX-b.left)/b.width,(e.clientY-b.top)/b.height,e.clientX,e.clientY,(f.dataset.hyd==="wait"?null:frameAt(f))||liveSrc(r))})}
    if(f.tagName==="IFRAME")hookFrame(f,r,o);
    o.style.cssText="left:"+f.offsetLeft+"px;top:"+f.offsetTop+"px;width:"+f.offsetWidth+"px;height:"+f.offsetHeight+"px";
    const id=nid(r);
    o.innerHTML=NOTES.notes.filter(n=>onFrame(n,id)&&!(HIDE&&n.resolved&&n.id!==THREAD)).map(n=>'<button class="npin'+(n.resolved?" done":n.round==null?" draft":"")+(n.id===NSEL?" sel":"")+'" data-id="'+n.id+'" title="'+esc(n.text).replace(/"/g,"&quot;")+'" style="left:'+n.x*100+"%;top:"+n.y*100+'%">'+n.n+"</button>").join("");
    // a pin opens its thread (again: closes it)
    o.querySelectorAll(".npin").forEach(b=>b.onclick=(e)=>{e.stopPropagation();THREAD===b.dataset.id?closeThread():openThread(b.dataset.id)});
  });
}
/* a new note: a box by the click, a ghost pin at the point; once added, it becomes the note's thread */
function closeComp(){COMP=null;const c=document.getElementById("ncomp");if(c)c.remove();document.querySelectorAll(".npin.ghost").forEach(g=>g.remove())}
function compose(r,o,x,y,cx,cy,at){
  closeComp();closeThread();COMP={ri:ROWS.indexOf(r),x,y,at};
  const id=nid(r),c=document.createElement("div");c.className="ncomp";c.id="ncomp";
  o.insertAdjacentHTML("beforeend",'<span class="npin ghost" style="left:'+x*100+"%;top:"+y*100+'%">+</span>');
  c.innerHTML='<div class="nct">'+esc(lbl(id.screen))+" · "+esc(where(id))+'</div><textarea rows="3" placeholder="What should change here?"></textarea><div class="ncb"><span>Return adds · Esc cancels</span><button class="nc0">Cancel</button><button class="nc1">Add note</button></div>';
  document.body.appendChild(c);
  c.style.left=Math.max(12,Math.min(cx+16,innerWidth-312))+"px";c.style.top=Math.max(64,Math.min(cy-24,innerHeight-c.offsetHeight-12))+"px";
  const t=c.querySelector("textarea"),add=c.querySelector(".nc1");t.focus();
  const save=async()=>{const text=t.value.trim();if(!text){t.focus();return}add.disabled=true;
    try{const doc=await api({op:"add",screen:id.screen,state:id.state,device:id.device,theme:id.theme,lang:id.lang,mode:id.mode,tester:id.tester,offline:id.offline,person:id.person,x,y,text,at});closeComp();take(doc);sync("");openThread(doc.notes[doc.notes.length-1].id)}
    catch(e){add.disabled=false;sync(e.message)}};
  add.onclick=save;c.querySelector(".nc0").onclick=closeComp;
  t.addEventListener("keydown",(e)=>{e.stopPropagation();if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();save()}else if(e.key==="Escape")closeComp()});
}
/* read: when the author last opened each note's thread, so the index can mark Claude's replies since */
let SEEN={};try{SEEN=JSON.parse(localStorage.getItem("flex-review-seen-"+NFLOW)||"{}")}catch{}
const lastClaude=(n)=>n.replies.filter(r=>r.by==="claude").map(r=>r.at||"").sort().pop()||"";
const unread=(n)=>{const c=lastClaude(n);return !!c&&c>(SEEN[n.id]||"")};
function seen(n){const c=lastClaude(n);if(!c||SEEN[n.id]>=c)return;SEEN[n.id]=c;try{localStorage.setItem("flex-review-seen-"+NFLOW,JSON.stringify(SEEN))}catch{}}
/* a note's thread, floating by its pin (Figma's comments): the note, the replies in order, a reply box, Resolve and,
   for a draft, Delete. One at a time; it follows the pin through zoom and scroll, and flips to the pin's left near the
   window's edge */
let THREAD=null,RAF=0;
function closeThread(){THREAD=null;NSEL=null;cancelAnimationFrame(RAF);const t=document.getElementById("nthread");if(t)t.remove();pins();list()}
function openThread(id){
  const n=NOTES.notes.find(x=>x.id===id);if(!n)return;
  closeComp();THREAD=id;NSEL=id;
  let t=document.getElementById("nthread");if(t)t.remove();
  t=document.createElement("div");t.className="nthread";t.id="nthread";
  t.innerHTML='<header></header><div class="nbody"></div><div class="nact"><textarea rows="1" placeholder="Reply" title="Return sends, Shift+Return: a new line"></textarea><button class="nrb">Reply</button></div>';
  document.body.appendChild(t);
  const ta=t.querySelector("textarea"),reply=()=>{const text=ta.value.trim();if(!text)return;ta.value="";ta.style.height="";act({op:"reply",id,text})};
  t.querySelector(".nrb").onclick=reply;
  ta.addEventListener("input",()=>{ta.style.height="auto";ta.style.height=Math.min(120,ta.scrollHeight+2)+"px"});
  t.addEventListener("keydown",(e)=>{e.stopPropagation();if(e.key==="Escape"){closeThread();return}if(e.target===ta&&e.key==="Enter"&&!e.shiftKey){e.preventDefault();reply()}});
  pins();list();fillThread();place();
}
function fillThread(){
  const t=document.getElementById("nthread"),n=THREAD&&NOTES.notes.find(x=>x.id===THREAD);
  if(!t)return;if(!n){closeThread();return}
  seen(n);
  const shot=n.crop?'<a href="'+NR+'/shots/'+encodeURIComponent(NFLOW)+"/"+n.screenshot.split("/").pop()+'" target="_blank" title="The screen as captured"><img class="ncrop" src="'+NR+'/shots/'+encodeURIComponent(NFLOW)+"/"+n.crop.split("/").pop()+'" alt=""></a>'
    :n.captureError?'<div class="nerr">No screenshot: '+esc(n.captureError)+"</div>":'<div class="nwait">Capturing the screen…</div>';
  t.querySelector("header").innerHTML='<span class="npin'+(n.resolved?" done":n.round==null?" draft":"")+'">'+n.n+'</span><div class="nwhere"><b>'+esc(lbl(n.screen))+"</b><small>"+esc(where(n))+"</small></div>"
    +(n.round==null?'<button class="nhb ndel" title="Delete this draft">Delete</button>':"")+'<button class="nhb nres">'+(n.resolved?"Reopen":"Resolve")+'</button><button class="nx" title="Close (Esc)" aria-label="Close">×</button>';
  t.querySelector(".nx").onclick=closeThread;
  t.querySelector(".nres").onclick=()=>act({op:"resolve",id:n.id,resolved:!n.resolved});
  const del=t.querySelector(".ndel");if(del)del.onclick=()=>{if(confirm("Delete this draft note?")){const id=n.id;closeThread();act({op:"delete",id})}};
  // the note is the first message; a message is unsent until Send stamps it with a round
  const msgs=[{by:"author",text:n.text,at:n.createdAt,unsent:n.round==null,shot:true},...n.replies.map(r=>({by:r.by==="claude"?"claude":"author",text:r.text,at:r.at,unsent:r.by!=="claude"&&r.round===null}))];
  const when=(a)=>{const d=new Date(a);if(isNaN(d))return "";const today=d.toDateString()===new Date().toDateString();return d.toLocaleString([],today?{hour:"2-digit",minute:"2-digit"}:{weekday:"short",hour:"2-digit",minute:"2-digit"})};
  const html=msgs.map((m,i)=>{const me=m.by!=="claude",head=i===0||msgs[i-1].by!==m.by;
    return (head?(me?'<div class="nwho me">You</div>':'<div class="nwho"><i>C</i>Claude</div>'):"")
      +'<div class="nmsg '+(me?"me":"claude")+(m.unsent?" unsent":"")+'"><div class="nmd">'+md(m.text)+"</div>"+(m.shot?shot:"")+"<time>"+when(m.at)+(m.unsent?" · not sent":"")+"</time></div>"}).join("")
    +(n.resolved?'<div class="nwho" style="align-self:center">Resolved</div>':"");
  const body=t.querySelector(".nbody"),atEnd=!body.dataset.html||body.scrollHeight-body.scrollTop-body.clientHeight<24;
  if(body.dataset.html!==html){body.innerHTML=html;body.dataset.html=html;if(atEnd)body.scrollTop=body.scrollHeight}
}
function place(){
  cancelAnimationFrame(RAF);
  const t=document.getElementById("nthread");if(!t||!THREAD)return;
  const p=[...document.querySelectorAll('#stage .npin[data-id="'+THREAD+'"]')].find(x=>x.offsetParent);
  if(!p){t.style.visibility="hidden"}else{
    const b=p.getBoundingClientRect(),w=t.offsetWidth,h=t.offsetHeight;
    let x=b.right+12;if(x+w>innerWidth-12)x=b.left-12-w;if(x<12)x=Math.max(12,innerWidth-w-12);
    const y=Math.max(64,Math.min(b.top-12,innerHeight-h-12));
    t.style.visibility="visible";t.style.left=x+"px";t.style.top=y+"px"}
  RAF=requestAnimationFrame(place);
}
/* a note picked in the index: the canvas goes to its frame (its device, theme and language) and opens its thread */
function select(id){
  const n=NOTES.notes.find(x=>x.id===id);if(!n)return;
  S.screen=n.screen;S.state=n.state||"";S.screens="one";S.stmode="one";if(THEMES.includes(n.theme))S.theme=n.theme;if(n.lang&&n.lang!==LANG&&LANGS.some(x=>x[0]===n.lang))setLang(n.lang,true);
  const c=kind(n.device);if(CATS.some(x=>x.c===c))S.devs=new Set([c]);drop(null);go();openThread(id)}
function reveal(){const a=document.querySelector('.nrow[data-id="'+NSEL+'"]');if(a)a.scrollIntoView({block:"nearest"})}
const pending=(n)=>n.round!=null&&n.replies.some(r=>r.by==="author"&&r.round===null);
/* the notes' index: a row per note (its pin, where, its first line, replies, unread, state); Send at its foot */
function list(){
  const L=document.getElementById("nlist");
  const drafts=NOTES.notes.filter(n=>n.round==null).length,reps=NOTES.notes.filter(pending).length,last=NOTES.rounds[NOTES.rounds.length-1];
  const nb=document.getElementById("nnotes");document.getElementById("nncount").textContent=NOTES.notes.length;nb.classList.toggle("due",drafts+reps>0);
 nb.title="Notes"+(drafts+reps?" · unsent: "+drafts+" draft"+(drafts===1?"":"s")+", "+reps+" repl"+(reps===1?"y":"ies"):"");
  const sb=document.getElementById("nsend");sb.disabled=!(drafts+reps);
  sb.textContent=drafts+reps?"Send "+[drafts?drafts+" note"+(drafts>1?"s":""):"",reps?reps+" repl"+(reps>1?"ies":"y"):""].filter(Boolean).join(" + "):"Nothing to send";
  document.getElementById("nsub").textContent=last?"Round "+last.round+" sent "+new Date(last.sentAt).toLocaleString([],{weekday:"short",hour:"2-digit",minute:"2-digit"}):"Nothing sent yet: Send hands your drafts and new replies to Claude as one round";
  const ns=NOTES.notes.filter(n=>!(HIDE&&n.resolved));
  L.innerHTML=ns.length?ns.map(n=>{
    const state=n.resolved?"Resolved":n.round==null?"Draft":"Round "+n.round,nr=n.replies.length;
    return '<button class="nrow'+(n.id===NSEL?" sel":"")+(n.resolved?" done":"")+'" data-id="'+n.id+'"><span class="npin'+(n.resolved?" done":n.round==null?" draft":"")+'">'+n.n+"</span>"
      +'<span class="nwhere"><b>'+esc(lbl(n.screen))+"</b><small>"+esc(where(n))+"</small><span>"+esc(n.text.split("\\n")[0])+"</span></span>"
      +'<span class="nmeta"><span class="'+(n.round==null&&!n.resolved?"nchip draft":"nchip")+'">'+state+"</span><span>"+(unread(n)?'<i class="nunread" title="Claude replied since you last opened it"></i>':"")+(nr?nr+" repl"+(nr===1?"y":"ies"):"")+"</span></span></button>"}).join("")
    :'<div class="nempty">'+"Shift+Click a spot on a frame to leave a note there."+"</div>";
  L.querySelectorAll(".nrow").forEach(a=>a.onclick=()=>select(a.dataset.id));
}
// typing in the notes never steps screens or closes the canvas's views
document.getElementById("nside").addEventListener("keydown",(e)=>e.stopPropagation());
document.getElementById("nsend").onclick=()=>act({op:"send"});
const hide=document.getElementById("nhide");hide.checked=HIDE;hide.onchange=()=>{HIDE=hide.checked;try{localStorage.setItem("flex-review-hide",HIDE?"1":"0")}catch{};list();pins()};
/* Shift+Click leaves a note; a plain click goes to the app. The frames are the app on this page's origin (flex review
   proxies it), so the page listens inside each one (again on each load): Shift there shows the crosshair and lets the
   overlay take the click, and a Shift+pointerdown that still reaches the frame opens the note box itself */
function setShift(on){if(STATIC||SHIFT===on)return;SHIFT=on;document.body.classList.toggle("shifting",on);
  document.querySelectorAll("#stage iframe").forEach(f=>{try{f.contentDocument.documentElement.classList.toggle("flex-shift",on)}catch{}})}
addEventListener("keydown",(e)=>{if(e.key==="Shift")setShift(true)});addEventListener("keyup",(e)=>{if(e.key==="Shift")setShift(false)});addEventListener("blur",()=>setShift(false));
/* ⌥ held: the screens offer themselves to be copied (an overlay on the one under the pointer, the plain cursor), so a
   ⌥-click reads as "picture this", not a click in the app */
let ALT=false,PT=null;
/* the screen under the pointer gets the overlay at once (not :hover, which waits for the mouse to move): the pointer's
   last place is kept from the page and from inside the frames */
function altMark(){document.querySelectorAll("#stage .nlay.ahov").forEach(o=>o.classList.remove("ahov"));if(!ALT||!PT)return;
  for(const o of document.querySelectorAll("#stage .nlay")){const b=o.getBoundingClientRect();if(PT.x>=b.left&&PT.x<=b.right&&PT.y>=b.top&&PT.y<=b.bottom){o.classList.add("ahov");break}}}
addEventListener("mousemove",(e)=>{PT={x:e.clientX,y:e.clientY};if(ALT)altMark()},true);
function setAlt(on){if(STATIC||ALT===on)return;ALT=on;document.body.classList.toggle("alting",on);altMark();
  document.querySelectorAll("#stage iframe").forEach(f=>{try{f.contentDocument.documentElement.classList.toggle("flex-alt",on)}catch{}})}
addEventListener("keydown",(e)=>{if(e.key==="Alt")setAlt(true)});addEventListener("keyup",(e)=>{if(e.key==="Alt")setAlt(false)});addEventListener("blur",()=>setAlt(false));
/** where a frame has got to (its path and query), when it is on this origin */
function frameAt(f){let at;try{const l=f.contentWindow.location;at=l.pathname+l.search}catch{at=f.flexAt}return at?at.replace(/([?&])token=[^&]*&?/,"$1").replace(/[?&]$/,""):null}
/* a frame on its own host (a setup's, see ISO) tells where it is and what Shift does in it (the proxy's frame script) */
addEventListener("message",(e)=>{const m=e.data&&e.data.flexFrame;if(!m||typeof m!=="object")return;
  const f=[...document.querySelectorAll("#stage iframe")].find(x=>x.contentWindow===e.source);if(!f)return;
  if(m.failed)f.flexFailed=1;if(typeof m.actions==="string")f.flexActions=m.actions;if(typeof m.at==="string"){f.flexAt=m.at;f.flexState=m.state}if(m.mut)f.flexMut=Date.now();if(typeof m.shift==="boolean")setShift(m.shift);
  if(m.note&&!STATIC){const l=f.closest(".live"),o=l&&l.querySelector(".nlay"),r=l&&ROWS[+l.dataset.r];if(!o||!r)return;const b=f.getBoundingClientRect(),x=+m.note.x,y=+m.note.y;
    compose(r,o,x,y,b.left+x*b.width,b.top+y*b.height,frameAt(f))}});
function hookFrame(f,r,o){if(STATIC)return;
  const hook=()=>{let d;try{d=f.contentDocument}catch{return}if(!d||!d.documentElement||d.flexHooked)return;d.flexHooked=1;
    const st=d.createElement("style");st.textContent="html.flex-shift,html.flex-shift *{cursor:crosshair!important}html.flex-alt,html.flex-alt *{cursor:default!important}";d.documentElement.appendChild(st);
    d.documentElement.classList.toggle("flex-shift",SHIFT);d.documentElement.classList.toggle("flex-alt",ALT);
    d.addEventListener("mousemove",(e)=>{const b=f.getBoundingClientRect(),w=d.defaultView;PT={x:b.left+e.clientX/w.innerWidth*b.width,y:b.top+e.clientY/w.innerHeight*b.height}},true);
    d.addEventListener("keydown",(e)=>{if(e.key==="Shift")setShift(true);if(e.key==="Alt")setAlt(true)},true);d.addEventListener("keyup",(e)=>{if(e.key==="Shift")setShift(false);if(e.key==="Alt")setAlt(false)},true);
    // Shift-click leaves a note, ⌥-click copies the screen: either way the app never sees the click
    const eat=(e)=>{if(!e.shiftKey&&!e.altKey)return;e.preventDefault();e.stopImmediatePropagation()};
    for(const t of ["pointerup","mousedown","mouseup","click"])d.addEventListener(t,eat,true);
    d.addEventListener("pointerdown",(e)=>{if(e.altKey&&!e.shiftKey){eat(e);copyShot(r);return}if(!e.shiftKey)return;eat(e);const w=d.defaultView,b=f.getBoundingClientRect(),x=e.clientX/w.innerWidth,y=e.clientY/w.innerHeight;
      compose(r,o,x,y,b.left+x*b.width,b.top+y*b.height,frameAt(f))},true)};
  if(!f.flexLoad){f.flexLoad=1;f.addEventListener("load",hook)}
  hook();
}
/* the top bar, left: the product's logo | the flow ▾ | (in Single, the grid button) the screen ▾ | its state ▾ (when
   it has states). Each opens a menu under it (Esc, a click outside or the button again closes it). Right: View, Notes
   and Zoom, each a panel under its button */
let MENU=null,MENUREF=null;
function closeMenu(){const el=document.getElementById("nmenu");if(el)el.remove();if(MENU){const b=document.getElementById(MENU);if(b)b.setAttribute("aria-expanded",false)}MENU=null;MENUREF=null}
function menu(bid,fill){const was=MENU;closeMenu();drop(null);if(was===bid)return;
  MENU=bid;const b=document.getElementById(bid);b.setAttribute("aria-expanded",true);
  const el=document.createElement("div");el.id="nmenu";el.className="nspick";document.body.appendChild(el);
  el.addEventListener("keydown",(e)=>{e.stopPropagation();if(e.key==="Escape")closeMenu()});
  fill(el);const r=b.getBoundingClientRect();el.style.left=Math.max(12,Math.min(r.left,innerWidth-el.offsetWidth-12))+"px";el.style.top=r.bottom+8+"px"}
/* the three pickers narrow what the canvas shows, each with "All …" first: all flows (the project's home, a card per
   flow), all screens (the flow's grid), all states (a screen's states side by side), or one: one flow, screen and state
   is the Single view, the app live in its frame. Each is a list or a grid of snapshots (placeholders until taken), the
   display shared (flex-review-picker); search when long; open notes per row */
let HOMED=null;
let FLOWS=[{href:location.pathname,title:TITLE}];
const loadFlows=()=>fetch("../lists.json",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.length)FLOWS=j}).catch(()=>{});
loadFlows();
/** the flows as the home page has them: each one's cover (its first screen's snapshot) for the picker's grid */
const loadHome=()=>STATIC?Promise.resolve():fetch(NR+"/api/home?device="+thumbKey()+"&theme="+S.theme+"&lang="+LANG+VQ(),{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>{if(j)HOMED=j}).catch(()=>{});
const LISTIC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>';
const openOn=(s,st)=>NOTES.notes.filter(n=>!n.resolved&&n.screen===s&&(st===undefined||(n.state||"")===st)).length;
const thumbKey=()=>(shown()[0]||CATS[0]).k;
const ASPECT={phone:0.45,tablet:0.69,land:1.45,laptop:1.6,window:1.6};
const ratio=()=>"aspect-ratio:"+(ASPECT[kind(thumbKey())]||0.5);
/** a picker tile's picture: "All" a grid icon; else its snapshot (a flow's: its first screen's), or a placeholder */
function tileArt(x){if(x.all)return '<span class="nth nalltile" style="'+ratio()+'">'+UI.all+"</span>";
  const u=x.thumb!==undefined?x.thumb:(SNAPS[x.name+"."+thumbKey()+"."+S.theme+"."+LANG+"."+MODE+".t"+TESTER+".s"+(offOf(x.name)?0:1)+".p-"+pkey(x.name)]||{}).url;
  return u?'<img class="nth" src="'+u+'" alt="">':'<span class="nth nwait" style="'+ratio()+'"></span>'}
function pickMenu(bid,items,pick,searchAt,ic){
  menu(bid,(el)=>{
    el.innerHTML='<div class="nmh"><div class="seg pv"></div><input type="search" placeholder="Search" autocomplete="off"></div><div class="nsl"></div>';
    const q=el.querySelector("input"),l=el.querySelector(".nsl");
    const fill=()=>{const t=q?q.value.trim().toLowerCase():"",g=PV==="grid";
      seg(el.querySelector(".pv"),["list","grid"],(v)=>v===PV,(v)=>{PV=v;try{localStorage.setItem("flex-review-picker",v)}catch{};fill()},(v)=>v==="list"?LISTIC:UI.all);
      el.querySelectorAll(".pv button").forEach((b,i)=>{const n=["List","Grid"][i];b.title=n;b.setAttribute("aria-label",n)});
      el.style.width=g?"460px":"360px";l.className="nsl"+(g?" g":"");l.style.setProperty("--min",({phone:120,tablet:150,land:190,laptop:190}[kind(thumbKey())]||150)+"px");
      const its=items().filter(x=>x.all||!t||x.label.toLowerCase().includes(t)||(x.num||"").includes(t));
      l.innerHTML=its.map(x=>'<button class="'+(x.cur?"cur":"")+'" data-v="'+esc(x.value)+'">'+(g?tileArt(x):'<span class="num nic">'+(x.all?UI.all:(ic||""))+"</span>")
        +'<span class="nlab">'+'<span class="nlw"><span class="nlt" title="'+esc(x.label).replace(/"/g,"&quot;")+'">'+esc(x.label)+"</span>"+(x.sub?"<small>"+esc(x.sub)+"</small>":"")+"</span></span>"+(x.open?'<em title="Open notes">'+x.open+"</em>":"")+"</button>").join("");
      l.querySelectorAll("button").forEach(b=>b.onclick=()=>{closeMenu();pick(b.dataset.v)});
      const c=l.querySelector(".cur");if(c&&!t)c.scrollIntoView({block:"center"});
      // under its button, kept inside the window whatever its width
      const b=document.getElementById(bid).getBoundingClientRect();el.style.left=Math.max(12,Math.min(b.left,innerWidth-el.offsetWidth-12))+"px"};
    {q.oninput=fill;q.addEventListener("keydown",(e)=>{if(e.key==="Enter"){const f=l.querySelectorAll("button")[1]||l.querySelector("button");if(f)f.click()}});setTimeout(()=>q.focus(),0)}
    MENUREF=fill;fill();snaps(true)})}
/* open a flow the way every way in does (the flow picker, ←/→ rolling over): its page lands on all its screens, or on
   its one screen (all its states) — the page decides, from its own screen count */
function openFlow(href){location.href=href+"?devices="+[...S.devs].join(",")+"&theme="+S.theme}
LISTSTEP=(d)=>{loadFlows().then(()=>{const i=FLOWS.findIndex(l=>l.href===location.pathname);
  if(i<0||FLOWS.length<2){S.screens=SCREENS.length===1?"one":"all";S.stmode="all";go();return}
  openFlow(FLOWS[(i+d+FLOWS.length)%FLOWS.length].href)})};
document.getElementById("nflowb").onclick=()=>{pickMenu("nflowb",()=>[{all:true,value:"*",label:"All flows",cur:false},
  ...FLOWS.map(l=>{const c=HOMED&&HOMED.flows.find(f=>f.href===l.href);
    return {value:l.href,label:l.title,sub:l.screens!=null?l.screens+" screen"+(l.screens===1?"":"s"):"",cur:l.href===location.pathname,open:l.open,thumb:c?c.cover:(l.covers?(l.covers[thumbKey()]||Object.values(l.covers)[0]||null):null)}})],
  (v)=>{if(v==="*"){location.href=NR+"/";return}
    if(v===location.pathname){S.screens=SCREENS.length===1?"one":"all";S.stmode="all";go();return}
    openFlow(v)},10,PIC.flow);
  Promise.all([loadFlows(),loadHome()]).then(()=>{if(MENU==="nflowb"&&MENUREF)MENUREF()})};
document.getElementById("nscr").onclick=()=>pickMenu("nscr",()=>[{all:true,value:"*",label:"All screens",cur:S.screens!=="one"&&!S.sub},
  ...ITEMS().flatMap(it=>it.g?[{name:it.ss[0],value:"g:"+it.g,label:it.g,sub:it.ss.length+" screens",cur:S.sub===it.g&&S.screens!=="one"}]:[]),
  ...SCREENS.map(s=>{const ns=states(s).length+1,g=entry(s).group;return {name:s,value:s,label:lbl(s).replace(/&lt;/g,"<"),sub:(g?g+" · ":"")+ns+" state"+(ns===1?"":"s"),cur:S.screens==="one"&&s===S.screen,open:openOn(s)}})],
  (v)=>{if(v==="*"){S.screens="all";S.sub="";go();return}if(v.startsWith("g:")){openGroup(v.slice(2));return}openScreen(v)},10,PIC.screen);
document.getElementById("nst").onclick=()=>pickMenu("nst",()=>[{all:true,value:"*",label:"All states",cur:S.stmode==="all"},
  ...[{name:"",label:entry(S.screen).defaultLabel||"Default"},...states(S.screen)].map(x=>({name:x.name?S.screen+"@"+x.name:S.screen,value:x.name,label:x.label,cur:S.stmode!=="all"&&S.state===x.name,open:openOn(S.screen,x.name)}))],
  (v)=>{if(v==="*"){S.stmode="all";go();return}S.state=v;S.stmode="one";go()},10,PIC.state);
// the page's own header (head()) draws these instead
head=function(){
  const one=S.screens==="one",sts=one?states(S.screen):[],st=one&&S.state?sts.find(x=>x.name===S.state):null;
  document.getElementById("nflowt").textContent=TITLE;document.getElementById("nflowic").innerHTML=PIC.flow;
  document.getElementById("nscr").innerHTML='<span class="pic">'+PIC.screen+"</span>"+(one?"<b>"+(S.sub?esc(S.sub)+" › ":"")+lbl(S.screen)+"</b>":S.sub?"<b>"+esc(S.sub)+"</b><i>"+SCREENS.filter(x=>grp(x)===S.sub).length+"</i>":"<b>All screens</b><i>"+ITEMS().length+"</i>")+CHEV;
  document.getElementById("nst").hidden=document.getElementById("nstdiv").hidden=!sts.length;
  if(sts.length)document.getElementById("nst").innerHTML='<span class="pic">'+PIC.state+"</span><b>"+(S.stmode==="all"?"All states":esc(st?st.label:(entry(S.screen).defaultLabel||"Default")))+"</b>"+CHEV};
// the View panel keeps devices, theme and language: screens and states are picked from the top bar
document.getElementById("smode").closest(".sec").classList.add("ngone");document.getElementById("statesec").classList.add("ngone");
head();
// the zoom: its controls (the page's own bar) in a panel, the button showing the zoom
document.getElementById("nzoomp").appendChild(document.getElementById("bar"));
const zl0=zoomLabel;zoomLabel=function(){zl0();document.getElementById("nzv").textContent=Math.round(Z*100)+"%"};
const DROPS={nview:document.querySelector("aside:not(.nside):not(.nzp)"),nnotes:document.getElementById("nside"),nzoom:document.getElementById("nzoomp")};
let SWALLOW=false;
function drop(k){if(k)closeMenu();for(const [b,el] of Object.entries(DROPS)){const on=b===k;el.classList.toggle("open",on);document.getElementById(b).setAttribute("aria-expanded",on)
    if(on){const r=document.getElementById(b).getBoundingClientRect();el.style.top=r.bottom+8+"px";el.style.left="auto";el.style.right=Math.max(12,innerWidth-r.right)+"px"}}
  if(k!=="nview")closePicker();if(k==="nnotes")requestAnimationFrame(reveal)}
const opened=()=>Object.keys(DROPS).find(b=>DROPS[b].classList.contains("open"))||null;
for(const b of Object.keys(DROPS))document.getElementById(b).onclick=()=>drop(opened()===b?null:b);
// a click outside an open menu, panel or thread only closes it (it doesn't also drop a note on the frame under it)
addEventListener("mousedown",(e)=>{
  const k=opened(),t=document.getElementById("nthread"),m=document.getElementById("nmenu");
  if(m&&!m.contains(e.target)&&!e.target.closest("#"+MENU)){closeMenu();SWALLOW=true}
  else if(k&&!DROPS[k].contains(e.target)&&!e.target.closest("#"+k)){drop(null);SWALLOW=true}
  else if(!k&&t&&!t.contains(e.target)&&!e.target.closest(".npin")){closeThread();SWALLOW=!e.shiftKey}
  if(SWALLOW)setTimeout(()=>{SWALLOW=false},500)},true);
addEventListener("click",(e)=>{if(SWALLOW){SWALLOW=false;e.stopPropagation();e.preventDefault()}},true);
addEventListener("keydown",(e)=>{if(e.key!=="Escape"||pickerOpen()||document.getElementById("ncomp"))return;
  if(MENU){e.stopImmediatePropagation();closeMenu()}else if(opened()){e.stopImmediatePropagation();drop(null)}else if(THREAD){e.stopImmediatePropagation();closeThread()}},true);
/* a published copy's views: in a grid (snapshots) only those the flow has; in Single (the live app) all. Going back to
   a grid with a view the flow lacks falls back to its default, quietly */
const VIEWS=STATIC&&STATIC.views;
function staticFallback(){if(!VIEWS||oneView())return;let re=false;
  if(!VIEWS.themes.includes(S.theme)){S.theme=VIEWS.themes[0];re=true}
  if(!VIEWS.langs.includes(LANG)){LANG=VIEWS.langs[0];re=true}
  if(!VIEWS.signals.includes(SIGNAL)){SIGNAL=VIEWS.signals[0];re=true}
  if(re){relink();langSeg();sigSeg()}}
function staticControls(){if(!VIEWS)return;const one=oneView();
  const show=(id,vals,ok)=>{const bs=[...document.querySelectorAll("#"+id+" button")];let n=0;bs.forEach((b,i)=>{const on=one||ok(vals[i]);b.style.display=on?"":"none";if(on)n++});
    const sec=document.getElementById(id).closest(".sec");if(sec)sec.style.display=n>1?"":"none"};
  show("themes",THEMES,(v)=>VIEWS.themes.includes(v));show("nlangs",LANGS.map(x=>x[0]),(v)=>VIEWS.langs.includes(v));show("nsignal",[1,0],(v)=>VIEWS.signals.includes(v))}
if(VIEWS){const go0=go;go=function(){staticFallback();go0()}}
/* the "Signed in as" button (left of View): the person of the screen open, or in a grid the one picked (else the
   flow's default); its menu lists who the screens in view offer. Hidden where the screen open is signed out */
const initials=(n)=>{const w=String(n).split(/\\s+/).filter(x=>x&&!/\\.$/.test(x));return ((w[0]||"?")[0]+(w.length>1?w[w.length-1][0]:"")).toUpperCase()};
const pname=(p)=>(PEOPLE.all[p]||{name:p}).name,prole=(p)=>(PEOPLE.all[p]||{}).role||"";
function inView(){if(oneView())return [cur1()];const names=[];SCREENS.forEach(sc=>{names.push(sc);if(S.screens==="one")states(sc).forEach(st=>names.push(sc+"@"+st.name))});return names}
function candidates(){const out=[];for(const n of inView()){const i=pinfo(n);if(!i||i.fixed)continue;if(!picked()&&VIEWS&&!oneView()){if(i.person&&!out.includes(i.person))out.push(i.person);continue}for(const p of i.people)if(!out.includes(p))out.push(p);if(i.person&&!out.includes(i.person))out.push(i.person)}return out}
function personBar(){const b=document.getElementById("nperson"),c=candidates();
  const shown=oneView()?personOf(cur1()):(picked()&&c.includes(picked())?picked():PEOPLE.flow.person||c[0]);
  b.hidden=!c.length||!shown||(oneView()&&(!pinfo(cur1())||pinfo(cur1()).fixed));
  if(b.hidden)return;
  // icon only, like the other buttons on the right: the person's initials; their name and role in the tooltip
  b.innerHTML='<span class="nav">'+esc(initials(pname(shown)))+"</span>";
  const who="Signed in as "+pname(shown)+(prole(shown)?" · "+prole(shown):"");b.title=who;b.setAttribute("aria-label",who)}
document.getElementById("nperson").onclick=()=>menu("nperson",(el)=>{
  const c=candidates(),cur=oneView()?personOf(cur1()):(picked()&&c.includes(picked())?picked():PEOPLE.flow.person||c[0]),env=ENVS.find(e=>e.key===MODE);
  el.innerHTML=(c.length>10?'<div class="nmh"><input type="search" placeholder="Search" autocomplete="off"></div>':"")+'<div class="nsl npl"></div>';
  const q=el.querySelector("input"),l=el.querySelector(".npl");
  const fill=()=>{const t=q?q.value.trim().toLowerCase():"";
    l.innerHTML=c.filter(p=>!t||pname(p).toLowerCase().includes(t)||prole(p).toLowerCase().includes(t)).map(p=>{const no=env&&!(env.accounts||[]).includes(p);
      return '<button data-p="'+esc(p)+'"'+(p===cur?' class="cur"':"")+(no?' disabled title="No '+esc(env.label)+' account"':"")+'><span class="nav">'+esc(initials(pname(p)))+"</span><span><b>"+esc(pname(p))+"</b>"+(prole(p)?"<small>"+esc(prole(p))+"</small>":"")+"</span>"+(p===cur?'<i class="tick">✓</i>':"")+"</button>"}).join("");
    l.querySelectorAll("button").forEach(x=>x.onclick=()=>{closeMenu();PERSON=x.dataset.p;mem("person:"+NFLOW,PERSON);relink();go()})};
  if(q){q.oninput=fill;setTimeout(()=>q.focus(),0)}fill()});
AFTER=()=>{staticControls();personBar();
  document.querySelectorAll('#stage .nhost[data-sig="grid"] figure[data-s]').forEach(f=>f.onclick=()=>openScreen(f.dataset.s));
  document.querySelectorAll('#stage .nhost[data-sig="grid"] figure[data-g]').forEach(f=>f.onclick=()=>openGroup(f.dataset.g));
  pins();snaps();remember();hydrateAll()};
/* a live frame shows its snapshot first (the grid's: placeholder if none yet) while the app loads under it, hidden and
   not clickable (a click meanwhile goes nowhere; Shift+Click still notes, on the seed link); once the app is ready it
   crossfades in. Ready: past the seed link (/dev/seed) and on one path for 400 ms, the page loaded and its fonts in,
   and its body unchanged for 300 ms; or the project's "ready": { "selector" } matching; at most 8 s. Then the snapshot
   is taken again, so the grid keeps up with the app */
const READY=typeof FLEXREADY!=="undefined"?FLEXREADY:null;
function hydrateAll(){document.querySelectorAll('#stage .nhost:not([hidden]) .live[data-r] iframe').forEach(f=>{if(!f.dataset.hyd)hydrate(f,ROWS[+f.closest(".live").dataset.r])})}
function hydrate(f,r){
  const k=snapKey(r),s=SNAPS[k],lay=document.createElement("div");
  f.dataset.hyd="wait";Object.assign(f.style,{opacity:"0",pointerEvents:"none",transition:"opacity .2s"});
  lay.className="nsnapw nhyd"+(s&&s.url?"":" nwait")+(r.theme==="dark"?" dk":"");lay.dataset.snap=k;
  lay.style.cssText="position:absolute;z-index:1;left:"+f.offsetLeft+"px;top:"+f.offsetTop+"px;width:"+f.offsetWidth+"px;height:"+f.offsetHeight+"px;transition:opacity .2s";
  lay.innerHTML=s&&s.url?'<img src="'+s.url+'" alt="">':'<span class="nshim">'+(STATIC?"Loading the live app…":"Capturing…")+"</span>";
  f.after(lay);if(!(s&&s.url))snaps(true);
  let t0=Date.now(),loc=null,since=0,mut=Date.now(),mo=null,doc=null,fonts=false;f.flexAt=undefined;f.flexFailed=0;f.flexMut=0;f.flexActions=undefined;const T00=t0;
  {const old=f.parentElement&&f.parentElement.querySelector(".nactf");if(old)old.remove()}
  // the frame's actions (the proxy's frame script runs them): ready only once they are done; one failing is said on the frame
  const acts=()=>{try{const a=f.contentWindow.__flexActions;if(a!==undefined)return a}catch{}return f.flexActions};
  const done=()=>{if(mo)mo.disconnect();f.dataset.hyd="ready";
    const a=acts();if(typeof a==="string"&&a.startsWith("failed")){const b=document.createElement("div");b.className="nactf";b.textContent="Action failed: "+a.replace(/^failed: /,"");
      b.style.cssText="position:absolute;z-index:3;left:"+f.offsetLeft+"px;top:"+f.offsetTop+"px;width:"+f.offsetWidth+"px;padding:6px 8px;background:#ff3b30;color:#fff;font:600 12px/1.3 system-ui;box-sizing:border-box";f.after(b)}f.style.opacity="1";f.style.pointerEvents="";lay.style.opacity="0";setTimeout(()=>lay.remove(),250);
    if(!STATIC)fetch(NR+"/api/resnap?flow="+encodeURIComponent(NFLOW)+"&name="+encodeURIComponent(r.screen)+"&device="+r.key+"&theme="+r.theme+"&lang="+LANG+VQ()).catch(()=>{})};
  const tick=()=>{if(!f.isConnected){if(mo)mo.disconnect();return}
    let ok=false;
    try{const w=f.contentWindow,d=f.contentDocument,here=w.location.pathname+w.location.search;
      if(here!==loc){loc=here;since=Date.now()}
      // (a frame still running its setup, or at its first blank page meanwhile, isn't ready, nor counting; a setup that
      // failed is: it shows why)
      const failed=!!d.querySelector("[data-flex-setup-error]"),insetup=!failed&&f.src.includes("/api/setup-frame")&&(w.location.href==="about:blank"||w.location.pathname.startsWith(NR+"/api/setup-frame"));if(insetup&&Date.now()-T00<60000)t0=Date.now();
      if(d!==doc&&d.body){if(mo)mo.disconnect();doc=d;fonts=false;mut=Date.now();
        mo=new w.MutationObserver(()=>{mut=Date.now()});mo.observe(d.body,{subtree:true,childList:true,characterData:true});
        (d.fonts?d.fonts.ready:Promise.resolve()).then(()=>{if(doc===d)fonts=true})}
      const now=Date.now();
      ok=failed?true:insetup?false:READY&&READY.selector?!!d.querySelector(READY.selector)
        :!insetup&&!w.location.pathname.startsWith("/dev/seed")&&now-since>=400&&d.readyState==="complete"&&fonts&&now-mut>=300}
    catch{
      // a frame on its own host: what its pages tell (the frame bridge); still at its setup, not counting
      if(f.flexFailed)ok=true;else if(typeof f.flexAt==="string"){if(f.flexAt!==loc){loc=f.flexAt;since=Date.now()}const now=Date.now();ok=f.flexState==="complete"&&now-since>=400&&now-(f.flexMut||0)>=300}
      else if(f.src.includes("/api/setup-frame")&&Date.now()-T00<60000)t0=Date.now()}
    const a=acts();if(a==="pending"){ok=false;if(Date.now()-T00<60000)t0=Date.now()}
    if(ok||Date.now()-t0>8000)done();else setTimeout(tick,100)};
  tick()}
if(STATIC)poll();else{setInterval(poll,3000);poll()}`;
}

/* ── flex review's home: the project's flows as cards (each one's cover, its first screen's snapshot, at the devices,
   theme and language the flows remember; its screens, open notes and last round), the open notes of every flow, and
   the View controls the covers follow. It reads /api/home every 3 s. ── */
export type HomeDevice = { key: string; cat: string; label: string };
export function homePage(o: { name: string; logo: string | null; root: string; devices: HomeDevice[]; envs?: { key: string; label: string }[]; flows?: unknown[] }): string {
  const js = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
  const ic = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${o.name.replace(/</g, "&lt;")} · review</title><style>
:root{--bg:#f4f4f6;--panel:#fff;--ink:#16151a;--sub:#6b6873;--line:#e6e5ea;--soft:#f1f0f4;--on:#16151a;--onInk:#fff;--pin:#2f6bff;--canvas:#ececf0}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121115;--panel:#1b1a1f;--ink:#f2f1f5;--sub:#a19faa;--line:#2c2a31;--soft:#24232a;--on:#f2f1f5;--onInk:#121115;--canvas:#16151a}}
:root[data-theme=dark]{--bg:#121115;--panel:#1b1a1f;--ink:#f2f1f5;--sub:#a19faa;--line:#2c2a31;--soft:#24232a;--on:#f2f1f5;--onInk:#121115;--canvas:#16151a}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif}
button{font:inherit;color:inherit;cursor:pointer}
.top{position:sticky;top:0;z-index:5;height:52px;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--panel);border-bottom:1px solid var(--line)}
.top img{height:28px;width:auto;max-width:140px}.top .mark{width:28px;height:28px;border-radius:8px;background:var(--on);color:var(--onInk);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.top .div{width:1px;height:22px;background:var(--line)}.top b{font-size:15px}.grow{flex:1}
.tb{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:6px 9px;position:relative}
.tb:hover,.tb[aria-expanded=true]{background:var(--soft)}.tb span{font-size:12.5px}
.tb.due::after{content:"";position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:var(--pin);border:2px solid var(--panel)}
.panel{position:fixed;z-index:6;top:60px;right:12px;width:340px;max-height:calc(100vh - 72px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.16);display:none}
.panel.open{display:block}.sec{padding:14px 16px;border-bottom:1px solid var(--line)}.sec:last-child{border-bottom:0}.lab{font-size:12.5px;font-weight:700;margin-bottom:8px}
.seg{display:flex;background:var(--soft);border-radius:9px;padding:3px;gap:2px}.seg button{flex:1;border:0;background:transparent;border-radius:7px;padding:7px 6px;font-size:12.5px;font-weight:600;color:var(--sub)}
.seg button[aria-pressed=true]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.nf h4{margin:0 0 6px;font-size:13px}.nf a{display:flex;gap:8px;padding:6px 8px;border-radius:8px;color:inherit;text-decoration:none}.nf a:hover{background:var(--soft)}
.nf a i{font-style:normal;flex:none;width:22px;height:22px;border-radius:50% 50% 50% 4px;background:var(--pin);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.nf a span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nf small{color:var(--sub)}.none{color:var(--sub);padding:6px 2px}
main{padding:28px 28px 48px}main h1{margin:0 0 18px;font-size:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;color:inherit;text-decoration:none;transition:box-shadow .15s}
.card:hover{box-shadow:0 8px 24px rgba(0,0,0,.1)}
.cover{height:300px;background:var(--soft);display:flex;align-items:flex-start;justify-content:center;overflow:hidden;padding:16px 16px 0}
.cover img{width:auto;max-width:100%;height:auto;max-height:none;border-radius:14px 14px 0 0;box-shadow:0 2px 12px rgba(0,0,0,.12)}
.cover .wait{width:62%;height:100%;border-radius:14px 14px 0 0;background:linear-gradient(100deg,#e9e7ee 35%,#f6f5f8 50%,#e9e7ee 65%) 0 0/300% 100% #e9e7ee;animation:sh 1.6s linear infinite}
@keyframes sh{from{background-position:100% 0}to{background-position:0 0}}
.meta{padding:12px 14px 14px;display:grid;gap:3px}.meta b{font-size:15px;display:flex;align-items:center;gap:8px}.meta b em{font-style:normal;font-size:11px;font-weight:700;background:var(--pin);color:#fff;border-radius:10px;padding:1px 7px}
.meta small{color:var(--sub);font-size:12.5px}.static .cover .wait{animation:none}
.stg{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#5b5fc7;border-radius:6px;padding:3px 8px}.stg[data-env=staging]{background:#d9480f}.stg[data-env=local]{background:#0d8a6a}.seg button:disabled{opacity:.45;cursor:not-allowed}.err{color:#d33;font-size:12.5px;white-space:pre-wrap;padding:16px}
</style></head><body>
<div class="top">${o.logo ? `<img src="${o.logo}" alt="">` : '<div class="mark">F</div>'}<span class="div"></span><b>${o.name.replace(/</g, "&lt;")}</b><span class="grow"></span><span class="stg" id="stg" hidden>Staging</span>
<button class="tb" id="view" aria-expanded="false" title="View: devices, theme, language" aria-label="View">${ic('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>')}</button>
<button class="tb" id="notes" aria-expanded="false" title="Notes" aria-label="Notes">${ic('<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>')}<span id="ncount">0</span></button></div>
<div class="panel" id="pview"><div class="sec"><div class="lab">Devices</div><div class="seg" id="devs"></div></div><div class="sec"><div class="lab">Theme</div><div class="seg" id="themes"></div></div><div class="sec"><div class="lab">Signal</div><div class="seg" id="signals"></div></div><div class="sec"><div class="lab">Language</div><div class="seg" id="langs"></div></div><div class="sec"><div class="lab">Data</div><div class="seg" id="modes"></div></div><div class="sec"><div class="lab">Tester tools</div><div class="seg" id="testers"></div></div></div>
<div class="panel" id="pnotes"></div>
<main><div class="cards" id="cards"></div></main>
<script>
const R=${js(o.root)},DEVS=${js(o.devices)},ENVS=${js(o.envs ?? [])},STATICD=${js(o.flows ?? null)},PKEY="flex-review:"+R+":";
const mem=(k,v)=>{try{if(v===undefined)return localStorage.getItem(PKEY+k);localStorage.setItem(PKEY+k,v)}catch{return null}};
const esc=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
// one device per category, as the flows' View has them (Android left out unless it's the only phone)
const CATS=[];for(const c of ["phone","tablet","land","laptop","window"]){const ks=DEVS.filter(d=>d.cat===c);const d=ks.find(d=>!/^android/.test(d.key))||ks[0];if(d)CATS.push(d)}
const NAME={phone:"Phone",tablet:"Tablet",land:"Tablet landscape",laptop:"Laptop",window:"Window"};
let cat=(mem("devices")||"").split(",")[0];if(!CATS.some(d=>d.cat===cat))cat=(CATS.find(d=>d.cat==="phone")||CATS[0]||{}).cat;
let theme=mem("theme")==="dark"?"dark":"light",lang=mem("lang")==="sw"?"sw":"en",mode=(ENVS.some(e=>e.key===mem("mode"))?mem("mode"):"static"),tester=mem("tester")==="1"?"1":"0",signal=mem("signal")==="0"?"0":"1",DATA=null,STR="";
function seg(el,items,on,pick){el.innerHTML="";for(const [v,l] of items){const b=document.createElement("button");b.textContent=l;b.setAttribute("aria-pressed",on(v));b.onclick=()=>{pick(v);controls();load()};el.appendChild(b)}}
function controls(){
  seg(document.getElementById("devs"),CATS.map(d=>[d.cat,NAME[d.cat]]),(v)=>v===cat,(v)=>{cat=v;mem("devices",v)});
  seg(document.getElementById("themes"),[["light","Light"],["dark","Dark"]],(v)=>v===theme,(v)=>{theme=v;mem("theme",v)});
  seg(document.getElementById("langs"),[["en","English"],["sw","Kiswahili"]],(v)=>v===lang,(v)=>{lang=v;mem("lang",v)});
  seg(document.getElementById("modes"),[["static","Static"],...ENVS.map(e=>[e.key,e.label])],(v)=>v===mode,(v)=>{mode=v;mem("mode",v)});
  if(!ENVS.length)document.querySelectorAll("#modes button").forEach(b=>{b.disabled=true;b.title="No environments in .flex/project.json"});
  seg(document.getElementById("signals"),[["1","On"],["0","Off"]],(v)=>v===signal,(v)=>{signal=v;mem("signal",v)});
  seg(document.getElementById("testers"),[["0","Off"],["1","On"]],(v)=>v===tester,(v)=>{tester=v;mem("tester",v)});
  const t=document.getElementById("stg");t.hidden=mode==="static";t.dataset.env=mode;t.textContent=(ENVS.find(e=>e.key===mode)||{label:""}).label}
const when=(a)=>{const d=new Date(a);return d.toDateString()===new Date().toDateString()?d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):d.toLocaleString([],{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})};
const q=()=>"?devices="+cat+"&theme="+theme;
function draw(){
  const fl=DATA.flows;
  document.getElementById("cards").innerHTML=fl.map(f=>'<a class="card" href="'+esc(f.href)+q()+'">'
    +(f.error?'<div class="err">'+esc(f.error)+"</div>":'<div class="cover">'+(f.cover?'<img src="'+esc(f.cover)+'" alt="">':'<div class="wait"></div>')+"</div>")
    +'<div class="meta"><b>'+esc(f.title)+(f.open?'<em title="Open notes">'+f.open+"</em>":"")+"</b><small>"+(f.screens!=null?f.screens+" screen"+(f.screens===1?"":"s"):"")+"</small><small>"
    +(f.static?"":f.lastRound?"Last round sent "+when(f.lastRound.sentAt):f.notes.length?"Nothing sent yet":"No notes yet")+"</small></div></a>").join("")||'<div class="none">No flows here.</div>';
  const all=fl.reduce((n,f)=>n+f.notes.length,0),nb=document.getElementById("notes");
  document.getElementById("ncount").textContent=all;nb.classList.toggle("due",fl.some(f=>f.unsent));
  document.getElementById("pnotes").innerHTML=fl.filter(f=>f.notes.length).map(f=>'<div class="sec nf"><h4>'+esc(f.title)+"</h4>"
    +f.notes.map(n=>'<a href="'+esc(f.href)+q()+"#note="+encodeURIComponent(n.id)+'"><i>'+n.n+"</i><span>"+esc(n.text.split("\\n")[0])+"<br><small>"+esc(n.label)+"</small></span></a>").join("")+"</div>").join("")||'<div class="sec none">No open notes.</div>'}
// a published copy: the flows and their covers as exported, nothing to ask a server
if(STATICD){document.body.classList.add("static");document.getElementById("notes").style.display="none";document.getElementById("modes").closest(".sec").style.display="none"}
async function load(){if(STATICD){const k=(CATS.find(d=>d.cat===cat)||{}).key||"";
    DATA={flows:STATICD.map(f=>({name:f.name,title:f.title,href:f.href,screens:f.screens["t"+tester],open:0,notes:[],lastRound:null,static:true,cover:f.covers[k]||null}))};draw();return}
  try{const r=await fetch(R+"/api/home?device="+((CATS.find(d=>d.cat===cat)||{}).key||"")+"&theme="+theme+"&lang="+lang+"&mode="+mode+"&tester="+tester+"&signal="+signal,{cache:"no-store"});if(!r.ok)return;const j=await r.json(),s=JSON.stringify(j);if(s===STR)return;STR=s;DATA=j;draw()}catch{}}
// the panels: under their buttons, closed by Esc, a click outside or the button again
const P={view:"pview",notes:"pnotes"};
function open(k){for(const [b,p] of Object.entries(P)){const on=b===k;document.getElementById(p).classList.toggle("open",on);document.getElementById(b).setAttribute("aria-expanded",on)}}
for(const b of Object.keys(P))document.getElementById(b).onclick=()=>open(document.getElementById(P[b]).classList.contains("open")?null:b);
addEventListener("keydown",(e)=>{if(e.key==="Escape")open(null)});
addEventListener("mousedown",(e)=>{if(!e.target.closest(".panel,.tb"))open(null)});
controls();load();if(!STATICD)setInterval(load,3000);
</script></body></html>`;
}
