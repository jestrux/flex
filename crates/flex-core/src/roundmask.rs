//! The pipeline's rounded-corner and opacity masks, to the pixel: the `<rect rx>` SVG it lays on an image with
//! `dest-in` is drawn by librsvg 2.61 (the rect's corners as elliptical arcs, each cut into Bézier segments) and
//! filled by cairo 1.18 (curves flattened in 24.8 fixed point to a 0.1 px tolerance, then its "tor" scan converter:
//! 15 sub-rows a pixel, 1/256 px across, whole rows done analytically when no edge starts or ends in them), the colour
//! `fill-opacity` laid on in 8 bits; libvips then applies it with its float `dest-in`. Ported as written, so the
//! painter's corners match the render's; resvg/tiny-skia antialias the same shape a little differently.

use std::f64::consts::PI;

/// The alpha (0–255) of the pipeline's mask `<rect width=w height=h rx=radius fill-opacity=opacity>`, row by row.
pub(crate) fn round_rect(w: u32, h: u32, radius: f64, opacity: f32) -> Vec<u8> {
    let edges = flatten(&rect_path(w as f64, h as f64, radius), 0.1);
    let mut cov = tor(&edges, w as i64, h as i64, 0, 0, w as i64, h as i64);
    // cairo's colour: the alpha as a 16-bit short, 8 bits of it, multiplied into the coverage (pixman's MUL_UN8)
    let a8 = ((opacity as f64 * 65535. + 0.5) as u32) >> 8;
    if a8 < 255 { for c in cov.iter_mut() { let t = a8 * *c as u32 + 128; *c = ((t + (t >> 8)) >> 8) as u8; } }
    cov
}

const GRID_X: i64 = 256;
const GRID_Y: i64 = 15;
const INPUT_BITS: i64 = 8;

type Pt = (i32, i32); // 24.8 fixed

fn fixed(d: f64) -> i32 { (d * 256.).round_ties_even() as i32 }

// ---- librsvg: the rect as path segments (move, line, cubic, close) in doubles
enum Seg { Move(f64, f64), Line(f64, f64), Curve([f64; 6]), Close }

fn arc(segs: &mut Vec<Seg>, from: (f64, f64), r: (f64, f64), to: (f64, f64)) {
    // center_parameterization, x_axis_rotation 0, large_arc false, sweep positive
    let (mut rx, mut ry) = r;
    let (x1, y1) = from; let (x2, y2) = to;
    if rx * rx < f64::EPSILON || ry * ry < f64::EPSILON { segs.push(Seg::Line(x2, y2)); return; }
    let (sin_phi, cos_phi) = 0f64.sin_cos();
    rx = rx.abs(); ry = ry.abs();
    let mid_x = (x1 - x2) / 2.0; let mid_y = (y1 - y2) / 2.0;
    let x1_ = cos_phi * mid_x + sin_phi * mid_y;
    let y1_ = -sin_phi * mid_x + cos_phi * mid_y;
    let lambda = (x1_ / rx).powi(2) + (y1_ / ry).powi(2);
    if lambda > 1.0 { rx *= lambda.sqrt(); ry *= lambda.sqrt(); }
    let d = (rx * y1_).powi(2) + (ry * x1_).powi(2);
    if d == 0.0 { return; }
    let k = { let k = ((rx * ry).powi(2) / d - 1.0).abs().sqrt(); /* positive sweep != large arc */ k };
    let cx_ = k * rx * y1_ / ry; let cy_ = -k * ry * x1_ / rx;
    let cx = cos_phi * cx_ - sin_phi * cy_ + (x1 + x2) / 2.0;
    let cy = sin_phi * cx_ + cos_phi * cy_ + (y1 + y2) / 2.0;
    let ux = (x1_ - cx_) / rx; let uy = (y1_ - cy_) / ry;
    let u_len = (ux * ux + uy * uy).abs().sqrt();
    if u_len == 0.0 { return; }
    let cos_theta1 = (ux / u_len).clamp(-1.0, 1.0);
    let theta1 = { let mut t = cos_theta1.acos(); if uy < 0.0 { t = -t; } t };
    let vx = (-x1_ - cx_) / rx; let vy = (-y1_ - cy_) / ry;
    let v_len = (vx * vx + vy * vy).abs().sqrt();
    if v_len == 0.0 { return; }
    let dp_uv = ux * vx + uy * vy;
    let cos_dt = (dp_uv / (u_len * v_len)).clamp(-1.0, 1.0);
    let delta_theta = { let mut dt = cos_dt.acos(); if ux * vy - uy * vx < 0.0 { dt = -dt; } if dt < 0.0 { dt += PI * 2.0; } dt };
    let n_segs = (delta_theta / (PI * 0.5 + 0.001)).abs().ceil() as u32;
    let d_theta = delta_theta / f64::from(n_segs);
    let mut theta = theta1;
    for _ in 0..n_segs {
        let (th0, th1) = (theta, theta + d_theta);
        let (sin_th0, cos_th0) = th0.sin_cos(); let (sin_th1, cos_th1) = th1.sin_cos();
        let th_half = 0.5 * (th1 - th0);
        let t = (8.0 / 3.0) * (th_half * 0.5).sin().powi(2) / th_half.sin();
        let x1 = rx * (cos_th0 - t * sin_th0); let y1 = ry * (sin_th0 + t * cos_th0);
        let x3 = rx * cos_th1; let y3 = ry * sin_th1;
        let x2 = x3 + rx * (t * sin_th1); let y2 = y3 + ry * (-t * cos_th1);
        segs.push(Seg::Curve([cx + cos_phi * x1 - sin_phi * y1, cy + sin_phi * x1 + cos_phi * y1,
            cx + cos_phi * x2 - sin_phi * y2, cy + sin_phi * x2 + cos_phi * y2,
            cx + cos_phi * x3 - sin_phi * y3, cy + sin_phi * x3 + cos_phi * y3]));
        theta += d_theta;
    }
}

