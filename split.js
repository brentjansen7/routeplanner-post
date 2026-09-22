// split.js - Route verdelen over meerdere bezorgers vanaf één gedeeld depot
//
// Alle bezorgers vertrekken bij hetzelfde startadres en eindigen bij hetzelfde
// eindadres. Het gebied wordt in taartpunten rond het depot verdeeld (sweep),
// zodat de een de ene kant doet en de ander de andere kant. Daarna ruilen
// bezorgers onderling stops zolang dat de totale rijtijd verlaagt; het aantal
// stops per bezorger blijft daarbij gelijk.
//
// Index-afspraak in dit bestand: `dur(a, b)` en `dist(a, b)` werken op
// knoop-indices waarbij 0 = startadres, i + 1 = stops[i] en `endIdx` het
// eindadres aanwijst (0 als het eindadres gelijk is aan het startadres).

'use strict';

const EPS_SPLIT = 1e-6;
const RUIL_BUREN = 8;       // kandidaten per stop bij het ruilen

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

// --- Groepsgroottes: zo gelijk mogelijk, de eerste groepen krijgen de rest ---
function groepsGroottes(m, n) {
    const basis = Math.floor(m / n);
    const extra = m % n;
    return Array.from({ length: n }, (_, i) => basis + (i < extra ? 1 : 0));
}

// --- Hoek van een stop gezien vanaf het depot ---
function hoekVanafDepot(depot, stop) {
    const schaal = Math.cos(depot.lat * Math.PI / 180);
    return Math.atan2(stop.lat - depot.lat, (stop.lng - depot.lng) * schaal);
}

// --- Nearest-neighbour kosten van depot langs een groep naar het eindpunt ---
// Snelle schatting om knipvarianten te vergelijken; geen echte optimalisatie.
function nnKosten(groep, dur, endIdx) {
    if (groep.length === 0) return 0;
    const over = groep.slice();
    let cur = 0;
    let kosten = 0;
    while (over.length > 0) {
        let best = 0;
        for (let k = 1; k < over.length; k++) {
            if (dur(cur, over[k] + 1) < dur(cur, over[best] + 1)) best = k;
        }
        kosten += dur(cur, over[best] + 1);
        cur = over[best] + 1;
        over.splice(best, 1);
    }
    return kosten + dur(cur, endIdx);
}

// --- Sweep: taartpunten rond het depot, met gelijk aantal stops per bezorger ---
// Waar je begint te knippen bepaalt de kwaliteit, dus we proberen meerdere
// rotaties en houden de goedkoopste.
function sweepVerdeling(stops, n, depot, dur, endIdx) {
    const m = stops.length;
    const opHoek = stops
        .map((s, i) => ({ i, hoek: hoekVanafDepot(depot, s) }))
        .sort((a, b) => a.hoek - b.hoek)
        .map(x => x.i);

    const groottes = groepsGroottes(m, n);
    const knip = (offset) => {
        const groepen = [];
        let pos = 0;
        for (const grootte of groottes) {
            const groep = [];
            for (let k = 0; k < grootte; k++) groep.push(opHoek[(offset + pos + k) % m]);
            groepen.push(groep);
            pos += grootte;
        }
        return groepen;
    };

    const stap = m <= 60 ? 1 : Math.ceil(m / 60);
    let beste = null;
    let besteKosten = Infinity;
    for (let offset = 0; offset < m; offset += stap) {
        const groepen = knip(offset);
        const kosten = groepen.reduce((som, g) => som + nnKosten(g, dur, endIdx), 0);
        if (kosten < besteKosten) { besteKosten = kosten; beste = groepen; }
    }
    return beste;
}

// --- Kosten van het weghalen van de stop op positie `pos` uit een route ---
function verwijderWinst(route, pos, dur, endIdx) {
    const vorige = pos === 0 ? 0 : route[pos - 1] + 1;
    const huidig = route[pos] + 1;
    const volgende = pos === route.length - 1 ? endIdx : route[pos + 1] + 1;
    return dur(vorige, huidig) + dur(huidig, volgende) - dur(vorige, volgende);
}

// --- Goedkoopste plek om stop `s` in een route te zetten ---
function besteInvoeging(route, s, dur, endIdx) {
    let besteKosten = Infinity;
    let bestePos = 0;
    for (let pos = 0; pos <= route.length; pos++) {
        const x = pos === 0 ? 0 : route[pos - 1] + 1;
        const y = pos === route.length ? endIdx : route[pos] + 1;
        const kosten = dur(x, s + 1) + dur(s + 1, y) - dur(x, y);
        if (kosten < besteKosten) { besteKosten = kosten; bestePos = pos; }
    }
    return { kosten: besteKosten, pos: bestePos };
}

