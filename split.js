// split.js - Route splitsen over meerdere bezorgers
// Houdt rekening met clusters zodat elke bezorger in een geografisch coherent gebied blijft

'use strict';

// Kleurenpalet voor bezorgers (tot 10 bezorgers)
const BEZORGER_KLEUREN = [
    '#4361ee', // blauw
    '#e63946', // rood
    '#2dc653', // groen
    '#f4a261', // oranje
    '#9b5de5', // paars
    '#00b4d8', // cyaan
    '#fb5607', // roodoranje
    '#3a86ff', // lichtblauw
    '#8338ec', // violet
    '#06d6a0', // mintgroen
];

function getBezorgerKleur(idx) {
    return BEZORGER_KLEUREN[idx % BEZORGER_KLEUREN.length];
}

// Splits een geordende lijst stops over n bezorgers
// Gebruikt clusterInfo als dat beschikbaar is voor geografisch coherente splitsen
// Anders gelijkmatige verdeling op basis van volgorde
function splitRouteAmongCouriers(orderedStops, n, clusterLabels) {
    if (n <= 1 || orderedStops.length === 0) return [orderedStops];
    n = Math.min(n, orderedStops.length); // niet meer bezorgers dan stops

    if (clusterLabels && clusterLabels.length === orderedStops.length) {
        return splitByClusters(orderedStops, n, clusterLabels);
    }
    return splitEvenly(orderedStops, n);
}

// Gelijkmatige verdeling op basis van volgorde
function splitEvenly(orderedStops, n) {
    const routes = [];
    const baseSize = Math.floor(orderedStops.length / n);
    const extra = orderedStops.length % n;
    let idx = 0;
    for (let i = 0; i < n; i++) {
        const size = baseSize + (i < extra ? 1 : 0);
        const chunk = orderedStops.slice(idx, idx + size);
        if (chunk.length > 0) routes.push(chunk);
        idx += size;
    }
    return routes;
}

// Splits op basis van clusters: wijs hele clusters toe aan bezorgers
// zodat elke bezorger in een geografisch samenhangende zone bezorgt
function splitByClusters(orderedStops, n, clusterLabels) {
    // Groepeer stops per cluster (behoud originele volgorde binnen cluster)
    const clusterMap = new Map();
    orderedStops.forEach((stop, i) => {
        const label = clusterLabels[i];
        if (!clusterMap.has(label)) clusterMap.set(label, []);
        clusterMap.get(label).push(stop);
    });

    const clusters = [...clusterMap.values()];

    // Verdeel clusters over bezorgers (greedy bin packing op grootte)
    const bezorgerStops = Array.from({ length: n }, () => []);
    const bezorgerGrootte = new Array(n).fill(0);

    // Sorteer clusters op grootte (groot → klein) voor betere verdeling
    clusters.sort((a, b) => b.length - a.length);

    for (const cluster of clusters) {
        // Wijs toe aan de bezorger met de minste stops
        const kleinste = bezorgerGrootte.indexOf(Math.min(...bezorgerGrootte));
        bezorgerStops[kleinste].push(...cluster);
        bezorgerGrootte[kleinste] += cluster.length;
    }

    return bezorgerStops.filter(route => route.length > 0);
}

// Genereer samenvatting per bezorger voor weergave in route-samenvatting
function genereerBezorgerSamenvatting(courierRoutes, matrix) {
    return courierRoutes.map((stops, idx) => ({
        nummer: idx + 1,
        kleur: getBezorgerKleur(idx),
        stops,
        aantalStops: stops.length,
    }));
}