fn rect_path(w: f64, h: f64, r: f64) -> Vec<Seg> {
    let (x, y) = (0., 0.);
    let (mut rx, mut ry) = (r, r);
    if rx > w / 2. { rx = w / 2.; }
    if ry > h / 2. { ry = h / 2.; }
    if rx == 0. { ry = 0.; } else if ry == 0. { rx = 0.; }
    let mut s = vec![];
    if rx == 0. {
        s.push(Seg::Move(x, y)); s.push(Seg::Line(x + w, y)); s.push(Seg::Line(x + w, y + h)); s.push(Seg::Line(x, y + h)); s.push(Seg::Line(x, y));
    } else {
        let (tx1, tx2, ty, by) = (x + rx, x + w - rx, y, y + h);
        let (lx, ly1, ly2, rgx) = (x, y + ry, y + h - ry, x + w);
        s.push(Seg::Move(tx1, ty)); s.push(Seg::Line(tx2, ty));
        arc(&mut s, (tx2, ty), (rx, ry), (rgx, ly1));
        s.push(Seg::Line(rgx, ly2));
        arc(&mut s, (rgx, ly2), (rx, ry), (tx2, by));
        s.push(Seg::Line(tx1, by));
        arc(&mut s, (tx1, by), (rx, ry), (lx, ly2));
        s.push(Seg::Line(lx, ly1));
        arc(&mut s, (lx, ly1), (rx, ry), (tx1, ty));
    }
    s.push(Seg::Close);
    s
}

// ---- cairo: flatten to edges (p1, p2 with p1.y < p2.y, dir)
struct Edge { p1: Pt, p2: Pt, dir: i32 }

fn add_edge(edges: &mut Vec<Edge>, a: Pt, b: Pt) {
    if a.1 == b.1 { return; }
    if a.1 > b.1 { edges.push(Edge { p1: b, p2: a, dir: -1 }); } else { edges.push(Edge { p1: a, p2: b, dir: 1 }); }
}

