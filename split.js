// split.js - Route verdelen over meerdere bezorgers vanaf één gedeeld depot
//
// Alle bezorgers vertrekken bij hetzelfde startadres en eindigen bij hetzelfde
// eindadres. De verdeling gaat per gebied: k-means zoekt de zones op de kaart
// (buurten, wijken), zodat één bezorger niet twee losse stukken aan
// weerszijden van de route krijgt. Een taartpunt-verdeling rond het depot doet
// als tegenkandidaat mee en wint alleen als die werkelijk korter is.
//
// Daarna verschuiven en ruilen bezorgers onderling stops zolang dat de totale
// rijtijd verlaagt. Het aantal stops blijft binnen een bandbreedte: ongeveer
// gelijk, maar de geografie gaat voor op exact evenveel.
//
// Index-afspraak in dit bestand: `dur(a, b)` en `dist(a, b)` werken op
// knoop-indices waarbij 0 = startadres en i + 1 = stops[i]. `endIdx` wijst het
// eindadres aan:
//   endIdx  > 0  een apart eindadres
//   endIdx == 0  terug naar het startadres (rondje)
//   endIdx  < 0  open route: de bezorger stopt bij zijn laatste stop

'use strict';

const EPS_SPLIT = 1e-6;
const RUIL_BUREN = 8;        // kandidaten per stop bij het ruilen
// Speling op het aantal stops per bezorger. Ruimer dan dit levert nauwelijks
// kortere routes op (< 1%) maar wel flink scheve verdelingen, dus strak houden.
const BALANS_MARGE = 0.15;

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

// --- Hoeveel stops mag een bezorger hebben: ongeveer gelijk, niet exact ---
function groepsGrenzen(m, n, marge = BALANS_MARGE) {
    const gemiddeld = m / n;
    return {
        min: Math.max(1, Math.floor(gemiddeld * (1 - marge))),
        max: Math.max(1, Math.ceil(gemiddeld * (1 + marge))),
    };
}

// Kosten van de laatste etappe naar het eindpunt. Bij een open route (endIdx < 0)
// rijdt de bezorger na zijn laatste stop nergens meer heen, dus kost die niets.
function naarEind(knoop, dur, endIdx) {
    return endIdx < 0 ? 0 : dur(knoop, endIdx);
}

// --- Kosten van een groep: nearest neighbour van depot langs de stops naar het eind ---
// Snelle schatting om indelingen te vergelijken; geen echte optimalisatie.
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
    return kosten + naarEind(cur, dur, endIdx);
}

// Totale rijtijd van alle bezorgers samen (routes in bezorgvolgorde)
function totaleRijtijd(routes, dur, endIdx) {
    return routes.reduce((som, route) => {
        let t = 0;
        let vorige = 0;
        for (const s of route) { t += dur(vorige, s + 1); vorige = s + 1; }
        return som + t + naarEind(vorige, dur, endIdx);
    }, 0);
}

// ================================================================
// Indeling in gebieden
// ================================================================

function zwaartepunt(groep, stops) {
    return {
        lat: groep.reduce((s, i) => s + stops[i].lat, 0) / groep.length,
        lng: groep.reduce((s, i) => s + stops[i].lng, 0) / groep.length,
    };
}

// Trekt groepen naar de bandbreedte door randstops te verhuizen naar de
// groep waar ze het dichtst bij liggen.
function balanceerGroepen(groepen, stops, grenzen) {
    for (let ronde = 0; ronde < stops.length * 4; ronde++) {
        let groot = 0, klein = 0;
        groepen.forEach((g, i) => {
            if (g.length > groepen[groot].length) groot = i;
            if (g.length < groepen[klein].length) klein = i;
        });
        const teGroot = groepen[groot].length > grenzen.max;
        const teKlein = groepen[klein].length < grenzen.min;
        if (!teGroot && !teKlein) break;
        if (groot === klein || groepen[groot].length <= 1) break;

        const cGroot = zwaartepunt(groepen[groot], stops);
        // Lege doelgroep: pak de stop die het verst van het grote zwaartepunt ligt
        const leeg = groepen[klein].length === 0;
        const cKlein = leeg ? null : zwaartepunt(groepen[klein], stops);

        let beste = 0;
        let besteScore = Infinity;
        groepen[groot].forEach((idx, k) => {
            const s = stops[idx];
            const bijGroot = haversineKm(s.lat, s.lng, cGroot.lat, cGroot.lng);
            const score = leeg
                ? -bijGroot
                : haversineKm(s.lat, s.lng, cKlein.lat, cKlein.lng) - bijGroot;
            if (score < besteScore) { besteScore = score; beste = k; }
        });

        groepen[klein].push(groepen[groot][beste]);
        groepen[groot].splice(beste, 1);
    }
    return groepen;
}

