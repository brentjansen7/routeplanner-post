// tsp-worker.js - TSP solver in een Web Worker
// Ontvangt: { distances: number[][], roundTrip: boolean, initialOrder?: number[],
//             timeBudgetMs?: number, endCosts?: number[] }
// Stuurt terug: { order: number[] }
//
// Aanpak: knoop 0 staat vast vooraan. We voegen een virtuele eindknoop toe
// (open route: kost 0, rondje: kost terug naar 0), zodat open routes en
// rondjes allebei een pad met vaste begin- en eindknoop zijn.
// endCosts[i] = kosten van knoop i naar een gedeeld eindpunt dat zelf niet in
// de matrix zit (apart eindadres). Gaat voor op roundTrip als het meegegeven is.
// Werkt met asymmetrische matrices (eenrichtingsverkeer, fietspaden).

'use strict';

const K_NEIGHBORS = 12;
const EPS = 1e-6;

// --- Kostenfunctie op de originele matrix ---
function routeCost(order, dist, round, endCosts) {
    let c = 0;
    for (let i = 0; i < order.length - 1; i++) c += dist[order[i]][order[i + 1]];
    const last = order[order.length - 1];
    if (endCosts) c += endCosts[last];
    else if (round) c += dist[last][order[0]];
    return c;
}

// --- Brute-force voor kleine n (≤ 8) ---
function bruteForce(dist, n, round, endCosts) {
    const rest = [];
    for (let i = 1; i < n; i++) rest.push(i);
    let bestCost = Infinity;
    let bestOrder = null;

    function permute(arr, l) {
        if (l === arr.length) {
            const order = [0, ...arr];
            const c = routeCost(order, dist, round, endCosts);
            if (c < bestCost) { bestCost = c; bestOrder = [...order]; }
            return;
        }
        for (let i = l; i < arr.length; i++) {
            [arr[l], arr[i]] = [arr[i], arr[l]];
            permute(arr, l + 1);
            [arr[l], arr[i]] = [arr[i], arr[l]];
        }
    }
    permute(rest, 0);
    return bestOrder;
}

// --- Matrix met virtuele eindknoop (index n) ---
function buildExtended(dist, round, endCosts) {
    const n = dist.length;
    const d = [];
    for (let i = 0; i < n; i++) {
        const row = new Float64Array(n + 1);
        for (let j = 0; j < n; j++) row[j] = dist[i][j];
        row[n] = endCosts ? endCosts[i] : (round ? dist[i][0] : 0);
        d.push(row);
    }
    d.push(new Float64Array(n + 1)); // eindknoop heeft geen uitgaande kanten
    return d;
}

// Per knoop de K dichtstbijzijnde bestemmingen
function buildNeighbors(d, size) {
    const nb = [];
    for (let i = 0; i < size; i++) {
        const idx = [];
        for (let j = 0; j < size; j++) if (j !== i) idx.push(j);
        idx.sort((a, b) => d[i][a] - d[i][b]);
        nb.push(idx.slice(0, K_NEIGHBORS));
    }
    return nb;
}

// --- Tour-toestand: volgorde + posities + prefix-sommen (vooruit/achteruit) ---
class Tour {
    constructor(d, path) {
        this.d = d;
        this.p = path;                 // [0, ..., end]
        this.L = path.length - 1;      // index van de eindknoop
        this.pos = new Int32Array(path.length);
        this.F = new Float64Array(path.length);
        this.B = new Float64Array(path.length);
        this.refresh();
    }
    refresh() {
        const { d, p, pos, F, B } = this;
        pos[p[0]] = 0;
        for (let k = 1; k < p.length; k++) {
            pos[p[k]] = k;
            F[k] = F[k - 1] + d[p[k - 1]][p[k]];
            B[k] = B[k - 1] + d[p[k]][p[k - 1]];
        }
    }
    cost() { return this.F[this.L]; }
}

// --- 2-opt (segment omdraaien), asymmetrie-correct, met buurlijsten ---
function twoOptPass(t, nb) {
    const d = t.d;
    let any = false;
    for (let i = 1; i < t.L - 1; i++) {
        const p = t.p;
        const a = p[i - 1];
        const ai = p[i];
        // Nieuwe kant a → p[j]: segment [i..j] omdraaien
        for (const c of nb[a]) {
            const j = t.pos[c];
            if (j <= i || j >= t.L) continue;
            const b = p[j + 1];
            const delta = d[a][c] + d[ai][b] - d[a][ai] - d[c][b]
                + (t.B[j] - t.B[i]) - (t.F[j] - t.F[i]);
            if (delta < -EPS) { reverse(t, i, j); any = true; break; }
        }
    }
    for (let i = 1; i < t.L - 1; i++) {
        const p = t.p;
        const ai = p[i];
        // Nieuwe kant p[i] → p[j+1]: segment [i..j] omdraaien
        for (const c of nb[ai]) {
            const j = t.pos[c] - 1;
            if (j <= i || j >= t.L) continue;
            const a = p[i - 1];
            const cj = p[j];
            const delta = d[a][cj] + d[ai][c] - d[a][ai] - d[cj][c]
                + (t.B[j] - t.B[i]) - (t.F[j] - t.F[i]);
            if (delta < -EPS) { reverse(t, i, j); any = true; break; }
        }
    }
    return any;
}

function reverse(t, i, j) {
    const p = t.p;
    while (i < j) { const tmp = p[i]; p[i] = p[j]; p[j] = tmp; i++; j--; }
    t.refresh();
}