fn spline_err2(k: &[Pt; 4]) -> f64 {
    let f = |v: i32| v as f64 / 256.;
    let (mut bdx, mut bdy) = (f(k[1].0 - k[0].0), f(k[1].1 - k[0].1));
    let (mut cdx, mut cdy) = (f(k[2].0 - k[0].0), f(k[2].1 - k[0].1));
    if k[0] != k[3] {
        let (dx, dy) = (f(k[3].0 - k[0].0), f(k[3].1 - k[0].1));
        let v = dx * dx + dy * dy;
        let u = bdx * dx + bdy * dy;
        if u <= 0. {} else if u >= v { bdx -= dx; bdy -= dy; } else { bdx -= u / v * dx; bdy -= u / v * dy; }
        let u = cdx * dx + cdy * dy;
        if u <= 0. {} else if u >= v { cdx -= dx; cdy -= dy; } else { cdx -= u / v * dx; cdy -= u / v * dy; }
    }
    let (be, ce) = (bdx * bdx + bdy * bdy, cdx * cdx + cdy * cdy);
    if be > ce { be } else { ce }
}
fn half(a: Pt, b: Pt) -> Pt { (a.0 + ((b.0 - a.0) >> 1), a.1 + ((b.1 - a.1) >> 1)) }
fn decompose(s1: &mut [Pt; 4], tol2: f64, out: &mut Vec<Pt>, last: &mut Pt) {
    if spline_err2(s1) < tol2 {
        if *last != s1[0] { *last = s1[0]; out.push(s1[0]); }
        return;
    }
    let (ab, bc, cd) = (half(s1[0], s1[1]), half(s1[1], s1[2]), half(s1[2], s1[3]));
    let (abbc, bccd) = (half(ab, bc), half(bc, cd));
    let fin = half(abbc, bccd);
    let mut s2 = [fin, bccd, cd, s1[3]];
    s1[1] = ab; s1[2] = abbc; s1[3] = fin;
    decompose(s1, tol2, out, last);
    decompose(&mut s2, tol2, out, last);
}

fn flatten(segs: &[Seg], tol: f64) -> Vec<Edge> {
    let mut e = vec![];
    let (mut cur, mut mv): (Pt, Pt) = ((0, 0), (0, 0));
    let mut have = false;
    for s in segs {
        match *s {
            Seg::Move(x, y) => { if have { add_edge(&mut e, cur, mv); } cur = (fixed(x), fixed(y)); mv = cur; have = true; }
            Seg::Line(x, y) => { let p = (fixed(x), fixed(y)); add_edge(&mut e, cur, p); cur = p; }
            Seg::Curve(c) => {
                let (b, cc, d) = ((fixed(c[0]), fixed(c[1])), (fixed(c[2]), fixed(c[3])), (fixed(c[4]), fixed(c[5])));
                let a = cur;
                if (a == b && cc == d) || (a == b && a == cc && a == d) || (cc == d && b == d) { add_edge(&mut e, cur, d); cur = d; continue; }
                let mut k = [a, b, cc, d];
                let mut pts = vec![];
                let mut last = a;
                decompose(&mut k, tol * tol, &mut pts, &mut last);
                pts.push(d);
                for p in pts { add_edge(&mut e, cur, p); cur = p; }
            }
            Seg::Close => { add_edge(&mut e, cur, mv); cur = mv; }
        }
    }
    e
}

// ---- tor
#[derive(Clone, Copy, Default)]
struct QR { quo: i64, rem: i64 }
#[derive(Clone)]
struct TEdge { ytop: i64, height_left: i64, dir: i32, cell: i64, x: QR, dxdy: QR, dxdy_full: QR, dy: i64 }

const HEAD_CELL: i64 = i32::MIN as i64; const TAIL_CELL: i64 = i32::MAX as i64;

fn input_to_grid_y(v: i32) -> i64 { let t = GRID_Y * v as i64 + (1 << (INPUT_BITS - 1)); t >> INPUT_BITS }

fn fix(q: &mut QR, dy: i64) { if q.rem < 0 { q.quo -= 1; q.rem += dy; } else if q.rem >= dy { q.quo += 1; q.rem -= dy; } }

fn make_edge(e: &Edge, ymin: i64, ymax: i64) -> Option<TEdge> {
    let mut ytop = input_to_grid_y(e.p1.1); if ytop < ymin { ytop = ymin; }
    let mut ybot = input_to_grid_y(e.p2.1); if ybot > ymax { ybot = ymax; }
    if ybot <= ytop { return None; }
    let (p1, p2) = (e.p1, e.p2);
    let mut t = TEdge { ytop, height_left: ybot - ytop, dir: e.dir, cell: 0, x: QR::default(), dxdy: QR::default(), dxdy_full: QR::default(), dy: 0 };
    if p2.0 == p1.0 {
        t.cell = p1.0 as i64; t.x = QR { quo: p1.0 as i64, rem: 0 };
    } else {
        let ex = (p2.0 - p1.0) as i64 * GRID_X;
        let ey = (p2.1 - p1.1) as i64 * GRID_Y * (2 << INPUT_BITS);
        t.dxdy = QR { quo: ex * (2 << INPUT_BITS) / ey, rem: ex * (2 << INPUT_BITS) % ey };
        let mut tmp = (2 * ytop + 1) << INPUT_BITS;
        tmp -= p1.1 as i64 * GRID_Y * 2;
        tmp *= ex;
        t.x = QR { quo: tmp / ey, rem: tmp % ey };
        t.x.quo += p1.0 as i64;
        fix(&mut t.x, ey);
        if t.height_left >= GRID_Y { let tmp = ex * (2 * GRID_Y << INPUT_BITS); t.dxdy_full = QR { quo: tmp / ey, rem: tmp % ey }; }
        t.cell = t.x.quo + (t.x.rem >= ey / 2) as i64;
        t.dy = ey;
    }
    Some(t)
}

