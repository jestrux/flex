//! A unified line diff (Myers), small and bounded: the trail's file changes and an agent's Edit calls. No diff crate in
//! the workspace, and this is all the trail needs.

/// The diff of `a` → `b` as unified hunks (3 lines of context, no file header), with the lines added and removed.
/// Past `max_bytes` the text is cut at a line and `truncated` set. Past `MAX_D` edits it gives up on alignment and
/// shows the changed middle as one replaced block (still correct, just coarser).
pub struct Diff { pub text: String, pub plus: usize, pub minus: usize, pub truncated: bool }

const MAX_D: usize = 4000;
const CONTEXT: usize = 3;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Op { Same, Del, Add }

pub fn unified(a: &str, b: &str, max_bytes: usize) -> Diff {
    let a: Vec<&str> = a.lines().collect();
    let b: Vec<&str> = b.lines().collect();
    // common prefix and suffix first: most edits touch a few lines of a long file
    let pre = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let suf = a[pre..].iter().rev().zip(b[pre..].iter().rev()).take_while(|(x, y)| x == y).count();
    let (am, bm) = (&a[pre..a.len() - suf], &b[pre..b.len() - suf]);
    let mut ops = vec![Op::Same; pre];
    ops.extend(myers(am, bm).unwrap_or_else(|| {
        let mut v = vec![Op::Del; am.len()];
        v.extend(vec![Op::Add; bm.len()]);
        v
    }));
    ops.extend(vec![Op::Same; suf]);
    render(&a, &b, &ops, max_bytes)
}

/// The edit script, or None when it needs more than MAX_D edits.
fn myers(a: &[&str], b: &[&str]) -> Option<Vec<Op>> {
    let (n, m) = (a.len() as isize, b.len() as isize);
    if n == 0 { return Some(vec![Op::Add; m as usize]); }
    if m == 0 { return Some(vec![Op::Del; n as usize]); }
    let max = (n + m) as usize;
    let off = max as isize;
    let mut v = vec![0isize; 2 * max + 2];
    // the V of each step, only its live diagonals (-d..=d), so memory is O(D²) not O(D·N)
    let mut trace: Vec<Vec<isize>> = vec![];
    for d in 0..=max.min(MAX_D) as isize {
        let mut k = -d;
        while k <= d {
            let i = (k + off) as usize;
            let mut x = if k == -d || (k != d && v[i - 1] < v[i + 1]) { v[i + 1] } else { v[i - 1] + 1 };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] { x += 1; y += 1; }
            v[i] = x;
            if x >= n && y >= m {
                trace.push(v[(off - d) as usize..=(off + d) as usize].to_vec());
                return Some(backtrack(&trace, n, m));
            }
            k += 2;
        }
        trace.push(v[(off - d) as usize..=(off + d) as usize].to_vec());
    }
    None
}

fn backtrack(trace: &[Vec<isize>], n: isize, m: isize) -> Vec<Op> {
    let mut ops = vec![];
    let (mut x, mut y) = (n, m);
    for d in (0..trace.len() as isize).rev() {
        let k = x - y;
        if d == 0 {
            while x > 0 && y > 0 { ops.push(Op::Same); x -= 1; y -= 1; }
            break;
        }
        let prev = &trace[(d - 1) as usize];
        let at = |k: isize| prev[(k + d - 1) as usize];
        let down = k == -d || (k != d && at(k - 1) < at(k + 1));
        let pk = if down { k + 1 } else { k - 1 };
        let px = at(pk);
        let py = px - pk;
        while x > px && y > py { ops.push(Op::Same); x -= 1; y -= 1; }
        if down { ops.push(Op::Add); y -= 1; } else { ops.push(Op::Del); x -= 1; }
    }
    ops.reverse();
    ops
}