// --- Or-opt: segment van 1-3 knopen verplaatsen, ook omgedraaid ---
function orOptPass(t, nb) {
    const d = t.d;
    let any = false;
    for (let s = 1; s <= 3; s++) {
        for (let i = 1; i + s - 1 <= t.L - 1; i++) {
            const p = t.p;
            const e = i + s - 1;
            const prev = p[i - 1], first = p[i], last = p[e], next = p[e + 1];
            const gain = d[prev][first] + d[last][next] - d[prev][next];
            const revExtra = (t.B[e] - t.B[i]) - (t.F[e] - t.F[i]);
            let best = -EPS, bestQ = -1, bestRev = false;

            const tryInsert = (q) => {
                if (q < 0 || q >= t.L || (q >= i - 1 && q <= e)) return;
                const x = p[q], y = p[q + 1];
                const fwd = d[x][first] + d[last][y] - d[x][y] - gain;
                if (fwd < best) { best = fwd; bestQ = q; bestRev = false; }
                const rev = d[x][last] + d[first][y] - d[x][y] + revExtra - gain;
                if (rev < best) { best = rev; bestQ = q; bestRev = true; }
            };
            for (const c of nb[last]) tryInsert(t.pos[c] - 1);  // invoegen vóór c
            for (const c of nb[first]) tryInsert(t.pos[c]);     // invoegen na c

            if (bestQ >= 0) {
                const seg = p.slice(i, e + 1);
                if (bestRev) seg.reverse();
                const rest = p.slice(0, i).concat(p.slice(e + 1));
                const at = bestQ < i ? bestQ + 1 : bestQ + 1 - s;
                rest.splice(at, 0, ...seg);
                t.p = rest;
                t.refresh();
                any = true;
            }
        }
    }
    return any;
}

function localSearch(t, nb) {
    for (let iter = 0; iter < 50; iter++) {
        const a = twoOptPass(t, nb);
        const b = orOptPass(t, nb);
        if (!a && !b) break;
    }
}

// --- Startoplossing: (gerandomiseerde) nearest neighbor vanaf knoop 0 ---
function nearestNeighborPath(d, n, randomize) {
    const visited = new Uint8Array(n);
    visited[0] = 1;
    const path = [0];
    for (let step = 1; step < n; step++) {
        const cur = path[path.length - 1];
        let b1 = -1, b2 = -1, b3 = -1;
        for (let j = 1; j < n; j++) {
            if (visited[j]) continue;
            if (b1 < 0 || d[cur][j] < d[cur][b1]) { b3 = b2; b2 = b1; b1 = j; }
            else if (b2 < 0 || d[cur][j] < d[cur][b2]) { b3 = b2; b2 = j; }
            else if (b3 < 0 || d[cur][j] < d[cur][b3]) { b3 = j; }
        }
        let pick = b1;
        if (randomize) {
            const r = Math.random();
            if (r > 0.7 && b2 >= 0) pick = b2;
            if (r > 0.9 && b3 >= 0) pick = b3;
        }
        visited[pick] = 1;
        path.push(pick);
    }
    path.push(n); // virtuele eindknoop
    return path;
}

// --- Perturbatie: double-bridge in een lokaal venster ---
function doubleBridge(path) {
    const L = path.length - 1;
    const inner = L - 1;                 // posities 1..L-1 zijn vrij
    if (inner < 8) return path.slice();
    const win = Math.min(inner, 50);
    const start = 1 + Math.floor(Math.random() * (inner - win + 1));
    const cuts = new Set();
    while (cuts.size < 3) cuts.add(start + Math.floor(Math.random() * win));
    const [a, b, c] = [...cuts].sort((x, y) => x - y);
    return path.slice(0, a).concat(path.slice(b, c), path.slice(a, b), path.slice(c));
}

// --- Hoofd-solver ---
function solveTSP(distanceMatrix, roundTrip, initialOrder, timeBudgetMs, endCosts) {
    const n = distanceMatrix.length;
    const round = !!roundTrip;

    if (n <= 1) return [0];
    if (n === 2) return [0, 1];
    if (n <= 8 && !initialOrder) return bruteForce(distanceMatrix, n, round, endCosts);

    const t0 = Date.now();
    const budget = timeBudgetMs || Math.min(2000, 300 + 8 * n);
    const d = buildExtended(distanceMatrix, round, endCosts);
    const nb = buildNeighbors(d, n + 1);

    let best = null;
    const consider = (path) => {
        const t = new Tour(d, path);
        localSearch(t, nb);
        if (!best || t.cost() < best.cost() - EPS) best = t;
    };

    if (initialOrder && initialOrder.length === n && initialOrder[0] === 0) {
        consider(initialOrder.concat([n]));
    }
    consider(nearestNeighborPath(d, n, false));
    for (let r = 0; r < 4 && Date.now() - t0 < budget / 4; r++) {
        consider(nearestNeighborPath(d, n, true));
    }

    // Iterated Local Search tot het tijdsbudget op is of er lang niks verbetert
    const maxStale = Math.max(1500, 30 * n);
    let stale = 0;
    while (Date.now() - t0 < budget && stale < maxStale) {
        for (let k = 0; k < 20; k++) {
            const t = new Tour(d, doubleBridge(best.p));
            localSearch(t, nb);
            if (t.cost() < best.cost() - EPS) { best = t; stale = 0; } else stale++;
        }
    }

    return best.p.slice(0, n); // eindknoop eraf
}

// --- Worker message handler (niet als dit bestand als gewoon script in de pagina laadt) ---
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = function (e) {
        const { distances, roundTrip, initialOrder, timeBudgetMs, endCosts } = e.data;
        const order = solveTSP(distances, roundTrip, initialOrder, timeBudgetMs, endCosts);
        self.postMessage({ order });
    };
}
