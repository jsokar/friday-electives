// §7.5 Exact minimum-cost assignment of students to electives with group-size bounds.
// Min-cost flow (successive shortest paths, Bellman–Ford). Small problem: ≤ ~130 students × 4 electives.
// Lower bounds are enforced with the classic trick: the first `lo` seats of each elective carry a large bonus,
// so any feasible solution fills them; afterwards we check they really were filled.

const BIG = 1e12;

class Graph {
  constructor(n) {
    this.n = n;
    this.adj = Array.from({ length: n }, () => []);
    this.edges = [];
  }
  add(u, v, cap, cost) {
    const e = { u, v, cap, cost, flow: 0, rev: this.edges.length + 1 };
    const r = { u: v, v: u, cap: 0, cost: -cost, flow: 0, rev: this.edges.length };
    this.adj[u].push(this.edges.length);
    this.edges.push(e);
    this.adj[v].push(this.edges.length);
    this.edges.push(r);
    return this.edges.length - 2;
  }
}

function minCostFlow(g, s, t, need) {
  let flow = 0;
  let cost = 0;
  while (flow < need) {
    const dist = new Array(g.n).fill(Infinity);
    const inQ = new Array(g.n).fill(false);
    const prevEdge = new Array(g.n).fill(-1);
    dist[s] = 0;
    const queue = [s];
    inQ[s] = true;
    while (queue.length) {
      // SPFA (queue-based Bellman–Ford)
      const u = queue.shift();
      inQ[u] = false;
      for (const id of g.adj[u]) {
        const e = g.edges[id];
        if (e.cap - e.flow > 0 && dist[u] + e.cost < dist[e.v]) {
          dist[e.v] = dist[u] + e.cost;
          prevEdge[e.v] = id;
          if (!inQ[e.v]) {
            inQ[e.v] = true;
            queue.push(e.v);
          }
        }
      }
    }
    if (dist[t] === Infinity) break;
    // augment by 1 (all source arcs have capacity 1)
    let v = t;
    while (v !== s) {
      const id = prevEdge[v];
      g.edges[id].flow += 1;
      g.edges[id ^ 1].flow -= 1;
      v = g.edges[id].u;
    }
    flow += 1;
    cost += dist[t];
  }
  return { flow, cost };
}

/**
 * @param {Array<{id:string, costs: Object<string, number>}>} students  costs: elective -> integer cost (missing = not allowed)
 * @param {string[]} electives
 * @param {{lo:number, hi:number}} bounds  every elective must get between lo and hi students
 * @returns {{ok:boolean, assignment?:Object<string,string>, cost?:number, sizes?:Object<string,number>}}
 */
export function solveWithBounds(students, electives, { lo, hi }, mix = null) {
  const N = students.length;
  const S = 0;
  const T = 1;
  const K = electives.length;
  const eNode = (k) => 2 + k;
  const sNode = (i) => 2 + K + i;
  // Optional "even mix" layer (§7.6): students of each mix group (track) should be spread evenly over electives.
  // Seats up to the group's fair share are free; each extra seat costs mix.penalty.
  const groupKeys = mix ? [...new Set(students.map((s) => s.group))] : [];
  const gNode = (gi, k) => 2 + K + N + gi * K + k;
  const g = new Graph(2 + K + N + groupKeys.length * K);
  if (mix) {
    groupKeys.forEach((key, gi) => {
      const size = students.filter((s) => s.group === key).length;
      electives.forEach((el, k) => {
        const share = mix.shares?.[key]?.[el] ?? Math.ceil(size / K);
        if (share > 0) g.add(gNode(gi, k), eNode(k), share, 0);
        g.add(gNode(gi, k), eNode(k), N, mix.penalty);
      });
    });
  }
  const studentEdges = [];
  for (let i = 0; i < N; i++) {
    g.add(S, sNode(i), 1, 0);
    const list = [];
    const gi = mix ? groupKeys.indexOf(students[i].group) : -1;
    electives.forEach((el, k) => {
      const c = students[i].costs[el];
      if (c === undefined || c === null) return;
      list.push({ el, id: g.add(sNode(i), mix ? gNode(gi, k) : eNode(k), 1, c) });
    });
    studentEdges.push(list);
  }
  electives.forEach((el, k) => {
    if (lo > 0) g.add(eNode(k), T, lo, -BIG);
    if (hi - lo > 0) g.add(eNode(k), T, hi - lo, 0);
  });
  const { flow, cost } = minCostFlow(g, S, T, N);
  if (flow < N) return { ok: false };
  const assignment = {};
  const sizes = Object.fromEntries(electives.map((e) => [e, 0]));
  studentEdges.forEach((list, i) => {
    const used = list.find((x) => g.edges[x.id].flow === 1);
    assignment[students[i].id] = used.el;
    sizes[used.el] += 1;
  });
  if (electives.some((e) => sizes[e] < lo)) return { ok: false };
  const realCost = cost + BIG * lo * electives.length;
  return { ok: true, assignment, cost: realCost, sizes };
}

/**
 * Try every size window [lo, lo+spread] that can hold N students and keep the cheapest solution.
 */
export function solveWithSpread(students, electives, spread, mix = null) {
  const N = students.length;
  const k = electives.length;
  let best = null;
  const base = Math.floor(N / k);
  for (let lo = Math.max(0, base - spread); lo <= base; lo++) {
    const hi = lo + spread;
    if (lo * k > N || hi * k < N) continue;
    const r = solveWithBounds(students, electives, { lo, hi }, mix);
    if (r.ok && (!best || r.cost < best.cost)) best = { ...r, lo, hi };
  }
  return best;
}