// --- Verbeteren door stops te ruilen tussen bezorgers ---
// Ruilen is 1-voor-1, dus het aantal stops per bezorger blijft gelijk.
// Verschillen de groepen één stop (m niet deelbaar door n), dan mag een stop
// ook verhuizen van de grootste naar de kleinste groep.
function verbeterDoorRuilen(routes, dur, endIdx, budgetMs = 1500) {
    const t0 = Date.now();
    const n = routes.length;
    const groottes = routes.map(r => r.length);
    const maxGrootte = Math.max(...groottes);
    const minGrootte = Math.min(...groottes);
    const magVerhuizen = maxGrootte > minGrootte;

    for (let ronde = 0; ronde < 50; ronde++) {
        if (Date.now() - t0 > budgetMs) break;
        let verbeterd = false;

        for (let a = 0; a < n; a++) {
            for (let b = a + 1; b < n; b++) {
                if (Date.now() - t0 > budgetMs) break;
                const A = routes[a];
                const B = routes[b];

                for (let i = 0; i < A.length; i++) {
                    const stopA = A[i];
                    // Kandidaten: de dichtstbijzijnde stops van de andere bezorger
                    const kandidaten = B
                        .map((s, j) => ({ j, d: dur(stopA + 1, s + 1) }))
                        .sort((x, y) => x.d - y.d)
                        .slice(0, RUIL_BUREN);

                    for (const { j } of kandidaten) {
                        const stopB = B[j];
                        const winstA = verwijderWinst(A, i, dur, endIdx);
                        const winstB = verwijderWinst(B, j, dur, endIdx);
                        const zonderA = A.slice(); zonderA.splice(i, 1);
                        const zonderB = B.slice(); zonderB.splice(j, 1);
                        const inA = besteInvoeging(zonderA, stopB, dur, endIdx);
                        const inB = besteInvoeging(zonderB, stopA, dur, endIdx);
                        const delta = winstA + winstB - inA.kosten - inB.kosten;
                        if (delta > EPS_SPLIT) {
                            zonderA.splice(inA.pos, 0, stopB);
                            zonderB.splice(inB.pos, 0, stopA);
                            routes[a] = zonderA;
                            routes[b] = zonderB;
                            verbeterd = true;
                            break;
                        }
                    }
                    if (verbeterd) break;
                }
                if (verbeterd) break;
            }
            if (verbeterd) break;
        }

        // Verhuizen van een te grote naar een te kleine groep
        if (!verbeterd && magVerhuizen) {
            const groot = routes.reduce((best, r, i) =>
                r.length > routes[best].length ? i : best, 0);
            const klein = routes.reduce((best, r, i) =>
                r.length < routes[best].length ? i : best, 0);
            if (routes[groot].length > routes[klein].length) {
                for (let i = 0; i < routes[groot].length; i++) {
                    const stop = routes[groot][i];
                    const winst = verwijderWinst(routes[groot], i, dur, endIdx);
                    const invoeg = besteInvoeging(routes[klein], stop, dur, endIdx);
                    if (winst - invoeg.kosten > EPS_SPLIT) {
                        routes[groot] = routes[groot].filter((_, k) => k !== i);
                        routes[klein] = routes[klein].slice();
                        routes[klein].splice(invoeg.pos, 0, stop);
                        verbeterd = true;
                        break;
                    }
                }
            }
        }

        if (!verbeterd) break;
    }

    return routes;
}

// --- Rijtijd en afstand van één bezorgersroute, inclusief heen en terug ---
// legSec[i] / legM[i] = van de vorige stop (of het depot bij i = 0) naar stop i.
// terugSec / terugM = van de laatste stop naar het eindadres.
function berekenBezorgerStats(route, dur, dist, endIdx) {
    const legSec = [];
    const legM = [];
    let vorige = 0; // depot
    for (const s of route) {
        legSec.push(dur(vorige, s + 1));
        legM.push(dist(vorige, s + 1));
        vorige = s + 1;
    }
    const terugSec = dur(vorige, endIdx);
    const terugM = dist(vorige, endIdx);
    return {
        legSec, legM, terugSec, terugM,
        rijSec: legSec.reduce((a, b) => a + b, 0) + terugSec,
        afstandM: legM.reduce((a, b) => a + b, 0) + terugM,
    };
}