// Zones op de kaart via k-means, daarna gebalanceerd
function zoneVerdeling(stops, n, startIdx, grenzen) {
    const labels = kMeans(stops, n, 100, startIdx);
    const groepen = Array.from({ length: n }, () => []);
    stops.forEach((_, i) => {
        const label = Math.min(labels[i], n - 1);
        groepen[label].push(i);
    });
    return balanceerGroepen(groepen, stops, grenzen);
}

// --- Taartpunten rond het depot (tegenkandidaat) ---
function hoekVanafDepot(depot, stop) {
    const schaal = Math.cos(depot.lat * Math.PI / 180);
    return Math.atan2(stop.lat - depot.lat, (stop.lng - depot.lng) * schaal);
}

function sweepVerdeling(stops, n, depot, dur, endIdx) {
    const m = stops.length;
    const opHoek = stops
        .map((s, i) => ({ i, hoek: hoekVanafDepot(depot, s) }))
        .sort((a, b) => a.hoek - b.hoek)
        .map(x => x.i);

    const basis = Math.floor(m / n);
    const extra = m % n;
    const groottes = Array.from({ length: n }, (_, i) => basis + (i < extra ? 1 : 0));

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
    let beste = knip(0);
    let besteKosten = Infinity;
    for (let offset = 0; offset < m; offset += stap) {
        const groepen = knip(offset);
        const kosten = groepen.reduce((som, g) => som + nnKosten(g, dur, endIdx), 0);
        if (kosten < besteKosten) { besteKosten = kosten; beste = groepen; }
    }
    return beste;
}

// --- Hoofdingang: verdeel de stops over n bezorgers, per gebied ---
function verdeelOverGebieden(stops, n, depot, dur, endIdx, marge = BALANS_MARGE) {
    const m = stops.length;
    if (n <= 1) return [stops.map((_, i) => i)];
    if (m <= n) return stops.map((_, i) => [i]);   // niet meer bezorgers dan stops

    const grenzen = groepsGrenzen(m, n, marge);

    // Meerdere indelingen proberen en de goedkoopste houden
    const kandidaten = [];
    const startPunten = new Set([0]);
    for (let r = 1; r < 4; r++) startPunten.add(Math.floor(r * m / 4) % m);
    for (const start of startPunten) {
        kandidaten.push(zoneVerdeling(stops, n, start, grenzen));
    }
    kandidaten.push(sweepVerdeling(stops, n, depot, dur, endIdx));

    let beste = null;
    let besteKosten = Infinity;
    for (const kandidaat of kandidaten) {
        if (kandidaat.length !== n || kandidaat.some(g => g.length === 0)) continue;
        const kosten = kandidaat.reduce((som, g) => som + nnKosten(g, dur, endIdx), 0);
        if (kosten < besteKosten) { besteKosten = kosten; beste = kandidaat; }
    }
    return beste || sweepVerdeling(stops, n, depot, dur, endIdx);
}

// ================================================================
// Verbeteren: stops tussen bezorgers verschuiven en ruilen
// ================================================================

// Wat het scheelt als de stop op positie `pos` uit de route wordt gehaald
function verwijderWinst(route, pos, dur, endIdx) {
    const vorige = pos === 0 ? 0 : route[pos - 1] + 1;
    const huidig = route[pos] + 1;
    if (pos === route.length - 1) {
        // Laatste stop: hierna volgt alleen nog het eindpunt (of niets)
        return dur(vorige, huidig) + naarEind(huidig, dur, endIdx) - naarEind(vorige, dur, endIdx);
    }
    const volgende = route[pos + 1] + 1;
    return dur(vorige, huidig) + dur(huidig, volgende) - dur(vorige, volgende);
}