fn step(e: &mut TEdge) {
    if e.dy == 0 { return; }
    e.x.quo += e.dxdy.quo; e.x.rem += e.dxdy.rem; fix(&mut e.x, e.dy);
    e.cell = e.x.quo + (e.x.rem >= e.dy / 2) as i64;
}
fn full_step(e: &mut TEdge) {
    if e.dy == 0 { return; }
    e.x.quo += e.dxdy_full.quo; e.x.rem += e.dxdy_full.rem; fix(&mut e.x, e.dy);
    e.cell = e.x.quo + (e.x.rem >= e.dy / 2) as i64;
}

#[derive(Default, Clone, Copy)]
struct Cell { ua: i16, ch: i16 }
struct Cells(std::collections::BTreeMap<i64, Cell>);
impl Cells {
    fn at(&mut self, x: i64) -> &mut Cell { self.0.entry(x).or_default() }
    fn add_subspan(&mut self, x1: i64, x2: i64) {
        if x1 == x2 { return; }
        let (ix1, fx1, ix2, fx2) = (x1 >> 8, x1 & 255, x2 >> 8, x2 & 255);
        if ix1 != ix2 {
            let c = self.at(ix1); c.ua = c.ua.wrapping_add((2 * fx1) as i16); c.ch = c.ch.wrapping_add(1);
            let c = self.at(ix2); c.ua = c.ua.wrapping_sub((2 * fx2) as i16); c.ch = c.ch.wrapping_sub(1);
        } else { let c = self.at(ix1); c.ua = c.ua.wrapping_add((2 * (fx1 - fx2)) as i16); }
    }
    fn render_edge(&mut self, e: &mut TEdge, sign: i64) {
        let mut x1 = e.x; full_step(e); let mut x2 = e.x;
        if e.dy != 0 {
            x1.quo -= e.dxdy.quo / 2; x1.rem -= e.dxdy.rem / 2; fix(&mut x1, e.dy);
            x2.quo -= e.dxdy.quo / 2; x2.rem -= e.dxdy.rem / 2; fix(&mut x2, e.dy);
        }
        let (mut ix1, mut fx1, mut ix2, mut fx2) = (x1.quo >> 8, x1.quo & 255, x2.quo >> 8, x2.quo & 255);
        let add = |c: &mut Cell, ua: i64, ch: i64| { c.ua = c.ua.wrapping_add(ua as i16); c.ch = c.ch.wrapping_add(ch as i16); };
        if ix1 == ix2 { add(self.at(ix1), sign * (fx1 + fx2) * GRID_Y, sign * GRID_Y); return; }
        if ix2 < ix1 { std::mem::swap(&mut ix1, &mut ix2); std::mem::swap(&mut fx1, &mut fx2); std::mem::swap(&mut x1, &mut x2); }
        let dx = (x2.quo - x1.quo) * e.dy + (x2.rem - x1.rem);
        let mut tmp = (ix1 + 1) * GRID_X * e.dy;
        tmp -= x1.quo * e.dy + x1.rem;
        tmp *= GRID_Y;
        let mut y = QR { quo: tmp / dx, rem: tmp % dx };
        add(self.at(ix1), sign * y.quo * (GRID_X + fx1), sign * y.quo);
        let mut y_last = y.quo;
        if ix1 + 1 < ix2 {
            let full = QR { quo: GRID_Y * GRID_X * e.dy / dx, rem: GRID_Y * GRID_X * e.dy % dx };
            ix1 += 1;
            loop {
                y.quo += full.quo; y.rem += full.rem;
                if y.rem >= dx { y.quo += 1; y.rem -= dx; }
                add(self.at(ix1), sign * (y.quo - y_last) * GRID_X, sign * (y.quo - y_last));
                y_last = y.quo;
                ix1 += 1;
                if ix1 == ix2 { break; }
            }
        }
        add(self.at(ix2), sign * (GRID_Y - y_last) * fx2, sign * (GRID_Y - y_last));
    }
}

