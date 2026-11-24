// System screens on the review board: the OS's own UI that a step of a flow shows over the app (a permission prompt,
// the system contact picker), which the app can't render (on the board it runs as a web build). A flow's screen or
// state says which with "system" ("contacts", or { "show": "contacts" | "permission", "for": … }), screens.mts carries
// it into the index, and the board draws it here over the frame's screen, in CSS: above the app (live or snapshot),
// below the notes' pins, in the device's points, the platform's look by device family (iPhone/iPad: iOS; Android:
// Material 3; a laptop or window: nothing), the row's theme and the page's language. The project's "system" gives the
// app's name, the contacts listed and the permission's usage text (FLEXSYSTEM, from flex review).
// A new kind is one entry in SYSK (and its strings); an unknown one draws nothing and says so once in the console.
import { DEVICE_KEYS, deviceFor } from "./devices.mts";

/** each device key's family, screen and safe areas, for the overlays' layout */
const geometry = () => Object.fromEntries(DEVICE_KEYS.map((k) => { const d = deviceFor(k)!; return [k, { f: d.family, w: d.w, h: d.h, t: d.top, b: d.bottom }]; }));

export const SYSTEM_CSS = String.raw`
.sysov{position:absolute;overflow:hidden;pointer-events:auto;-webkit-font-smoothing:antialiased;text-align:left;line-height:1.2;cursor:default}
.sysov *{box-sizing:border-box}.sysov svg{display:block;flex:none}
.sysdim{position:absolute;inset:0}
/* iOS: SF where the viewer has it (a Mac), the system's sans elsewhere */
.sys-ios{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;--blue:#007aff;--ink:#000;--sub:rgba(60,60,67,.6);--sep:rgba(60,60,67,.29);--fill:rgba(118,118,128,.12);--sheet:#fff;--alert:rgba(242,242,242,.86);--hd:#fff}
.sys-ios.sysdk{--blue:#0a84ff;--ink:#fff;--sub:rgba(235,235,245,.6);--sep:rgba(84,84,88,.65);--fill:rgba(118,118,128,.24);--sheet:#1c1c1e;--alert:rgba(37,37,37,.86);--hd:#1c1c1e}
/* the page sheet: the app pushed back into a dimmed card on black, the sheet over it */
*:has(>.sysov.sys-card){background:#000!important}
*:has(>.sysov.sys-card)>:is(iframe,.nsnapw){transform:translateY(56px) scale(.92);transform-origin:50% 0;border-radius:12px;overflow:hidden}
*:has(>.sysov.sys-card)>:is(.iphone__status,.ipad__status){color:#fff}
.sys-card .sysdim{background:rgba(0,0,0,.42)}
.syssheet{position:absolute;left:0;right:0;bottom:0;background:var(--sheet);color:var(--ink);border-radius:12px 12px 0 0;display:flex;flex-direction:column;overflow:hidden}
.sys-form .syssheet{border-radius:13px;box-shadow:0 10px 40px rgba(0,0,0,.25)}
.sys-form .sysdim{background:rgba(0,0,0,.2)}
.sysnav{flex:none;height:56px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:6px 16px 0}
.sysnav b{font-size:17px;font-weight:600;letter-spacing:-.43px}.sysnav span{font-size:17px;color:var(--blue);letter-spacing:-.43px}
.syssearch{flex:none;margin:2px 16px 10px;height:36px;border-radius:10px;background:var(--fill);display:flex;align-items:center;gap:6px;padding:0 8px;color:var(--sub);font-size:17px;letter-spacing:-.43px}
.sys-ios .syslist{flex:1;overflow:hidden;padding-right:18px}
.sys-ios .syshd{height:28px;display:flex;align-items:flex-end;padding:0 16px 4px;font-size:15px;font-weight:600;color:var(--sub);background:var(--hd)}
.sys-ios .sysrow{position:relative;height:44px;display:flex;align-items:center;padding:0 16px;font-size:17px;letter-spacing:-.43px;white-space:nowrap}
.sys-ios .sysrow b{font-weight:600}
.sys-ios .sysrow+.sysrow::before{content:"";position:absolute;left:16px;right:-18px;top:0;height:.5px;background:var(--sep)}
.sysidx{position:absolute;right:2px;width:15px;display:flex;flex-direction:column;align-items:center;color:var(--blue);font-size:11px;font-weight:600;line-height:13.4px}
.syshome{position:absolute;left:50%;bottom:8px;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:var(--ink)}
/* the iOS alert */
.sys-alert .sysdim{background:rgba(0,0,0,.2)}
.sysalert{position:absolute;left:50%;top:50%;width:270px;transform:translate(-50%,-50%);border-radius:14px;background:var(--alert);-webkit-backdrop-filter:blur(30px) saturate(1.8);backdrop-filter:blur(30px) saturate(1.8);color:var(--ink);text-align:center;overflow:hidden}
.sysalert .sysat{padding:19px 16px 17px}
.sysalert h4{margin:0;font-size:17px;line-height:22px;font-weight:600;letter-spacing:-.43px}
.sysalert p{margin:3px 0 0;font-size:13px;line-height:18px;letter-spacing:-.08px}
.sysbtns{display:flex;border-top:.5px solid var(--sep)}.sysbtns span{flex:1;height:44px;display:flex;align-items:center;justify-content:center;color:var(--blue);font-size:17px;letter-spacing:-.43px;padding:0 6px}
.sysbtns span+span{border-left:.5px solid var(--sep)}.sysbtns span.sysb{font-weight:600}
.sysbtns.sysv{flex-direction:column}.sysbtns.sysv span{flex:none}.sysbtns.sysv span+span{border-left:0;border-top:.5px solid var(--sep)}
/* Android, Material 3 (baseline colours) */
.sys-and{font-family:Roboto,"Google Sans","Product Sans",system-ui,sans-serif;--surf:#fef7ff;--on:#1d1b20;--var:#49454f;--pri:#6750a4;--dlg:#ece6f0;--btn:#e8def8;--btnInk:#4a4458}
.sys-and.sysdk{--surf:#141218;--on:#e6e0e9;--var:#cac4d0;--pri:#d0bcff;--dlg:#2b2930;--btn:#4a4458;--btnInk:#e8def8}
*:has(>.sysov.sys-and.sys-full)>.android__status{color:#1d1b20}
*:has(>.sysov.sys-and.sys-full.sysdk)>.android__status{color:#e6e0e9}
*:has(>.sysov.sys-and.sys-full)>.android__nav{background:#1d1b20}*:has(>.sysov.sys-and.sys-full.sysdk)>.android__nav{background:#e6e0e9}
.sysapp{position:absolute;inset:0;background:var(--surf);color:var(--on);display:flex;flex-direction:column}
.systop{flex:none;height:64px;display:flex;align-items:center;gap:4px;padding:0 4px;color:var(--on)}
.systop i{width:48px;height:48px;display:flex;align-items:center;justify-content:center}
.systop span{flex:1;font-size:22px;line-height:28px;padding-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sys-and .syslist{flex:1;overflow:hidden}
.sys-and .syshd{height:40px;display:flex;align-items:center;padding:0 16px;font-size:14px;font-weight:500;letter-spacing:.1px;color:var(--pri)}
.sys-and .sysrow{height:56px;display:flex;align-items:center;gap:16px;padding:0 24px 0 16px;font-size:16px;letter-spacing:.5px;white-space:nowrap}
.sysav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;flex:none;background-size:cover;background-position:center}
/* the Android permission dialog */
.sys-perm .sysdim{background:rgba(0,0,0,.32)}
.sysdlg{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);max-width:360px;margin:0 auto;border-radius:28px;background:var(--dlg);color:var(--on);padding:24px 24px 18px;text-align:center}
.sysdlg svg{margin:0 auto 16px;color:var(--pri)}
.sysdlg h4{margin:0 0 20px;font-size:20px;line-height:26px;font-weight:400}.sysdlg h4 b{font-weight:600}
.sysloc{display:flex;justify-content:center;gap:28px;margin:-4px 0 20px;font-size:14px;color:var(--var)}.sysloc div{display:flex;flex-direction:column;align-items:center;gap:8px}
.sysloc i{width:84px;height:84px;border-radius:50%;background:var(--btn);display:flex;align-items:center;justify-content:center;color:var(--pri)}.sysloc .on i{box-shadow:0 0 0 3px var(--pri)}.sysloc .on{color:var(--on);font-weight:500}
.sysdbs{display:flex;flex-direction:column;gap:3px}.sysdbs span{height:48px;display:flex;align-items:center;justify-content:center;background:var(--btn);color:var(--btnInk);font-size:14px;font-weight:500;letter-spacing:.1px;border-radius:4px}
.sysdbs span:first-child{border-radius:20px 20px 4px 4px}.sysdbs span:last-child{border-radius:4px 4px 20px 20px}.sysdbs span:only-child{border-radius:20px}
`;

