// tsp-worker.js - TSP solver in een Web Worker
// Ontvangt: { distances: number[][], roundTrip: boolean }
// Stuurt terug: { order: number[] }

'use strict';

// --- Kostenfunctie ---
function routeCost(order, dist, round) {
    let c = 0;
    for (let i = 0; i < order.length - 1; i++) c += dist[order[i]][order[i + 1]];
    if (round) c += dist[order[order.length - 1]][order[0]];
    return c;
}

// --- Brute-force voor kleine n (≤ 8) ---
function bruteForce(dist, n, round) {
    const rest = [];
    for (let i = 1; i < n; i++) rest.push(i);
    let bestCost = Infinity;
    let bestOrder = null;

    function permute(arr, l) {
        if (l === arr.length) {
            const order = [0, ...arr];
            const c = routeCost(order, dist, round);
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

// --- Nearest Neighbor heuristiek ---
function nearestNeighbor(dist, n, startIdx) {
    const visited = new Set([startIdx]);
    const order = [startIdx];
    while (visited.size < n) {
        const cur = order[order.length - 1];
        let best = -1, bestD = Infinity;
        for (let i = 0; i < n; i++) {
            if (!visited.has(i) && dist[cur][i] < bestD) { bestD = dist[cur][i]; best = i; }
        }
        visited.add(best);
        order.push(best);
    }
    return order;
}

// --- 2-opt ---
function improve2Opt(order, dist, round) {
    const n = order.length;
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 1; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                let delta;
                if (j === n - 1 && !round) {
                    delta = dist[order[i - 1]][order[j]] - dist[order[i - 1]][order[i]];
                } else {
                    const nextJ = (j + 1 < n) ? order[j + 1] : order[0];
                    const before = dist[order[i - 1]][order[i]] + dist[order[j]][nextJ];
                    const after = dist[order[i - 1]][order[j]] + dist[order[i]][nextJ];
                    delta = after - before;
                }
                if (delta < -1e-6) {
                    let lo = i, hi = j;
                    while (lo < hi) { [order[lo], order[hi]] = [order[hi], order[lo]]; lo++; hi--; }
                    improved = true;
                }
            }
        }
    }
}

// --- Or-opt: verplaats segmenten van 1, 2, 3 knopen ---
function improveOrOpt(order, dist, round) {
    const n = order.length;
    let improved = true;
    while (improved) {
        improved = false;
        for (let segLen = 1; segLen <= Math.min(3, n - 2); segLen++) {
            for (let i = 1; i < n; i++) {
                if (i + segLen > n) continue;
                const endI = i + segLen - 1;
                const prev = order[i - 1];
                const segFirst = order[i];
                const segLast = order[endI];
                const hasNext = (endI + 1 < n);
                const next = hasNext ? order[endI + 1] : (round ? order[0] : null);
                const removeCost = dist[prev][segFirst] + (next !== null ? dist[segLast][next] : 0);
                const bridgeCost = (next !== null) ? dist[prev][next] : 0;
                const removalGain = removeCost - bridgeCost;
                for (let j = 0; j < n; j++) {
                    if (j >= i - 1 && j <= endI) continue;
                    const jNext = (j + 1 < n) ? order[j + 1] : (round ? order[0] : null);
                    if (jNext === null) continue;
                    const insertCost = dist[order[j]][segFirst] + dist[segLast][jNext] - dist[order[j]][jNext];
                    if (insertCost - removalGain < -1e-6) {
                        const segment = order.splice(i, segLen);
                        const insertPos = j < i ? j + 1 : j + 1 - segLen;
                        order.splice(insertPos, 0, ...segment);
                        improved = true;
                        break;
                    }
                }
                if (improved) break;
            }
            if (improved) break;
        }
    }
}

// --- Lokale zoektocht: wissel 2-opt en or-opt af ---
function localSearch(order, dist, round) {
    let prevCost = routeCost(order, dist, round);
    for (let iter = 0; iter < 20; iter++) {
        improve2Opt(order, dist, round);
        improveOrOpt(order, dist, round);
        const newCost = routeCost(order, dist, round);
        if (prevCost - newCost < 0.001) break;
        prevCost = newCost;
    }
}

// --- Double-bridge perturbatie ---
function doubleBridge(order) {
    const n = order.length;
    if (n < 6) return [...order];
    const cuts = [];
    while (cuts.length < 3) {
        const c = 1 + Math.floor(Math.random() * (n - 2));
        if (!cuts.includes(c)) cuts.push(c);
    }
    cuts.sort((a, b) => a - b);
    const seg1 = order.slice(0, cuts[0]);
    const seg2 = order.slice(cuts[0], cuts[1]);
    const seg3 = order.slice(cuts[1], cuts[2]);
    const seg4 = order.slice(cuts[2]);
    return [...seg1, ...seg3, ...seg2, ...seg4];
}

// --- Normaliseer: knoop 0 op positie 0 ---
function normalizeOrder(order, dist, round) {
    const idx0 = order.indexOf(0);
    if (idx0 === 0) return order;
    if (round) {
        return [...order.slice(idx0), ...order.slice(0, idx0)];
    } else {
        order.splice(idx0, 1);
        order.unshift(0);
        localSearch(order, dist, round);
        return order;
    }
}

// --- Hoofd-solver ---
// roundTrip als parameter (geen toegang tot state in worker)
function solveTSP(distanceMatrix, roundTrip) {
    const n = distanceMatrix.length;
    const round = roundTrip;

    if (n <= 1) return [0];
    if (n === 2) return [0, 1];

    if (n <= 8) return bruteForce(distanceMatrix, n, round);

    let globalBest = null;
    let globalBestCost = Infinity;

    function tryCandidate(order) {
        order = normalizeOrder(order, distanceMatrix, round);
        const cost = routeCost(order, distanceMatrix, round);
        if (cost < globalBestCost) { globalBestCost = cost; globalBest = [...order]; }
    }

    for (let start = 0; start < n; start++) {
        const order = nearestNeighbor(distanceMatrix, n, start);
        localSearch(order, distanceMatrix, round);
        tryCandidate(order);
        if (round) {
            const rev = [order[0], ...order.slice(1).reverse()];
            localSearch(rev, distanceMatrix, round);
            tryCandidate(rev);
        }
    }

    // ILS perturbatie: meer kicks = beter ontsnappen uit lokale optima
    // Voor n=95 is elke kick ~2ms in de worker, dus 200 kicks ≈ 0.4s extra
    const kicks = n <= 20 ? 200 : (n <= 50 ? 150 : (n <= 150 ? 200 : 60));
    for (let k = 0; k < kicks; k++) {
        const order = doubleBridge([...globalBest]);
        localSearch(order, distanceMatrix, round);
        tryCandidate(order);
        // Probeer ook de omgekeerde versie van de perturbatie
        if (round) {
            const rev = [order[0], ...order.slice(1).reverse()];
            localSearch(rev, distanceMatrix, round);
            tryCandidate(rev);
        }
    }

    return globalBest;
}

// --- Worker message handler ---
self.onmessage = function (e) {
    const { distances, roundTrip } = e.data;
    const order = solveTSP(distances, roundTrip);
    self.postMessage({ order });
};
