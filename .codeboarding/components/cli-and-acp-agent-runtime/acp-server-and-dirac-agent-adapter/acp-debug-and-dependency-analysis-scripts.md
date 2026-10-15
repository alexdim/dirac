---
component_id: 2.3.3
component_name: ACP Debug & Dependency Analysis Scripts
---

# ACP Debug & Dependency Analysis Scripts

## Component Description

Provides standalone diagnostic scripts for testing ACP CLI subprocess initialization and analyzing module dependency cycles via Tarjan strongly connected components.

---

## Key References:

### /Users/highlands/pools/Development/dirac/private/plans/scc-prototype.mjs (lines 3-23)
```
function sccLabels(file) {
  const r = JSON.parse(readFileSync(file, "utf8"))
  const local = new Set(r.modules.filter((m) => !m.coreModule && !m.couldNotResolve && !/node_modules/.test(m.source)).map((m) => m.source))
  const adj = new Map()
  for (const m of r.modules) if (local.has(m.source)) adj.set(m.source, m.dependencies.map((d) => d.resolved).filter((x) => local.has(x)))
  let idx = 0; const index = new Map(), low = new Map(), onStack = new Set(), stack = [], labels = new Map()
  const strong = (v) => { // iterative Tarjan
    const work = [[v, 0]]; index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.add(v)
    while (work.length) {
      const [n, i] = work[work.length - 1]; const ns = adj.get(n) || []
      if (i < ns.length) { work[work.length - 1][1]++; const w = ns[i]
        if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; stack.push(w); onStack.add(w); work.push([w, 0]) }
        else if (onStack.has(w)) low.set(n, Math.min(low.get(n), index.get(w)))
      } else { work.pop(); if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(n))) }
        if (low.get(n) === index.get(n)) { const comp = []; let w; do { w = stack.pop(); onStack.delete(w); comp.push(w) } while (w !== n)
          const selfLoop = comp.length === 1 && (adj.get(n) || []).includes(n)
          if (comp.length > 1 || selfLoop) { const label = comp.slice().sort()[0]; for (const c of comp) labels.set(c, label) } } } }
  }
  for (const v of adj.keys()) if (!index.has(v)) strong(v)
  return labels
}
```


## Source Files:

- `cli/acp-spawn-debug.mjs`
- `private/plans/scc-prototype.mjs`