fn render(a: &[&str], b: &[&str], ops: &[Op], max_bytes: usize) -> Diff {
    let (plus, minus) = (ops.iter().filter(|o| **o == Op::Add).count(), ops.iter().filter(|o| **o == Op::Del).count());
    let mut out = String::new();
    let mut truncated = false;
    // the positions (in ops) of changes, grouped into hunks whose context overlaps
    let changed: Vec<usize> = ops.iter().enumerate().filter(|(_, o)| **o != Op::Same).map(|(i, _)| i).collect();
    let mut groups: Vec<(usize, usize)> = vec![];
    for &i in &changed {
        match groups.last_mut() {
            Some(g) if i <= g.1 + 2 * CONTEXT + 1 => g.1 = i,
            _ => groups.push((i, i)),
        }
    }
    // line numbers at each op index
    let (mut ai, mut bi) = (vec![0usize; ops.len() + 1], vec![0usize; ops.len() + 1]);
    for (i, o) in ops.iter().enumerate() {
        ai[i + 1] = ai[i] + (*o != Op::Add) as usize;
        bi[i + 1] = bi[i] + (*o != Op::Del) as usize;
    }
    'hunks: for (s, e) in groups {
        let (s, e) = (s.saturating_sub(CONTEXT), (e + CONTEXT + 1).min(ops.len()));
        let (alen, blen) = (ai[e] - ai[s], bi[e] - bi[s]);
        let head = format!("@@ -{},{alen} +{},{blen} @@\n", ai[s] + (alen > 0) as usize, bi[s] + (blen > 0) as usize);
        if out.len() + head.len() > max_bytes { truncated = true; break; }
        out.push_str(&head);
        for i in s..e {
            let line = match ops[i] {
                Op::Same => format!(" {}\n", a[ai[i]]),
                Op::Del => format!("-{}\n", a[ai[i]]),
                Op::Add => format!("+{}\n", b[bi[i]]),
            };
            if out.len() + line.len() > max_bytes { truncated = true; break 'hunks; }
            out.push_str(&line);
        }
    }
    Diff { text: out, plus, minus, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_changed_line_in_context() {
        let a = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
        let b = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n";
        let d = unified(a, b, 1 << 20);
        assert_eq!((d.plus, d.minus), (1, 1));
        assert_eq!(d.text, "@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n");
    }

    #[test]
    fn adds_deletes_and_separate_hunks() {
        let a: String = (1..=30).map(|i| format!("{i}\n")).collect();
        let b = a.replace("2\n", "2\nnew\n").replace("27\n", "");
        let d = unified(&a, &b, 1 << 20);
        assert_eq!((d.plus, d.minus), (3, 1), "{}", d.text); // "2\n" also ends "12\n" and "22\n": three adds
        assert_eq!(d.text.matches("@@").count() / 2, 3);
        assert!(d.text.contains("-27\n"));
    }

    #[test]
    fn new_and_emptied_files() {
        assert_eq!(unified("", "a\nb\n", 999).text, "@@ -0,0 +1,2 @@\n+a\n+b\n");
        assert_eq!(unified("a\n", "", 999).text, "@@ -1,1 +0,0 @@\n-a\n");
        assert_eq!(unified("same\n", "same\n", 999).text, "");
    }

    #[test]
    fn bounded() {
        let b: String = (0..1000).map(|i| format!("line {i}\n")).collect();
        let d = unified("", &b, 200);
        assert!(d.truncated && d.text.len() <= 200 && d.plus == 1000);
    }

    #[test]
    fn matches_a_brute_force_lcs() {
        // the script is minimal: plus + minus = |a| + |b| - 2·LCS
        let cases = [("abcabba", "cbabac"), ("xaxbxc", "abc"), ("aaaa", "aa"), ("abc", "xyz"), ("", "q")];
        for (x, y) in cases {
            let (a, b): (String, String) = (x.chars().map(|c| format!("{c}\n")).collect(), y.chars().map(|c| format!("{c}\n")).collect());
            let d = unified(&a, &b, 1 << 20);
            let (xa, ya): (Vec<char>, Vec<char>) = (x.chars().collect(), y.chars().collect());
            let mut t = vec![vec![0; ya.len() + 1]; xa.len() + 1];
            for i in 0..xa.len() { for j in 0..ya.len() {
                t[i + 1][j + 1] = if xa[i] == ya[j] { t[i][j] + 1 } else { t[i][j + 1].max(t[i + 1][j]) };
            } }
            assert_eq!(d.plus + d.minus, xa.len() + ya.len() - 2 * t[xa.len()][ya.len()], "{x} → {y}");
        }
    }
}
