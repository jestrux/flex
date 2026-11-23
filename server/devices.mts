// The devices Flex frames screens in (flex mockup) and freezes pages at (flex screens): each one's screen in points, the
// safe areas its bars take (status bar, home indicator, Android's gesture bar, a laptop's taskbar), its pixel density,
// its figure class in server/devices/*.css, its finishes and plain styles. One table, so a freeze and its mockup agree.
export type Family = "iphone" | "ipad" | "mac" | "android" | "pc" | "win" | "macwin" | "plainwin";
export type Dev = { key: string; family: Family; cls: string; w: number; h: number; top: number; bottom: number; scale: number; label: string; touch: boolean };
export const DEVICES: Record<string, Omit<Dev, "key">> = {
  "iphone":         { family: "iphone",   cls: "iphone--pro",     w: 402,  h: 874,  top: 62, bottom: 34, scale: 3, touch: true,  label: "iPhone 17 Pro" },
  "iphone-max":     { family: "iphone",   cls: "iphone--pro-max", w: 440,  h: 956,  top: 62, bottom: 34, scale: 3, touch: true,  label: "iPhone 17 Pro Max" },
  "ipad":           { family: "ipad",     cls: "ipad--13",        w: 1032, h: 1376, top: 24, bottom: 20, scale: 2, touch: true,  label: "iPad Pro 13″" },
  "ipad-11":        { family: "ipad",     cls: "ipad--11",        w: 834,  h: 1210, top: 24, bottom: 20, scale: 2, touch: true,  label: "iPad Pro 11″" },
  "ipad-mini":      { family: "ipad",     cls: "ipad--mini",      w: 744,  h: 1133, top: 24, bottom: 20, scale: 2, touch: true,  label: "iPad mini" },
  "android":        { family: "android",  cls: "",                w: 412,  h: 915,  top: 28, bottom: 24, scale: 3, touch: true,  label: "Android phone" },
  "android-tablet": { family: "android",  cls: "android--tablet", w: 800,  h: 1280, top: 28, bottom: 24, scale: 2, touch: true,  label: "Android tablet" },
  "mac":            { family: "mac",      cls: "mac--14",         w: 1512, h: 982,  top: 37, bottom: 0,  scale: 2, touch: false, label: "MacBook Pro 14″" },
  "mac-16":         { family: "mac",      cls: "mac--16",         w: 1728, h: 1117, top: 37, bottom: 0,  scale: 2, touch: false, label: "MacBook Pro 16″" },
  "display":        { family: "mac",      cls: "mac--display",    w: 2560, h: 1440, top: 24, bottom: 0,  scale: 2, touch: false, label: "Studio Display" },
  "pc":             { family: "pc",       cls: "",                w: 1280, h: 800,  top: 0,  bottom: 48, scale: 2, touch: false, label: "Windows laptop" },
  "pc-16":          { family: "pc",       cls: "pc--16",          w: 1536, h: 960,  top: 0,  bottom: 48, scale: 2, touch: false, label: "Windows laptop 16″" },
  // app windows: the size is the window's content; the chrome (title bar) sits above it, outside the page
  "windows":        { family: "win",      cls: "",                w: 1280, h: 800,  top: 0,  bottom: 0,  scale: 2, touch: false, label: "Windows app window" },
  "mac-window":     { family: "macwin",   cls: "",                w: 1280, h: 800,  top: 0,  bottom: 0,  scale: 2, touch: false, label: "Mac app window" },
  "window":         { family: "plainwin", cls: "",                w: 1280, h: 800,  top: 0,  bottom: 0,  scale: 2, touch: false, label: "Plain window" },
};
/* a family's finishes, the first being its default; a window's "finish" is its chrome, light or dark (auto: the theme) */
export const FINISHES: Record<Family, string[]> = {
  iphone: ["black", "silver", "natural", "blue", "orange", "kinpay"], ipad: ["gray", "silver"], mac: ["black", "silver"],
  android: ["graphite", "porcelain", "sage"], pc: ["graphite", "silver"], win: ["auto", "light", "dark"], macwin: ["auto", "light", "dark"], plainwin: ["plain"],
};
/* plain frames: bare (just the screen, square, no device) and outline (a flat stroke) where the family has them */
export const STYLES: Record<Family, string[]> = { iphone: ["frame", "bare", "outline"], ipad: ["frame", "bare"], mac: ["frame", "bare"], android: ["frame"], pc: ["frame"], win: ["frame"], macwin: ["frame"], plainwin: ["frame"] };

/** the families that turn on their side: tablets */
const turns = (key: string, d: Omit<Dev, "key">) => d.family === "ipad" || key === "android-tablet";

/** A device by its key. A tablet's key with "-landscape" (ipad-11-landscape) is that tablet on its side: its screen
 *  turned, its frame's landscape class. `turn` does the same for a plain key (flex mockup's --landscape). */
export function deviceFor(key: string, turn = false): Dev | null {
  const land = key.endsWith("-landscape"), base = land ? key.slice(0, -"-landscape".length) : key;
  const d = DEVICES[base];
  if (!d || (land && !turns(base, d))) return null;
  const rotate = (land || turn) && turns(base, d);
  return { key: base + (rotate ? "-landscape" : ""), ...d, label: d.label + (rotate ? " landscape" : ""), w: rotate ? d.h : d.w, h: rotate ? d.w : d.h, cls: d.cls + (rotate ? ` ${d.family}--landscape` : "") };
}

/** every key deviceFor knows, landscape tablets included (for error messages) */
export const DEVICE_KEYS = [...Object.keys(DEVICES), ...Object.keys(DEVICES).filter((k) => turns(k, DEVICES[k])).map((k) => `${k}-landscape`)];