/// coverage 0–255 per pixel of a w × h surface
fn tor(edges: &[Edge], w: i64, h: i64, xmin_i: i64, ymin_i: i64, xmax_i: i64, ymax_i: i64) -> Vec<u8> {
    let mut out = vec![0u8; (w * h) as usize];
    let (ymin, ymax) = (ymin_i * GRID_Y, ymax_i * GRID_Y);
    let nrows = (ymax_i - ymin_i) as usize;
    let mut ybuckets: Vec<Vec<TEdge>> = vec![vec![]; nrows + 1];
    for e in edges { if let Some(t) = make_edge(e, ymin, ymax) { let ix = ((t.ytop - ymin) / GRID_Y) as usize; ybuckets[ix].insert(0, t); } }
    let mut active: Vec<TEdge> = vec![]; // sorted by cell, sentinels implicit
    let mut min_height: i64 = 0; let mut is_vertical = true;
    let merge = |active: &mut Vec<TEdge>, mut b: Vec<TEdge>| {
        b.sort_by_key(|e| e.cell); // stable
        let mut res = Vec::with_capacity(active.len() + b.len());
        let (mut i, mut j) = (0, 0);
        while i < active.len() || j < b.len() {
            if j >= b.len() || (i < active.len() && active[i].cell <= b[j].cell) { res.push(active[i].clone()); i += 1; } else { res.push(b[j].clone()); j += 1; }
        }
        *active = res;
    };
    let mut i = 0usize;
    while i < nrows {
        let mut j = i + 1;
        let mut do_full = false;
        let mut cells = Cells(Default::default());
        // polygon_fill_buckets: y_buckets list is LIFO; prepending again restores insertion order per sub
        let mut buckets: Vec<Vec<TEdge>> = vec![vec![]; GRID_Y as usize];
        let mut max_suby = 0;
        let y = (i as i64 + ymin_i) * GRID_Y;
        for e in std::mem::take(&mut ybuckets[i]) {
            let suby = (e.ytop - y) as usize;
            if e.height_left < min_height { min_height = e.height_left; }
            is_vertical &= e.dy == 0;
            if suby > max_suby { max_suby = suby; }
            buckets[suby].insert(0, e);
        }
        if max_suby == 0 {
            if !buckets[0].is_empty() { let b = std::mem::take(&mut buckets[0]); merge(&mut active, b); }
            if active.is_empty() {
                min_height = i64::from(i32::MAX); is_vertical = true;
                while j < nrows && ybuckets[j].is_empty() { j += 1; }
                i = j; continue;
            }
            // can_do_full_row
            if min_height <= 0 {
                let mut mh = i64::from(i32::MAX); let mut v = true;
                for e in &active { if e.height_left < mh { mh = e.height_left; } v &= e.dy == 0; }
                is_vertical = v; min_height = mh;
            }
            do_full = min_height >= GRID_Y && {
                let mut prev = i64::MIN; let mut ok = true;
                for e in &active {
                    let cell = if e.dy != 0 { let mut x = e.x; x.quo += e.dxdy_full.quo; x.rem += e.dxdy_full.rem; fix(&mut x, e.dy); x.quo + (x.rem >= e.dy / 2) as i64 } else { e.cell };
                    if cell < prev { ok = false; break; }
                    prev = cell;
                }
                ok
            };
        }
        if do_full {
            // full_row
            let n = active.len();
            let mut removed = vec![false; n];
            let mut k = 0;
            while k < n {
                let left = k;
                let dec = |e: &mut TEdge, rm: &mut bool, mh: &mut i64| { e.height_left -= GRID_Y; if e.height_left == 0 { *rm = true; *mh = -1; } };
                dec(&mut active[left], &mut removed[left], &mut min_height);
                let mut winding = active[left].dir;
                let mut right = left + 1;
                loop {
                    dec(&mut active[right], &mut removed[right], &mut min_height);
                    winding += active[right].dir;
                    let next_cell = if right + 1 < n { active[right + 1].cell } else { TAIL_CELL };
                    if winding == 0 && next_cell != active[right].cell { break; }
                    full_step(&mut active[right]);
                    right += 1;
                }
                let mut le = active[left].clone(); cells.render_edge(&mut le, 1); active[left] = le;
                let mut re = active[right].clone(); cells.render_edge(&mut re, -1); active[right] = re;
                k = right + 1;
            }
            active = active.into_iter().zip(removed).filter(|(_, r)| !r).map(|(e, _)| e).collect();
            if is_vertical {
                while j < nrows && ybuckets[j].is_empty() && min_height >= 2 * GRID_Y { min_height -= GRID_Y; j += 1; }
                if j != i + 1 {
                    let count = (j - (i + 1)) as i64 * GRID_Y;
                    let mut keep = vec![];
                    for mut e in std::mem::take(&mut active) { e.height_left -= count; if e.height_left == 0 { min_height = -1; } else { keep.push(e); } }
                    active = keep;
                }
            }
        } else {
            for sub in 0..GRID_Y as usize {
                if !buckets[sub].is_empty() { let b = std::mem::take(&mut buckets[sub]); merge(&mut active, b); }
                // sub_row
                let snap = std::mem::take(&mut active);
                let n = snap.len();
                let cells_pre: Vec<i64> = snap.iter().map(|e| e.cell).collect();
                let mut out_l: Vec<TEdge> = vec![];
                let mut xstart = i64::MIN; let mut prev_x = i64::MIN; let mut winding = 0;
                for (idx, mut e) in snap.into_iter().enumerate() {
                    let xend = cells_pre[idx];
                    let next_cell = if idx + 1 < n { cells_pre[idx + 1] } else { TAIL_CELL };
                    let dir = e.dir;
                    e.height_left -= 1;
                    if e.height_left != 0 {
                        step(&mut e);
                        if e.cell < prev_x {
                            let mut kk: isize = out_l.len() as isize - 1;
                            loop { kk -= 1; let pc = if kk < 0 { HEAD_CELL } else { out_l[kk as usize].cell }; if !(e.cell < pc) { break; } }
                            out_l.insert((kk + 1) as usize, e);
                        } else { prev_x = e.cell; out_l.push(e); }
                        min_height = -1;
                    }
                    winding += dir;
                    if winding == 0 { if next_cell != xend { cells.add_subspan(xstart, xend); xstart = i64::MIN; } } else if xstart == i64::MIN { xstart = xend; }
                }
                active = out_l;
            }
        }
        // blit_a8
        let mut row = vec![0u8; w as usize];
        {
            let alpha = |c: i32| -> u8 { ((c + (c << 4) + 256) >> 9) as u8 };
            let mut cover: i16 = 0;
            let mut it = cells.0.iter().peekable();
            while let Some((&x, c)) = it.peek() { if x < xmin_i { cover = cover.wrapping_add(c.ch); it.next(); } else { break; } }
            let _ = it.peek();
            cover = cover.wrapping_mul((GRID_X * 2) as i16);
            let mut prev_x = xmin_i;
            for (&x, c) in it {
                if x >= xmax_i { break; }
                for px in prev_x..x { if px >= 0 && px < w { row[px as usize] = alpha(cover as i32); } }
                cover = cover.wrapping_add(c.ch.wrapping_mul((GRID_X * 2) as i16));
                let area = cover.wrapping_sub(c.ua);
                if x >= 0 && x < w { row[x as usize] = alpha(area as i32); }
                prev_x = x + 1;
            }
            for px in prev_x..xmax_i { if px >= 0 && px < w { row[px as usize] = alpha(cover as i32); } }
        }
        for yy in i..j { let py = yy as i64 + ymin_i; if py >= 0 && py < h { out[(py * w) as usize..((py + 1) * w) as usize].copy_from_slice(&row); } }
        min_height -= GRID_Y;
        i = j;
    }
    out
}

/// libvips 8.17's `dest-in` of mask alpha `m` into straight-alpha pixel `b`, in its RGBA float (v4f) path: premultiply,
/// scale by the new alpha, unpremultiply, ×255 truncated — which is why an edge pixel's colour can drop by one.
pub(crate) fn dest_in(b: [u8; 4], m: u8) -> [u8; 4] {
    let mut bv = [b[0] as f32 / 255., b[1] as f32 / 255., b[2] as f32 / 255., b[3] as f32 / 255.];
    let ab = bv[3];
    for c in 0..3 { bv[c] *= ab; }
    let aa = m as f32 / 255.;
    let ar = aa * ab;
    if ab != 0. { let k = ar / ab; for c in 0..4 { bv[c] *= k; } }
    bv[3] = ar;
    if ar == 0. { for c in 0..3 { bv[c] = 0.; } } else { for c in 0..4 { bv[c] /= ar; } bv[3] = ar; }
    let mut o = [0u8; 4];
    for c in 0..4 { o[c] = (bv[c] * 255.).clamp(0., 255.) as u8; }
    o
}