/** the board's side: SYS(row, frame html) is the frame with the row's system screen drawn in it (or as it was). Runs
 *  in the review page's script (entry, LANG); no backticks or template holes in it */
export function systemScript(): string {
  return "const SYSD=" + JSON.stringify(geometry()) + ";\n" + String.raw`
const SYSC=typeof FLEXSYSTEM!=="undefined"&&FLEXSYSTEM||{};
/* the contacts a project lists none of: plausible, generic */
const SYSPEOPLE=[["Amina Juma","+255712000101"],["Baraka Mushi","+255713000102"],["Daniel Okello","+256772000103"],["Esther Wanjiru","+254722000104"],["Fatuma Said","+255714000105"],["Grace Kimaro","+255715000106"],["Hassan Mwinyi","+255716000107"],["Joseph Mrema","+255717000108"],["Lucy Achieng","+254723000109"],["Peter Njoroge","+254724000110"],["Rehema Ally","+255718000111"],["Samuel Otieno","+254725000112"]].map(([name,p])=>({name,phones:[p],photo:null}));
/* the OS's own words, en and sw (a language without them: en) */
const SYST={en:{cancel:"Cancel",contacts:"Contacts",search:"Search",no:"Don’t Allow",yes:"Allow",
    ios:{contacts:"“{app}” Would Like to Access Your Contacts",photos:"“{app}” Would Like to Access Your Photos",camera:"“{app}” Would Like to Access the Camera",location:"Allow “{app}” to use your location?",notifications:"“{app}” Would Like to Send You Notifications"},
    notif:"Notifications may include alerts, sounds and icon badges. These can be configured in Settings.",
    iosLoc:["Allow Once","Allow While Using App","Don’t Allow"],iosPhotos:["Limit Access…","Allow Full Access","Don’t Allow"],
    choose:"Choose a contact",
    and:{contacts:"Allow {app} to access your contacts?",photos:"Allow {app} to access photos and videos on this device?",camera:"Allow {app} to take pictures and record video?",location:"Allow {app} to access this device’s location?",notifications:"Allow {app} to send you notifications?"},
    andB:{contacts:["Allow","Don’t allow"],photos:["Allow all","Select photos and videos","Don’t allow"],camera:["While using the app","Only this time","Don’t allow"],location:["While using the app","Only this time","Don’t allow"],notifications:["Allow","Don’t allow"]},
    precise:"Precise",approx:"Approximate"},
  sw:{cancel:"Ghairi",contacts:"Anwani",search:"Tafuta",no:"Usiruhusu",yes:"Ruhusu",
    ios:{contacts:"“{app}” Ingependa Kufikia Anwani Zako",photos:"“{app}” Ingependa Kufikia Picha Zako",camera:"“{app}” Ingependa Kufikia Kamera",location:"Ungependa kuruhusu “{app}” itumie mahali ulipo?",notifications:"“{app}” Ingependa Kukutumia Arifa"},
    notif:"Arifa zinaweza kujumuisha arifa, sauti na beji za aikoni. Unaweza kuzibadilisha katika Mipangilio.",
    iosLoc:["Ruhusu Mara Moja","Ruhusu Unapotumia Programu","Usiruhusu"],iosPhotos:["Ruhusu Baadhi…","Ruhusu Zote","Usiruhusu"],
    choose:"Chagua anwani",
    and:{contacts:"Ungependa kuruhusu {app} ifikie anwani zako?",photos:"Ungependa kuruhusu {app} ifikie picha na video kwenye kifaa hiki?",camera:"Ungependa kuruhusu {app} ipige picha na kurekodi video?",location:"Ungependa kuruhusu {app} ifikie mahali kifaa hiki kilipo?",notifications:"Ungependa kuruhusu {app} ikutumie arifa?"},
    andB:{contacts:["Ruhusu","Usiruhusu"],photos:["Ruhusu zote","Chagua picha na video","Usiruhusu"],camera:["Unapotumia programu","Mara hii pekee","Usiruhusu"],location:["Unapotumia programu","Mara hii pekee","Usiruhusu"],notifications:["Ruhusu","Usiruhusu"]},
    precise:"Mahali halisi",approx:"Takriban"}};
const SYSWARN=new Set();
const sysx=(s)=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const sysLang=()=>{try{return typeof LANG!=="undefined"&&SYST[LANG]?LANG:"en"}catch{return "en"}};
const sysApp=()=>SYSC.appName||"App";
/* the frame's system screen: the row's screen's, or its state's (a state doesn't inherit its screen's); "contacts" is
   { show: "contacts" } */
function sysOf(r){const i=r.screen.indexOf("@"),e=entry(i<0?r.screen:r.screen.slice(0,i));
  let v=i<0?e.system:((e.states0||e.states||[]).find(x=>x.name===r.screen.slice(i+1))||{}).system;
  if(typeof v==="string")v={show:v};return v&&typeof v==="object"&&typeof v.show==="string"?v:null}
function syswarn(m){if(SYSWARN.has(m))return;SYSWARN.add(m);console.warn("flex review: "+m)}
/* the contacts as the project lists them, sorted and sectioned: iOS by family name (its default), Android by given name */
function syscontacts(byLast){const all=(Array.isArray(SYSC.contacts)&&SYSC.contacts.length?SYSC.contacts:SYSPEOPLE).filter(c=>c&&c.name).map(c=>{const p=String(c.name).trim().split(/\s+/),last=p.length>1?p[p.length-1]:p[0];
    return {c,first:p.length>1?p.slice(0,-1).join(" "):"",last,key:(byLast?last+" "+p.join(" "):p.join(" ")).toLocaleUpperCase()}});
  all.sort((a,b)=>a.key.localeCompare(b.key));const out=[];
  for(const x of all){const ch=x.key.normalize("NFD")[0],l=/[A-Z]/.test(ch)?ch:"#",g=out[out.length-1];if(g&&g.l===l)g.xs.push(x);else out.push({l,xs:[x]})}return out}
const SYSAV=[["#f6d6e8","#6d214f"],["#d6e3ff","#0b3d91"],["#c8f0d8","#0d5c32"],["#ffe0b2","#7a3e00"],["#e4d7ff","#4a2a8a"],["#cfeff3","#0b5560"],["#ffd8d2","#8a1f12"]];
const SVG=(w,d,fill)=>'<svg width="'+w+'" height="'+w+'" viewBox="0 0 24 24" '+(fill?'fill="currentColor"':'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"')+'>'+d+"</svg>";
/* the permission's usage text (the app's Info.plist string, iOS shows it under the title): the project's, per language */
function sysUsage(kind){const p=(SYSC.permissions||{})[kind];if(!p)return "";if(typeof p==="string")return p;return p[sysLang()]||p.en||""}
/* the kinds: each draws the overlay's inside for one platform ("ios" | "and"), and names its classes */
const SYSK={
  contacts:(os,v,d)=>{const T=SYST[sysLang()];
    if(os==="ios"){const secs=syscontacts(true),tab=d.f==="ipad",top=tab?Math.max(40,(d.h-Math.min(620,d.h-80))/2):d.t+10,h=tab?Math.min(620,d.h-80):d.h-top,w=tab?Math.min(540,d.w-40):d.w;
      const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split(""),list=secs.map(s=>'<div class="syshd">'+s.l+"</div>"+s.xs.map(x=>'<div class="sysrow">'+"<span>"+(x.first?sysx(x.first)+" <b>"+sysx(x.last)+"</b>":"<b>"+sysx(x.last)+"</b>")+"</span>"+"</div>").join("")).join("");
      return {cls:tab?"sys-form":"sys-card",html:'<div class="sysdim"></div><div class="syssheet" style="top:'+top+"px;"+(tab?"left:"+(d.w-w)/2+"px;right:auto;bottom:auto;width:"+w+"px;height:"+h+"px":"")+'">'
        +'<div class="sysnav"><span>'+T.cancel+"</span><b>"+T.contacts+'</b><span></span></div><div class="syssearch">'+SVG(17,'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>')+T.search+"</div>"
        +'<div class="syslist">'+list+'</div><div class="sysidx" style="top:'+(110+(h-110-(tab?0:d.b)-letters.length*13.4)/2)+'px">'+letters.map(l=>"<span>"+l+"</span>").join("")+"</div>"+(tab?"":'<div class="syshome"></div>')+"</div>"}}
    const secs=syscontacts(false);let n=0;
    const list=secs.map(s=>'<div class="syshd">'+s.l+"</div>"+s.xs.map(x=>{const c=SYSAV[n++%SYSAV.length],ph=typeof x.c.photo==="string"&&x.c.photo,i=(x.first||x.last)[0].toLocaleUpperCase();
      return '<div class="sysrow"><span class="sysav" style="'+(ph?"background-image:url(&quot;"+sysx(ph)+"&quot;)":"background:"+(d.dk?c[1]:c[0])+";color:"+(d.dk?c[0]:c[1]))+'">'+(ph?"":sysx(i))+"</span>"+sysx(x.c.name)+"</div>"}).join("")).join("");
    return {cls:"sys-full",html:'<div class="sysapp" style="padding-top:'+d.t+"px;padding-bottom:"+d.b+'px"><div class="systop"><i>'+SVG(24,'<path d="M19 12H5M11 18l-6-6 6-6"/>')+"</i><span>"+T.choose+"</span><i>"+SVG(24,'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>')+'</i></div><div class="syslist">'+list+"</div></div>"}},
  permission:(os,v,d)=>{const T=SYST[sysLang()],k=v.for,app=sysx(sysApp());
    if(!T.ios[k]){syswarn('a "permission" system screen for "'+k+'": not one Flex draws (contacts, photos, camera, location, notifications)');return null}
    if(os==="ios"){const u=k==="notifications"?T.notif:sysUsage(k),bs=k==="location"?T.iosLoc:k==="photos"?T.iosPhotos:[T.no,T.yes],stack=bs.length>2;
      return {cls:"sys-alert",html:'<div class="sysdim"></div><div class="sysalert"><div class="sysat"><h4>'+sysx(T.ios[k]).replace("{app}",app)+"</h4>"+(u?"<p>"+sysx(u)+"</p>":"")+'</div><div class="sysbtns'+(stack?" sysv":"")+'">'+bs.map((b,i)=>'<span class="'+(!stack&&i===1?"sysb":"")+'">'+sysx(b)+"</span>").join("")+"</div></div>"}}
    const IC={contacts:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>',photos:'<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 18l4-5 3 3.5 2-2.5 3 4z"/><circle cx="15.5" cy="8.5" r="1.8"/>',
      camera:'<path d="M4 7h3.5L9 5h6l1.5 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6" style="fill:var(--dlg)"/>',location:'<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',notifications:'<path d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22zm7-6V11c0-3.3-2.1-6-5.2-6.8V3.5a1.8 1.8 0 0 0-3.6 0v.7C7.1 5 5 7.7 5 11v5l-2 2v1h18v-1z"/>'};
    const loc=k==="location"?'<div class="sysloc"><div class="on"><i>'+SVG(40,'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')+"</i>"+T.precise+"</div><div><i>"+SVG(40,'<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>')+"</i>"+T.approx+"</div></div>":"";
    return {cls:"sys-perm",html:'<div class="sysdim"></div><div class="sysdlg">'+SVG(24,IC[k],true)+"<h4>"+sysx(T.and[k]).replace("{app}","<b>"+app+"</b>")+"</h4>"+loc+'<div class="sysdbs">'+T.andB[k].map(b=>"<span>"+sysx(b)+"</span>").join("")+"</div></div>"}}};
/* the frame with its system screen drawn over the app's box (the iframe, or the snapshot that stands for it): the same
   box, so it sits in the screen with the device frame on or off; below the notes' pins (z-index 20), above a live
   frame's loading snapshot */
function SYS(r,html){const v=html&&sysOf(r);if(!v)return html;const d=SYSD[r.key],os=d&&(d.f==="iphone"||d.f==="ipad"?"ios":d.f==="android"?"and":null);
  if(!os)return html;
  const k=SYSK[v.show];if(!k){syswarn('a system screen "'+v.show+'": not one Flex draws ('+Object.keys(SYSK).join(", ")+")");return html}
  const o=k(os,v,Object.assign({dk:r.theme==="dark"},d));if(!o)return html;
  const m=/<iframe [^>]*style="([^"]*)"/.exec(html),st=m&&m[1].includes("position:absolute")?m[1].replace(/background:[^;]*;?/,""):"position:absolute;left:0;top:0;width:100%;height:100%";
  return html.replace("</iframe>",()=>'</iframe><div class="sysov sys-'+os+" sys-"+v.show+" "+o.cls+(r.theme==="dark"?" sysdk":"")+'" data-system="'+sysx(v.show)+'" style="'+st+";z-index:2;"+(o.style||"")+'">'+o.html+"</div>")}
`;
}
