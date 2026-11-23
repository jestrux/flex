// The screen canvas runs each page in a device frame, an iframe that reports no safe areas and the viewer's own colour
// scheme. Its link says what the device has: scheme=light|dark and insets=<top>,<bottom> (touch devices only).
const q = new URLSearchParams(location.search), r = document.documentElement;
if (/^(light|dark)$/.test(q.get("scheme") || "")) r.dataset.scheme = q.get("scheme");
const m = (q.get("insets") || "").match(/^(\d+),(\d+)$/);
if (m) { r.style.setProperty("--safe-top", m[1] + "px"); r.style.setProperty("--safe-bottom", m[2] + "px"); }