// Goedkoopste plek om stop `s` in een route te zetten
function besteInvoeging(route, s, dur, endIdx) {
    let besteKosten = Infinity;
    let bestePos = 0;
    for (let pos = 0; pos <= route.length; pos++) {
        const x = pos === 0 ? 0 : route[pos - 1] + 1;
        const kosten = pos === route.length
            ? dur(x, s + 1) + naarEind(s + 1, dur, endIdx) - naarEind(x, dur, endIdx)
            : dur(x, s + 1) + dur(s + 1, route[pos] + 1) - dur(x, route[pos] + 1);
        if (kosten < besteKosten) { besteKosten = kosten; bestePos = pos; }
    }
    return { kosten: besteKosten, pos: bestePos };
}

// Zoekt één verbetering en voert die door. Geeft false als er niets meer te winnen is.
function eenVerbetering(routes, dur, endIdx, grenzen) {
    const n = routes.length;

    // Verplaatsen: stop van de ene bezorger naar de andere
    for (let a = 0; a < n; a++) {
        if (routes[a].length - 1 < grenzen.min) continue;
        for (let b = 0; b < n; b++) {
            if (a === b || routes[b].length + 1 > grenzen.max) continue;
            for (let i = 0; i < routes[a].length; i++) {
                const stop = routes[a][i];
                const winst = verwijderWinst(routes[a], i, dur, endIdx);
                const invoeg = besteInvoeging(routes[b], stop, dur, endIdx);
                if (winst - invoeg.kosten > EPS_SPLIT) {
                    const nieuwA = routes[a].slice();
                    nieuwA.splice(i, 1);
                    const nieuwB = routes[b].slice();
                    nieuwB.splice(invoeg.pos, 0, stop);
                    routes[a] = nieuwA;
                    routes[b] = nieuwB;
                    return true;
                }
            }
        }
    }

    // Ruilen: één voor één, de groottes blijven gelijk
    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            for (let i = 0; i < routes[a].length; i++) {
                const stopA = routes[a][i];
                const kandidaten = routes[b]
                    .map((s, j) => ({ j, d: dur(stopA + 1, s + 1) }))
                    .sort((x, y) => x.d - y.d)
                    .slice(0, RUIL_BUREN);
                for (const { j } of kandidaten) {
                    const stopB = routes[b][j];
                    const winstA = verwijderWinst(routes[a], i, dur, endIdx);
                    const winstB = verwijderWinst(routes[b], j, dur, endIdx);
                    const zonderA = routes[a].slice(); zonderA.splice(i, 1);
                    const zonderB = routes[b].slice(); zonderB.splice(j, 1);
                    const inA = besteInvoeging(zonderA, stopB, dur, endIdx);
                    const inB = besteInvoeging(zonderB, stopA, dur, endIdx);
                    if (winstA + winstB - inA.kosten - inB.kosten > EPS_SPLIT) {
                        zonderA.splice(inA.pos, 0, stopB);
                        zonderB.splice(inB.pos, 0, stopA);
                        routes[a] = zonderA;
                        routes[b] = zonderB;
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

function verbeterTussenBezorgers(routes, dur, endIdx, grenzen, budgetMs = 1500) {
    const t0 = Date.now();
    let stappen = 0;
    while (Date.now() - t0 < budgetMs && stappen < 5000) {
        if (!eenVerbetering(routes, dur, endIdx, grenzen)) break;
        stappen++;
    }
    return routes;
}

// ================================================================
// Cijfers per bezorger
// ================================================================

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
    const terugSec = naarEind(vorige, dur, endIdx);
    const terugM = endIdx < 0 ? 0 : dist(vorige, endIdx);
    return {
        legSec, legM, terugSec, terugM,
        rijSec: legSec.reduce((a, b) => a + b, 0) + terugSec,
        afstandM: legM.reduce((a, b) => a + b, 0) + terugM,
    };
}
