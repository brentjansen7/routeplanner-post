// ============================================================
// Route Optimizer - Client-side route optimization app
// Uses Leaflet + OpenStreetMap, Nominatim geocoding, OSRM routing
// ============================================================

// Guard: Wait for auth check before initializing app
if (!window.__authChecked) {
    window.addEventListener('authReady', () => {
        initApp();
    });
} else {
    initApp();
}

function initApp() {
    (function () {
        'use strict';

    // --- Fetch met timeout helper ---
    function fetchWithTimeout(url, options = {}, ms = 12000) {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { ...options, signal: ctrl.signal })
            .finally(() => clearTimeout(id));
    }

    // --- State ---
    const state = {
        stops: [],          // { id, name, lat, lng, marker }
        routeLine: null,
        optimized: false,
        currentEtappe: 0,
        nextId: 1,
        travelMode: 'driving',  // 'driving', 'cycling', or 'foot'
        roundTrip: false,
        // Bezorg-modus
        bezorgModus: false,
        bezorgStatus: {},   // { stopId: 'bezorgd' | 'niet-thuis' }
        bezorgNotes:  {},   // { stopId: 'notitietekst' }
        bezorgStart:  null, // Date
        bezorgOrder:  [],   // geoptimaliseerde volgorde (array van stop-objecten)
        bezorgIdx:    0,    // huidig stop-index in compact scherm
        // Multi-bezorger
        courierCount: 1,
        courierRoutes: [],
        courierClusterLabels: null,
        activeCourier: 0,
    };

    // --- Map setup ---
    const map = L.map('map', {
        zoomControl: true,
        doubleClickZoom: false,
    }).setView([52.0907, 5.1214], 8); // Center on Netherlands

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(map);

    // --- DOM refs ---
    const addressInput = document.getElementById('address-input');
    const addBtn = document.getElementById('add-address-btn');
    const suggestionsEl = document.getElementById('suggestions');
    const stopsList = document.getElementById('stops-list');
    const stopCount = document.getElementById('stop-count');
    const optimizeBtn = document.getElementById('optimize-btn');
    const reverseBtn = document.getElementById('reverse-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const importBtn = document.getElementById('import-btn');
    const importModal = document.getElementById('import-modal');
    const importCancel = document.getElementById('import-cancel');
    const importConfirm = document.getElementById('import-confirm');
    const importTextarea = document.getElementById('import-textarea');
    const routeSummary = document.getElementById('route-summary');
    const totalDistance = document.getElementById('total-distance');
    const totalTime = document.getElementById('total-time');
    const totalStops = document.getElementById('total-stops');
    const routeSteps = document.getElementById('route-steps');
    const loadingOverlay = document.getElementById('loading-overlay');
    const modeCarBtn = document.getElementById('mode-car');
    const modeBikeBtn = document.getElementById('mode-bike');
    const modeWalkBtn = document.getElementById('mode-walk');
    const roundTripCheckbox = document.getElementById('round-trip');
    const copyRouteBtn   = document.getElementById('copy-route-btn');
    const mapsRouteBtns  = document.getElementById('maps-route-btns');
    const courierCountInput = document.getElementById('courier-count');
    const importFileInput   = document.getElementById('import-file');

    // --- Marker creation ---
    function createNumberedIcon(number, total) {
        let cls = 'custom-marker';
        if (number === 1) cls += ' start';
        else if (number === total) cls += ' end';
        return L.divIcon({
            className: '',
            html: `<div class="${cls}">${number}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -20],
        });
    }

    function createBezorgIcon(number, total, status, isCurrent) {
        // Huidige stop = grote druppel-pin met pointer naar locatie
        if (isCurrent) {
            return L.divIcon({
                className: '',
                html: `<div class="huidig-pin"><div class="huidig-pin-body">${number}</div></div>`,
                iconSize: [60, 78],
                iconAnchor: [30, 74],
                popupAnchor: [0, -70],
            });
        }
        let cls = 'custom-marker';
        if (status === 'bezorgd')         cls += ' bezorgd';
        else if (status === 'niet-thuis') cls += ' niet-thuis';
        else if (number === 1)            cls += ' start';
        else if (number === total)        cls += ' end';
        const inner = status === 'bezorgd' ? '&#10003;'
                    : status === 'niet-thuis' ? '&#10007;'
                    : number;
        return L.divIcon({
            className: '',
            html: `<div class="${cls}">${inner}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -20],
        });
    }

    function updateBezorgMarkers() {
        const order = state.bezorgOrder && state.bezorgOrder.length ? state.bezorgOrder : state.stops;
        const total = order.length;
        order.forEach((stop, i) => {
            if (!stop.marker) return;
            const status = state.bezorgStatus[stop.id];
            const isCurrent = i === state.bezorgIdx;
            stop.marker.setIcon(createBezorgIcon(i + 1, total, status, isCurrent));
            stop.marker.setZIndexOffset(isCurrent ? 1000 : (status ? 100 : 0));
        });
    }

    function addMarker(lat, lng, name) {
        // Gate: niet-ingelogde gebruikers max __freeAddressLimit stops
        if (!window.__isLoggedIn && state.stops.length >= (window.__freeAddressLimit || 10)) {
            const limit = window.__freeAddressLimit || 10;
            alert(`Je hebt het gratis limiet bereikt (${limit} adressen). Log in voor onbeperkt gebruik!`);
            const loginLink = document.getElementById('login-link');
            if (loginLink) {
                loginLink.style.background = '#dc3545';
                loginLink.textContent = '🔐 INLOGGEN VOOR MEER ADRESSEN';
            }
            return null;
        }

        const id = state.nextId++;
        const marker = L.marker([lat, lng], {
            icon: createNumberedIcon(state.stops.length + 1, state.stops.length + 1),
            draggable: false,
        }).addTo(map);

        marker.bindPopup(`<b>${name}</b>`);

        marker.on('dragend', function () {
            const pos = marker.getLatLng();
            const stop = state.stops.find(s => s.id === id);
            if (stop) {
                stop.lat = pos.lat;
                stop.lng = pos.lng;
                // Reverse geocode to update name
                reverseGeocode(pos.lat, pos.lng).then(newName => {
                    if (newName) {
                        stop.name = newName;
                        marker.setPopupContent(`<b>${newName}</b>`);
                        renderStopsList();
                    }
                });
                clearRoute();
            }
        });

        const stop = { id, name, lat, lng, marker };
        state.stops.push(stop);
        updateMarkerIcons();
        renderStopsList();
        updateButtons();
        fitMapToStops();
        clearRoute();
        return stop;
    }

    function removeStop(id) {
        const idx = state.stops.findIndex(s => s.id === id);
        if (idx === -1) return;
        state.stops[idx].marker.remove();
        state.stops.splice(idx, 1);
        updateMarkerIcons();
        renderStopsList();
        updateButtons();
        clearRoute();
    }

    function updateMarkerIcons() {
        const total = state.stops.length;
        state.stops.forEach((stop, i) => {
            stop.marker.setIcon(createNumberedIcon(i + 1, total));
        });
    }

    function fitMapToStops() {
        if (state.stops.length === 0) return;
        const bounds = L.latLngBounds(state.stops.map(s => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }

    // --- Stops list rendering ---
    function renderStopsList() {
        if (state.stops.length === 0) {
            stopsList.innerHTML = '<li class="empty-state">Klik op de kaart of zoek een adres om stops toe te voegen</li>';
            stopCount.textContent = '(0)';
            return;
        }

        stopCount.textContent = `(${state.stops.length})`;
        stopsList.innerHTML = '';

        state.stops.forEach((stop, i) => {
            const li = document.createElement('li');
            li.className = 'stop-item';
            li.dataset.id = stop.id;

            li.innerHTML = `
                <span class="stop-number">${i + 1}</span>
                <span class="stop-name" title="${escapeHtml(stop.name)}">${escapeHtml(stop.name)}</span>
                <button class="stop-remove" data-id="${stop.id}" title="Verwijder">&times;</button>
            `;

            // Click to zoom
            li.addEventListener('click', (e) => {
                if (e.target.classList.contains('stop-remove')) return;
                map.setView([stop.lat, stop.lng], 15);
                stop.marker.openPopup();
            });

            stopsList.appendChild(li);
        });

        // Remove buttons
        stopsList.querySelectorAll('.stop-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeStop(parseInt(btn.dataset.id));
            });
        });
    }

    // --- Drag & drop ---
    let draggedItem = null;

    function handleDragStart(e) {
        draggedItem = this;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDrop(e) {
        e.preventDefault();
        if (draggedItem === this) return;

        const fromId = parseInt(draggedItem.dataset.id);
        const toId = parseInt(this.dataset.id);
        const fromIdx = state.stops.findIndex(s => s.id === fromId);
        const toIdx = state.stops.findIndex(s => s.id === toId);

        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = state.stops.splice(fromIdx, 1);
        state.stops.splice(toIdx, 0, moved);

        updateMarkerIcons();
        renderStopsList();
        clearRoute();
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        draggedItem = null;
    }

    // --- Buttons ---
    function updateButtons() {
        const hasEnough = state.stops.length >= 2;
        optimizeBtn.disabled = !hasEnough;
        reverseBtn.disabled = !hasEnough;
    }

    // --- Geocoding (Nominatim) ---
    let searchTimeout = null;

    async function searchAddress(query) {
        if (query.length < 3) {
            suggestionsEl.innerHTML = '';
            return;
        }

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
            const res = await fetch(url, {
                headers: { 'Accept-Language': 'nl' }
            });
            const data = await res.json();

            suggestionsEl.innerHTML = '';
            data.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item.display_name;
                li.addEventListener('click', () => {
                    addMarker(parseFloat(item.lat), parseFloat(item.lon), item.display_name.split(',').slice(0, 3).join(','));
                    addressInput.value = '';
                    suggestionsEl.innerHTML = '';
                });
                suggestionsEl.appendChild(li);
            });
        } catch (err) {
            console.error('Geocoding error:', err);
        }
    }

    async function reverseGeocode(lat, lng) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
            const res = await fetch(url, {
                headers: { 'Accept-Language': 'nl' }
            });
            const data = await res.json();
            return data.display_name ? data.display_name.split(',').slice(0, 3).join(',') : null;
        } catch {
            return null;
        }
    }

    async function geocodeAddress(address) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=nl`;
            const res = await fetch(url, {
                headers: { 'Accept-Language': 'nl' }
            });
            const data = await res.json();
            if (data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    name: data[0].display_name.split(',').slice(0, 3).join(','),
                };
            }
            return null;
        } catch {
            return null;
        }
    }

    // --- Haversine helper ---
    function haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // --- BRouter: cycling & walking routing via brouter.de ---
    // BRouter uses OpenStreetMap data and supports footpaths, bike paths,
    // side streets, and pedestrian zones that OSRM driving ignores.
    function brouterProfile() {
        // Both cycling and walking use the same 'trekking' profile.
        // This ensures identical route geometry (same side streets, paths)
        // for both modes — only the speed/duration estimate differs.
        if (state.travelMode === 'cycling' || state.travelMode === 'foot') return 'trekking';
        return null;
    }

    // Walking uses same route as cycling but at walking speed (~5 km/h vs ~15 km/h)
    function adjustDurationForMode(duration) {
        if (state.travelMode === 'foot') return duration * 3; // ~15km/h → ~5km/h
        return duration;
    }

    // Get route between two points via BRouter (returns {distance, duration})
    async function brouterPairRoute(from, to, profile) {
        const lonlats = `${from.lng},${from.lat}|${to.lng},${to.lat}`;
        const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
        const res = await fetchWithTimeout(url, {}, 12000);
        if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);
        const data = await res.json();
        const feat = data.features[0];
        return {
            distance: parseFloat(feat.properties['track-length']),
            duration: adjustDurationForMode(parseFloat(feat.properties['total-time'])),
        };
    }

    // Build distance matrix via BRouter (pairwise routing)
    async function brouterDistanceMatrix(stops) {
        const n = stops.length;
        const distances = Array.from({ length: n }, () => new Array(n).fill(0));
        const durations = Array.from({ length: n }, () => new Array(n).fill(0));
        const profile = brouterProfile();

        // Build all pairs and fetch in parallel (with concurrency limit)
        const pairs = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j) pairs.push([i, j]);
            }
        }

        // Limit concurrency to avoid overwhelming BRouter
        const BATCH = 4;
        for (let b = 0; b < pairs.length; b += BATCH) {
            const batch = pairs.slice(b, b + BATCH);
            const results = await Promise.all(
                batch.map(([i, j]) => brouterPairRoute(stops[i], stops[j], profile))
            );
            batch.forEach(([i, j], idx) => {
                distances[i][j] = results[idx].distance;
                durations[i][j] = results[idx].duration;
            });
        }

        console.log(`Distance matrix: using BRouter profile "${profile}"`);
        return { distances, durations };
    }

    // Haversine fallback matrix (if all routing services fail)
    function buildHaversineMatrix(stops) {
        const n = stops.length;
        const distances = Array.from({ length: n }, () => new Array(n).fill(0));
        const durations = Array.from({ length: n }, () => new Array(n).fill(0));
        const speed = state.travelMode === 'cycling' ? 4.2
            : state.travelMode === 'foot' ? 1.4 : 11;
        const roadFactor = 1.35;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const d = haversineDistance(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng) * roadFactor;
                distances[i][j] = d;
                durations[i][j] = d / speed;
            }
        }
        return { distances, durations };
    }

    // --- Distance Matrix (BRouter for bike/foot, OSRM for driving) ---
    async function getDistanceMatrix(stops) {
        // For cycling/walking: always use Haversine for the matrix.
        // BRouter needs n*(n-1) individual requests which takes too long even for small sets.
        // BRouter is still used for the final route geometry (one request).
        if (brouterProfile()) {
            return buildHaversineMatrix(stops);
        }

        // OSRM for driving (or as fallback)
        const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
        try {
            const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;
            const res = await fetchWithTimeout(url, {}, 15000);
            const data = await res.json();
            if (data.code === 'Ok') {
                console.log('Distance matrix: using OSRM driving');
                return { durations: data.durations, distances: data.distances };
            }
        } catch (err) {
            console.warn('OSRM table failed:', err);
        }

        console.warn('All routing services failed, using Haversine fallback');
        return buildHaversineMatrix(stops);
    }

    // --- Route geometry (BRouter for bike/foot, OSRM for driving) ---
    async function getRoute(stops) {
        // For cycling/walking: use BRouter
        if (brouterProfile()) {
            try {
                const profile = brouterProfile();
                const lonlats = stops.map(s => `${s.lng},${s.lat}`).join('|');
                const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
                const res = await fetchWithTimeout(url, {}, 15000);
                if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);
                const data = await res.json();
                const feat = data.features[0];
                console.log(`Route geometry: using BRouter profile "${profile}"`);
                // Return in OSRM-compatible format
                return {
                    geometry: feat.geometry,
                    distance: parseFloat(feat.properties['track-length']),
                    duration: adjustDurationForMode(parseFloat(feat.properties['total-time'])),
                };
            } catch (err) {
                console.warn('BRouter route failed, trying OSRM fallback:', err);
            }
        }

        // OSRM for driving (or as fallback)
        const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const res = await fetchWithTimeout(url, {}, 15000);
        const data = await res.json();
        if (data.code !== 'Ok') {
            throw new Error('Kon geen route berekenen. Controleer je internetverbinding.');
        }
        console.log('Route geometry: using OSRM driving');
        return data.routes[0];
    }

    // ================================================================
    // TSP Solver — Production-grade route optimizer
    // Brute-force for ≤8 stops, multi-start NN + 2-opt + or-opt +
    // double-bridge perturbation for larger sets. Handles both open
    // and round-trip routes correctly.
    // ================================================================

    // --- Cost helpers ---

    function routeCost(order, dist, round) {
        let c = 0;
        for (let i = 0; i < order.length - 1; i++) c += dist[order[i]][order[i + 1]];
        if (round) c += dist[order[order.length - 1]][order[0]];
        return c;
    }

    // --- Brute-force for small n (≤ 8) ---

    function bruteForce(dist, n, round) {
        // Fix node 0 as start, permute the rest
        const rest = [];
        for (let i = 1; i < n; i++) rest.push(i);

        let bestCost = Infinity;
        let bestOrder = null;

        function permute(arr, l) {
            if (l === arr.length) {
                const order = [0, ...arr];
                const c = routeCost(order, dist, round);
                if (c < bestCost) {
                    bestCost = c;
                    bestOrder = [...order];
                }
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

    // --- Nearest Neighbor heuristic ---

    function nearestNeighbor(dist, n, startIdx) {
        const visited = new Set([startIdx]);
        const order = [startIdx];
        while (visited.size < n) {
            const cur = order[order.length - 1];
            let best = -1, bestD = Infinity;
            for (let i = 0; i < n; i++) {
                if (!visited.has(i) && dist[cur][i] < bestD) {
                    bestD = dist[cur][i];
                    best = i;
                }
            }
            visited.add(best);
            order.push(best);
        }
        return order;
    }

    // --- 2-opt (handles both open and round-trip correctly) ---

    function improve2Opt(order, dist, round) {
        const n = order.length;
        let improved = true;
        while (improved) {
            improved = false;
            // i = 1 keeps node 0 fixed as start
            for (let i = 1; i < n - 1; i++) {
                for (let j = i + 1; j < n; j++) {
                    let delta;
                    if (j === n - 1 && !round) {
                        // Open route, reversing tail: only one edge changes
                        // Before: edge(i-1 -> i)  After: edge(i-1 -> j)
                        delta = dist[order[i - 1]][order[j]] - dist[order[i - 1]][order[i]];
                    } else {
                        // Standard 2-opt: two edges change
                        const nextJ = (j + 1 < n) ? order[j + 1] : order[0]; // wraps for round trip
                        const before = dist[order[i - 1]][order[i]] + dist[order[j]][nextJ];
                        const after = dist[order[i - 1]][order[j]] + dist[order[i]][nextJ];
                        delta = after - before;
                    }
                    if (delta < -1e-6) {
                        // Reverse segment [i..j]
                        let lo = i, hi = j;
                        while (lo < hi) {
                            [order[lo], order[hi]] = [order[hi], order[lo]];
                            lo++; hi--;
                        }
                        improved = true;
                    }
                }
            }
        }
    }

    // --- Or-opt: relocate segments of length 1, 2, 3 ---

    function improveOrOpt(order, dist, round) {
        const n = order.length;
        let improved = true;
        while (improved) {
            improved = false;
            for (let segLen = 1; segLen <= Math.min(3, n - 2); segLen++) {
                for (let i = 1; i < n; i++) {
                    if (i + segLen > n) continue;
                    const endI = i + segLen - 1;

                    // Nodes around the removed segment
                    const prev = order[i - 1];
                    const segFirst = order[i];
                    const segLast = order[endI];
                    const hasNext = (endI + 1 < n);
                    const next = hasNext ? order[endI + 1] : (round ? order[0] : null);

                    // Cost of the two/one edges being removed by extraction
                    const removeCost = dist[prev][segFirst]
                        + (next !== null ? dist[segLast][next] : 0);
                    // Cost of the bridge after removal
                    const bridgeCost = (next !== null) ? dist[prev][next] : 0;
                    const removalGain = removeCost - bridgeCost;

                    // Try every insertion position (edge between j and j+1)
                    for (let j = 0; j < n; j++) {
                        // Skip positions that overlap with the segment
                        if (j >= i - 1 && j <= endI) continue;

                        const jNext = (j + 1 < n) ? order[j + 1] : (round ? order[0] : null);
                        if (jNext === null) continue;

                        const insertCost = dist[order[j]][segFirst] + dist[segLast][jNext]
                            - dist[order[j]][jNext];

                        if (insertCost - removalGain < -1e-6) {
                            // Perform move
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

    // --- Full local search: alternate 2-opt and or-opt until no improvement ---

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

    // --- Double-bridge perturbation (breaks out of local optima) ---

    function doubleBridge(order) {
        const n = order.length;
        if (n < 6) return [...order];

        // Pick 3 random cut points (keeping node 0 fixed)
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

        // Reconnect in a different order: seg1 + seg3 + seg2 + seg4
        return [...seg1, ...seg3, ...seg2, ...seg4];
    }

    // --- Normalize: ensure node 0 is at position 0 ---

    function normalizeOrder(order, dist, round) {
        const idx0 = order.indexOf(0);
        if (idx0 === 0) return order;

        if (round) {
            // Cycle: rotate so 0 is first (cost doesn't change)
            return [...order.slice(idx0), ...order.slice(0, idx0)];
        } else {
            // Open route: move 0 to front, re-optimize rest
            order.splice(idx0, 1);
            order.unshift(0);
            localSearch(order, dist, round);
            return order;
        }
    }

    // --- Main solver ---

    function solveTSP(distanceMatrix) {
        const n = distanceMatrix.length;
        const round = state.roundTrip;

        if (n <= 1) return [0];
        if (n === 2) return [0, 1];

        // Brute-force for small inputs — guarantees optimal result
        if (n <= 8) {
            return bruteForce(distanceMatrix, n, round);
        }

        // --- Larger inputs: multi-start NN + local search + perturbation ---

        let globalBest = null;
        let globalBestCost = Infinity;

        function tryCandidate(order) {
            // Always normalize so node 0 is first
            order = normalizeOrder(order, distanceMatrix, round);
            const cost = routeCost(order, distanceMatrix, round);
            if (cost < globalBestCost) {
                globalBestCost = cost;
                globalBest = [...order];
            }
        }

        // Phase 1: Multi-start nearest neighbor from every node
        for (let start = 0; start < n; start++) {
            const order = nearestNeighbor(distanceMatrix, n, start);
            localSearch(order, distanceMatrix, round);
            tryCandidate(order);

            // For round trips, also try the reverse direction
            if (round) {
                const rev = [order[0], ...order.slice(1).reverse()];
                localSearch(rev, distanceMatrix, round);
                tryCandidate(rev);
            }
        }

        // Phase 2: Perturbation — double-bridge kicks to escape local optima
        const kicks = n <= 20 ? 200 : (n <= 50 ? 150 : (n <= 150 ? 200 : 60));
        for (let k = 0; k < kicks; k++) {
            const order = doubleBridge([...globalBest]);
            localSearch(order, distanceMatrix, round);
            tryCandidate(order);
        }

        return globalBest;
    }

    // --- Web Worker wrapper voor TSP (geen UI-bevriezing) ---
    function solveTSPAsync(distances, roundTrip) {
        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker('tsp-worker.js');
                worker.onmessage = e => { worker.terminate(); resolve(e.data.order); };
                worker.onerror = e => { worker.terminate(); reject(e); };
                worker.postMessage({ distances, roundTrip });
            } catch (e) {
                // Fallback als Web Workers niet beschikbaar zijn
                resolve(solveTSP(distances));
            }
        });
    }

    // --- Grote routes: clustering + per-cluster TSP ---
    async function optimizeWithClustering(routingStops) {
        const k = clusterCount(routingStops.length);
        // Voeg tijdelijke _origIdx toe om originele indices te bewaren
        const stopsWithIdx = routingStops.map((s, i) => ({ ...s, _origIdx: i }));
        const clusters = splitIntoClusters(stopsWithIdx, k);
        const orderedClusters = orderClusters(clusters);

        const globalOrder = [];
        const clusterLabelsArr = [];
        let clusterIdx = 0;

        for (const cluster of orderedClusters) {
            const origIndices = cluster.map(s => s._origIdx);
            const clusterStops = origIndices.map(i => routingStops[i]);
            const matrix = await getDistanceMatrix(clusterStops);
            const localOrder = await solveTSPAsync(matrix.durations, state.roundTrip);
            for (const localIdx of localOrder) {
                globalOrder.push(origIndices[localIdx]);
                clusterLabelsArr.push(clusterIdx);
            }
            clusterIdx++;
        }
        return { order: globalOrder, clusterLabels: clusterLabelsArr };
    }

    // --- Bezorger-routes weergeven in samenvatting ---
    // --- Route optimization ---

    // Parse Dutch address into street name + house number
    function parseAddress(name) {
        // Match patterns like "Lavendel 63", "Vijverlaan 640a", "De Brink 12"
        const match = name.match(/^(.+?)\s+(\d+)/);
        if (!match) return null;
        return {
            street: match[1].toLowerCase().trim(),
            number: parseInt(match[2]),
            isOdd: parseInt(match[2]) % 2 === 1,
        };
    }

    // --- Mailbox position detection via Overpass API ---
    // Queries OpenStreetMap for buildings and nearby paths to determine
    // whether mailboxes on each street are at the front (street side)
    // or back (footpath/alley side) of the houses.
    async function findDeliveryWaypoints(stops) {
        const parsed = stops.map(s => parseAddress(s.name));

        // Bounding box around all stops with ~200m padding
        const lats = stops.map(s => s.lat);
        const lngs = stops.map(s => s.lng);
        const pad = 0.002;
        const bbox = [
            Math.min(...lats) - pad, Math.min(...lngs) - pad,
            Math.max(...lats) + pad, Math.max(...lngs) + pad
        ].join(',');

        // Single Overpass query: all buildings + all walkable paths
        const query = `[out:json][timeout:15];(way["building"](${bbox});way["highway"](${bbox}););out geom;`;
        const res = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query)
        }, 18000);
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        const osm = await res.json();

        const buildings = osm.elements.filter(e => e.tags?.building && e.geometry);
        const highways = osm.elements.filter(e => e.tags?.highway && e.geometry);
        const footways = highways.filter(h =>
            ['footway', 'path', 'pedestrian', 'service', 'cycleway'].includes(h.tags.highway)
        );

        // Helper: minimum distance from a point to a way's geometry
        function minDistToWay(lat, lng, way) {
            let min = Infinity;
            let closest = null;
            for (const node of way.geometry) {
                const d = haversineDistance(lat, lng, node.lat, node.lon);
                if (d < min) { min = d; closest = node; }
            }
            return { dist: min, point: closest };
        }

        // For each stop: find its building, the named street, and any back path
        const perStop = stops.map((stop, i) => {
            const addr = parsed[i];
            if (!addr) return { lat: stop.lat, lng: stop.lng, side: null };

            // Find nearest building
            let bestBDist = Infinity, bestBuilding = null;
            for (const b of buildings) {
                for (const node of b.geometry) {
                    const d = haversineDistance(stop.lat, stop.lng, node.lat, node.lon);
                    if (d < bestBDist) { bestBDist = d; bestBuilding = b; }
                }
            }
            if (!bestBuilding || bestBDist > 40) {
                return { lat: stop.lat, lng: stop.lng, side: null };
            }

            // Building centroid
            const cx = bestBuilding.geometry.reduce((s, n) => s + n.lat, 0) / bestBuilding.geometry.length;
            const cy = bestBuilding.geometry.reduce((s, n) => s + n.lon, 0) / bestBuilding.geometry.length;

            // Find the named street (matching the address)
            const namedStreet = highways.find(h =>
                h.tags?.name && h.tags.name.toLowerCase().includes(addr.street)
            );

            // Distance from building centroid to named street
            const toStreet = namedStreet ? minDistToWay(cx, cy, namedStreet) : { dist: Infinity, point: null };

            // Find nearest footway that is NOT the named street
            let bestFP = { dist: Infinity, point: null, way: null };
            for (const fp of footways) {
                if (namedStreet && fp.id === namedStreet.id) continue;
                const r = minDistToWay(cx, cy, fp);
                if (r.dist < bestFP.dist) {
                    bestFP = { ...r, way: fp };
                }
            }

            // Decision: if a footpath is significantly closer to the building
            // than the named street, mailbox is likely on the footpath side (back)
            if (bestFP.point && bestFP.dist < toStreet.dist * 0.7 && bestFP.dist < 25) {
                // Snap to the point ON the footpath (not the building!)
                // so BRouter can route along it
                return {
                    lat: bestFP.point.lat, lng: bestFP.point.lon,
                    side: 'achterkant',
                    pathType: bestFP.way.tags?.highway || 'pad',
                };
            }

            // Otherwise: mailbox at front (named street side)
            // Keep the original geocoded position — it's already on the street
            return { lat: stop.lat, lng: stop.lng, side: 'voorkant' };
        });

        // Per-street majority decision: if most buildings on a street have
        // mailboxes at the back, apply that to ALL buildings on that street
        const streetGroups = {};
        perStop.forEach((wp, i) => {
            const addr = parsed[i];
            if (!addr || !wp.side) return;
            if (!streetGroups[addr.street]) streetGroups[addr.street] = [];
            streetGroups[addr.street].push(i);
        });

        for (const [streetName, indices] of Object.entries(streetGroups)) {
            const back = indices.filter(i => perStop[i].side === 'achterkant').length;
            const front = indices.filter(i => perStop[i].side === 'voorkant').length;
            const majority = back > front ? 'achterkant' : 'voorkant';

            // Apply majority decision to all stops on this street
            for (const i of indices) {
                perStop[i].streetSide = majority;

                // If majority is "voorkant" but this stop was detected as "achterkant",
                // revert to original geocoded position (on the main street)
                if (majority === 'voorkant' && perStop[i].side === 'achterkant') {
                    perStop[i].lat = stops[i].lat;
                    perStop[i].lng = stops[i].lng;
                }
            }

            console.log(`Straat "${streetName}": brievenbussen aan de ${majority} (${front} voor, ${back} achter)`);
        }

        return perStop;
    }

    async function optimizeRoute() {
        if (state.stops.length < 2) return;

        showLoading(true);

        try {
            // Detect mailbox positions using OpenStreetMap building data
            let deliveryPoints = null;
            if (state.travelMode !== 'driving') {
                try {
                    deliveryPoints = await findDeliveryWaypoints(state.stops);
                    console.log('Delivery waypoints:', deliveryPoints.map((w, i) =>
                        `${state.stops[i].name}: ${w.streetSide || w.side || 'onbekend'}`
                    ));
                } catch (err) {
                    console.warn('Mailbox detection failed, using original positions:', err);
                }
            }

            // Build routing stops: use delivery waypoints if available
            const routingStops = deliveryPoints
                ? state.stops.map((s, i) => ({
                    ...s,
                    lat: deliveryPoints[i].lat,
                    lng: deliveryPoints[i].lng,
                }))
                : state.stops;

            // Kies optimalisatiestrategie op basis van aantal stops
            let optimalOrder, matrix, clusterLabels;
            if (state.stops.length > 150) {
                // Zeer grote route (>150): clusteren om worker-tijd te beperken
                const result = await optimizeWithClustering(routingStops);
                optimalOrder = result.order;
                clusterLabels = result.clusterLabels;
                matrix = buildHaversineMatrix(routingStops);
            } else {
                // Kleine route: directe matrix + TSP via web worker
                matrix = await getDistanceMatrix(routingStops);
                optimalOrder = await solveTSPAsync(matrix.durations, state.roundTrip);
                clusterLabels = null;
            }
            state.courierClusterLabels = clusterLabels;

            // Reorder stops and delivery points together
            const reordered = optimalOrder.map(i => state.stops[i]);
            const reorderedDP = deliveryPoints
                ? optimalOrder.map(i => deliveryPoints[i])
                : null;
            state.stops = reordered;

            // Splitsing over meerdere bezorgers
            const courierCount = courierCountInput ? (parseInt(courierCountInput.value) || 1) : 1;
            state.courierCount = courierCount;
            if (courierCount > 1) {
                state.courierRoutes = splitRouteAmongCouriers(state.stops, courierCount, state.courierClusterLabels);
            } else {
                state.courierRoutes = [];
            }

            updateMarkerIcons();
            renderStopsList();

            // Build waypoints for route using delivery-side positions
            let routeStops = reorderedDP
                ? state.stops.map((s, i) => ({
                    ...s, lat: reorderedDP[i].lat, lng: reorderedDP[i].lng,
                }))
                : [...state.stops];
            if (state.roundTrip && state.stops.length >= 2) {
                routeStops.push({ ...routeStops[0] });
            }

            // Get actual route geometry
            const route = await getRoute(routeStops);

            drawRoute(route);
            showRouteSummary(route, matrix, optimalOrder, reorderedDP);
            fitMapToStops();
            state.optimized = true;
        } catch (err) {
            console.error('Optimization error:', err);
            alert('Er is een fout opgetreden bij het optimaliseren van de route. Probeer het opnieuw.');
        } finally {
            showLoading(false);
        }
    }

    // --- Draw route on map ---
    function drawRoute(route) {
        clearRouteLine();

        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

        state.routeLine = L.polyline(coords, {
            color: '#4361ee',
            weight: 5,
            opacity: 0.8,
        }).addTo(map);
    }

    function clearRouteLine() {
        if (state.routeLine) {
            state.routeLine.remove();
            state.routeLine = null;
        }
    }

    function clearRoute() {
        clearRouteLine();
        routeSummary.classList.add('hidden');
        state.optimized = false;
    }

    async function drawRouteFromStops() {
        if (state.stops.length < 2) return;
        try {
            const routeStops = state.stops.map(s => [s.lat, s.lng]);
            const route = await getRoute(routeStops);
            drawRoute(route);
        } catch (err) {
            console.error('Fout bij het tekenen van route:', err);
        }
    }

    // --- Route summary ---
    function showRouteSummary(route, matrix, order, deliveryPoints) {
        state._lastRouteArgs = [route, matrix, order, deliveryPoints];
        const distKm = (route.distance / 1000).toFixed(1);
        const durMin = Math.round(route.duration / 60);
        const hours = Math.floor(durMin / 60);
        const mins = durMin % 60;

        totalDistance.textContent = `${distKm} km`;
        totalTime.textContent = hours > 0 ? `${hours}u ${mins}m` : `${mins} min`;
        totalStops.textContent = state.stops.length;

        // Build step-by-step
        routeSteps.innerHTML = '';
        state.stops.forEach((stop, i) => {
            const div = document.createElement('div');
            div.className = 'route-step';

            let distText = '';
            if (i > 0) {
                const prevIdx = order[i - 1];
                const curIdx = order[i];
                const segDist = (matrix.distances[prevIdx][curIdx] / 1000).toFixed(1);
                const segDur = Math.round(matrix.durations[prevIdx][curIdx] / 60);
                distText = `${segDist} km / ${segDur} min`;
            } else {
                distText = 'Start';
            }

            // Show mailbox side indicator (voorkant/achterkant)
            let sideBadge = '';
            if (deliveryPoints && deliveryPoints[i] && deliveryPoints[i].streetSide) {
                const side = deliveryPoints[i].streetSide;
                const isBack = side === 'achterkant';
                sideBadge = `<span class="step-side ${isBack ? 'side-back' : 'side-front'}" ` +
                    `title="Brievenbus aan de ${side}">${isBack ? 'A' : 'V'}</span>`;
            }

            div.innerHTML = `
                <span class="step-number">${i + 1}</span>
                ${sideBadge}
                <span class="step-info">${escapeHtml(stop.name)}</span>
                <span class="step-distance">${distText}</span>
            `;

            // Bezorg-modus: afvink-knoppen per stap
            if (state.bezorgModus) {
                const status = state.bezorgStatus[stop.id];
                if (status === 'bezorgd')    div.classList.add('stap-bezorgd');
                if (status === 'niet-thuis') div.classList.add('stap-niet-thuis');

                const acties = document.createElement('div');
                acties.className = 'bezorg-actie-btns';

                const btnOk = document.createElement('button');
                btnOk.className = 'bz-ok' + (status === 'bezorgd' ? ' actief' : '');
                btnOk.textContent = '✓';
                btnOk.title = 'Bezorgd';
                btnOk.addEventListener('click', () => setBezorgStatus(stop.id, 'bezorgd'));

                const btnNt = document.createElement('button');
                btnNt.className = 'bz-nt' + (status === 'niet-thuis' ? ' actief' : '');
                btnNt.textContent = '✗';
                btnNt.title = 'Niet thuis';
                btnNt.addEventListener('click', () => setBezorgStatus(stop.id, 'niet-thuis'));

                const btnNote = document.createElement('button');
                btnNote.className = 'bz-note';
                btnNote.textContent = '📝';
                btnNote.title = 'Notitie';
                btnNote.addEventListener('click', () => {
                    const note = prompt('Notitie voor dit adres:', state.bezorgNotes[stop.id] || '');
                    if (note !== null) { state.bezorgNotes[stop.id] = note.trim(); herenderBezorg(); }
                });

                acties.appendChild(btnOk);
                acties.appendChild(btnNt);
                acties.appendChild(btnNote);
                div.appendChild(acties);

                if (state.bezorgNotes[stop.id]) {
                    const noteEl = document.createElement('div');
                    noteEl.className = 'bezorg-note-tekst';
                    noteEl.textContent = '📝 ' + state.bezorgNotes[stop.id];
                    div.appendChild(noteEl);
                }
            }

            routeSteps.appendChild(div);
        });

        // Add return step for round trip
        if (state.roundTrip && state.stops.length >= 2) {
            const lastIdx = order[order.length - 1];
            const firstIdx = order[0];
            const segDist = (matrix.distances[lastIdx][firstIdx] / 1000).toFixed(1);
            const segDur = Math.round(matrix.durations[lastIdx][firstIdx] / 60);

            const div = document.createElement('div');
            div.className = 'route-step';
            div.innerHTML = `
                <span class="step-number">&#8634;</span>
                <span class="step-info">Terug naar: ${escapeHtml(state.stops[0].name)}</span>
                <span class="step-distance">${segDist} km / ${segDur} min</span>
            `;
            routeSteps.appendChild(div);
        }

        routeSummary.classList.remove('hidden');
        renderMapsButtons();
        renderCourierRoutes();

        // Bezorg-modus: sla volgorde op en toon Start-knop
        state.bezorgOrder = state.stops.slice();
        const _bezorgBtn = document.getElementById('bezorg-btn');
        if (_bezorgBtn && !state.bezorgModus) {
            _bezorgBtn.style.display = state.courierRoutes.length > 1 ? 'none' : '';
        }
    }

    // --- Loading ---
    function showLoading(show) {
        loadingOverlay.classList.toggle('hidden', !show);
    }

    // --- Utilities ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDuration(seconds) {
        const mins = Math.round(seconds / 60);
        const hours = Math.floor(mins / 60);
        const remainMins = mins % 60;
        if (hours > 0) return `${hours}u ${remainMins}m`;
        return `${mins} min`;
    }

    // --- Event listeners ---

    // Address search with debounce
    addressInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchAddress(addressInput.value.trim());
        }, 400);
    });

    addressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = addressInput.value.trim();
            if (query) {
                geocodeAddress(query).then(result => {
                    if (result) {
                        addMarker(result.lat, result.lng, result.name);
                        addressInput.value = '';
                        suggestionsEl.innerHTML = '';
                    } else {
                        alert('Adres niet gevonden. Probeer een ander adres.');
                    }
                });
            }
        }
    });

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-section')) {
            suggestionsEl.innerHTML = '';
        }
    });

    // Check if user can add more addresses (limit for non-logged-in users)
    function canAddAddress() {
        if (window.__isLoggedIn) return true; // Logged-in users: unlimited

        // Non-logged-in users: 10 address limit
        if (state.stops.length >= window.__freeAddressLimit) {
            const message = `Je hebt het gratis limiet bereikt (${window.__freeAddressLimit} adressen). Log in voor onbeperkt gebruik!`;
            alert(message);

            // Add login prompt to UI
            const loginLink = document.getElementById('login-link');
            if (loginLink) {
                loginLink.style.background = '#dc3545';
                loginLink.textContent = '🔐 INLOGGEN VOOR MEER ADRESSEN';
            }
            return false;
        }

        // Show remaining addresses for guest users
        const remaining = window.__freeAddressLimit - state.stops.length;
        if (remaining <= 3) {
            console.info(`${remaining} gratis adressen resterend`);
        }
        return true;
    }

    addBtn.addEventListener('click', () => {
        if (!canAddAddress()) return;

        const query = addressInput.value.trim();
        if (query) {
            geocodeAddress(query).then(result => {
                if (result) {
                    addMarker(result.lat, result.lng, result.name);
                    addressInput.value = '';
                    suggestionsEl.innerHTML = '';
                } else {
                    alert('Adres niet gevonden.');
                }
            });
        }
    });

    // Double-click on map to add stop
    map.on('dblclick', async (e) => {
        if (!canAddAddress()) return;

        const { lat, lng } = e.latlng;
        const name = await reverseGeocode(lat, lng) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        addMarker(lat, lng, name);
    });

    // Travel mode toggle
    const modeBtns = [modeCarBtn, modeBikeBtn, modeWalkBtn];
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.travelMode = btn.dataset.mode;
            clearRoute();
        });
    });

    // Round trip toggle
    roundTripCheckbox.addEventListener('change', () => {
        state.roundTrip = roundTripCheckbox.checked;
        clearRoute();
    });

    // Optimize
    optimizeBtn.addEventListener('click', optimizeRoute);

    // Reverse route
    reverseBtn.addEventListener('click', () => {
        state.stops.reverse();
        updateMarkerIcons();
        renderStopsList();
        clearRoute();
    });

    // Clear all
    clearAllBtn.addEventListener('click', () => {
        if (state.stops.length === 0) return;
        if (!confirm('Weet je zeker dat je alle stops wilt verwijderen?')) return;
        state.stops.forEach(s => s.marker.remove());
        state.stops = [];
        state.nextId = 1;
        updateMarkerIcons();
        renderStopsList();
        updateButtons();
        clearRoute();
    });

    // Google Maps navigatie
    function buildGoogleMapsUrls(stops, travelMode) {
        const mode = { auto: 'driving', fiets: 'bicycling', lopen: 'walking' }[travelMode] || 'driving';
        const coords = stops.map(s => `${s.lat},${s.lng}`);
        const CHUNK = 11; // origin + max 9 waypoints + destination
        const urls = [];
        for (let i = 0; i < coords.length; i += CHUNK - 1) {
            const chunk = coords.slice(i, i + CHUNK);
            if (chunk.length < 2) break;
            const origin = chunk[0];
            const dest   = chunk[chunk.length - 1];
            const mid    = chunk.slice(1, -1);
            let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=${mode}`;
            if (mid.length) url += `&waypoints=${mid.join('|')}`;
            urls.push(url);
        }
        return urls;
    }

    function renderMapsButtons() {
        mapsRouteBtns.innerHTML = '';
        if (state.stops.length < 2) return;

        const urls = buildGoogleMapsUrls(state.stops, state.travelMode);
        state.currentEtappe = 0;

        const btn   = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.style.cssText = 'width:100%; margin-top:8px; padding: 10px 12px;';

        const label = document.createElement('div');
        const sub   = document.createElement('small');
        sub.style.cssText = 'display:block; opacity:0.7; font-size:11px; margin-top:2px;';
        btn.appendChild(label);
        btn.appendChild(sub);

        function updateBtn() {
            const idx   = state.currentEtappe;
            const total = urls.length;
            if (total === 1) {
                label.textContent = '🗺️ Navigeer in Google Maps';
                sub.textContent   = '';
            } else if (idx === 0) {
                label.textContent = `🗺️ Start navigatie — etappe 1 / ${total}`;
                sub.textContent   = `${state.stops.length} stops verdeeld in ${total} etappes`;
            } else if (idx < total) {
                label.textContent = `✅ Etappe ${idx} / ${total} klaar → naar etappe ${idx + 1}`;
                sub.textContent   = `Stops ${idx * 10 + 1}–${Math.min((idx + 1) * 10, state.stops.length)}`;
            } else {
                label.textContent = '🏁 Route voltooid! Opnieuw starten';
                sub.textContent   = '';
            }
        }

        updateBtn();

        btn.addEventListener('click', () => {
            const idx = state.currentEtappe >= urls.length ? 0 : state.currentEtappe;
            window.open(urls[idx], '_blank');
            state.currentEtappe = idx >= urls.length - 1 ? urls.length : idx + 1;
            updateBtn();
        });

        mapsRouteBtns.appendChild(btn);
    }

    // Copy route list
    copyRouteBtn.addEventListener('click', () => {
        if (state.stops.length === 0) return;
        const lines = state.stops.map((stop, i) => `${i + 1}. ${stop.name}`);
        if (state.roundTrip && state.stops.length >= 2) {
            lines.push(`${state.stops.length + 1}. ${state.stops[0].name} (terug)`);
        }
        const text = lines.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            const original = copyRouteBtn.textContent;
            copyRouteBtn.textContent = '\u2705 Gekopieerd!';
            setTimeout(() => { copyRouteBtn.textContent = original; }, 2000);
        });
    });

    // Print route
    document.getElementById('print-route-btn').addEventListener('click', () => window.print());

    // ===== BEZORG-MODUS =====
    const bezorgBtn      = document.getElementById('bezorg-btn');
    const bezorgStopBtn  = document.getElementById('bezorg-stop-btn');
    const bezorgProgress = document.getElementById('bezorg-progress');
    const bezorgCounter  = document.getElementById('bezorg-counter');
    const bezorgTimer    = document.getElementById('bezorg-timer');
    const bezorgBar      = document.getElementById('bezorg-bar');
    const bezorgScherm   = document.getElementById('bezorg-scherm');
    const eindModal      = document.getElementById('eind-modal');
    let timerInterval    = null;

    function updateBezorgCounter() {
        const totaal    = state.stops.length;
        const bezorgd   = Object.values(state.bezorgStatus).filter(s => s === 'bezorgd').length;
        const nietThuis = Object.values(state.bezorgStatus).filter(s => s === 'niet-thuis').length;
        const pct = totaal > 0 ? Math.round(bezorgd / totaal * 100) : 0;
        bezorgCounter.textContent = `${bezorgd} / ${totaal} bezorgd${nietThuis ? `  ·  ${nietThuis} niet thuis` : ''}`;
        bezorgBar.style.width = pct + '%';
        if (state.bezorgStart) {
            const min = Math.floor((Date.now() - state.bezorgStart) / 60000);
            bezorgTimer.textContent = `Onderweg: ${min} min`;
        }
        // Zelfde voor compact scherm
        document.getElementById('bs-counter').textContent = bezorgCounter.textContent;
        document.getElementById('bs-bar').style.width = pct + '%';
        if (state.bezorgStart) document.getElementById('bs-timer').textContent = bezorgTimer.textContent;
    }

    function herenderBezorg() {
        // Herrender route-steps zodat statussen bijgewerkt zijn
        if (state._lastRouteArgs) showRouteSummary(...state._lastRouteArgs);
        updateBezorgCounter();
        updateBezorgMarkers();
        updateBsScherm();
        // Controleer of alle stops een status hebben → eindsamenvatting
        const totaal = state.stops.length;
        const afgehandeld = Object.values(state.bezorgStatus).filter(Boolean).length;
        if (totaal > 0 && afgehandeld === totaal) toonEindSamenvatting();
    }

    function setBezorgStatus(stopId, status) {
        state.bezorgStatus[stopId] = state.bezorgStatus[stopId] === status ? null : status;
        herenderBezorg();
    }

    function startBezorgModus() {
        state.bezorgModus  = true;
        state.bezorgStart  = Date.now();
        state.bezorgStatus = {};
        state.bezorgNotes  = {};
        state.bezorgIdx    = 0;
        bezorgBtn.style.display     = 'none';
        bezorgStopBtn.style.display = '';
        bezorgProgress.classList.remove('hidden');
        timerInterval = setInterval(updateBezorgCounter, 60000);
        herenderBezorg();
        document.getElementById('sidebar').style.display = 'none';
        bezorgScherm.classList.remove('hidden');
        map.invalidateSize();
        updateBsScherm();
    }

    bezorgBtn.addEventListener('click', () => {
        state.bezorgOrder = state.stops.slice();
        state.activeCourier = 0;
        startBezorgModus();
    });

    bezorgStopBtn.addEventListener('click', () => {
        if (!confirm('Bezorging stoppen?')) return;
        stopBezorgModus();
    });

    function stopBezorgModus() {
        state.bezorgModus  = false;
        state.bezorgStart  = null;
        state.bezorgStatus = {};
        state.bezorgNotes  = {};
        clearInterval(timerInterval);
        bezorgBtn.style.display     = '';
        bezorgStopBtn.style.display = 'none';
        bezorgProgress.classList.add('hidden');
        bezorgScherm.classList.add('hidden');
        document.getElementById('sidebar').style.display = '';
        map.invalidateSize();
        updateMarkerIcons();
        if (state._lastRouteArgs) showRouteSummary(...state._lastRouteArgs);
    }

    // Compact fullscreen bezorgscherm
    function updateBsScherm() {
        const stops  = state.bezorgOrder;
        if (!stops.length) return;
        const idx    = Math.max(0, Math.min(state.bezorgIdx, stops.length - 1));
        state.bezorgIdx = idx;
        const stop   = stops[idx];
        const status = state.bezorgStatus[stop.id];
        document.getElementById('bs-idx').textContent = `stop ${idx + 1} / ${stops.length}`;
        document.getElementById('bs-adres').textContent = stop.name;
        document.getElementById('bs-bezorgd').className   = status === 'bezorgd'    ? 'actief' : '';
        document.getElementById('bs-niet-thuis').className = status === 'niet-thuis' ? 'actief' : '';
        document.getElementById('bs-note-text').textContent = state.bezorgNotes[stop.id]
            ? '📝 ' + state.bezorgNotes[stop.id] : '';

        // Markers bijwerken: huidige stop uitlichten
        updateBezorgMarkers();

        // Toon huidige stop op kaart, gecentreerd in zichtbare deel boven bezorgpaneel
        if (stop.lat && stop.lng) {
            const targetZoom = 16;
            const bezorgEl = document.getElementById('bezorg-scherm');
            const panelH = bezorgEl ? bezorgEl.offsetHeight : 280;
            // Zorg dat map de juiste grootte heeft
            map.invalidateSize();
            // Bereken offset zodat marker in midden van zichtbare gebied (boven paneel) komt
            const targetPoint = map.project([stop.lat, stop.lng], targetZoom);
            targetPoint.y += panelH / 2;
            const adjustedCenter = map.unproject(targetPoint, targetZoom);
            map.setView(adjustedCenter, targetZoom, { animate: true, duration: 0.6 });
        }
    }

    document.getElementById('bs-prev').addEventListener('click', () => {
        state.bezorgIdx = Math.max(0, state.bezorgIdx - 1);
        updateBsScherm();
    });
    document.getElementById('bs-next').addEventListener('click', () => {
        state.bezorgIdx = Math.min(state.bezorgOrder.length - 1, state.bezorgIdx + 1);
        updateBsScherm();
    });
    document.getElementById('bs-bezorgd').addEventListener('click', () => {
        const stop = state.bezorgOrder[state.bezorgIdx];
        if (stop) { setBezorgStatus(stop.id, 'bezorgd'); autoAdvance(); }
    });
    document.getElementById('bs-niet-thuis').addEventListener('click', () => {
        const stop = state.bezorgOrder[state.bezorgIdx];
        if (stop) { setBezorgStatus(stop.id, 'niet-thuis'); autoAdvance(); }
    });
    document.getElementById('bs-notitie').addEventListener('click', () => {
        const stop = state.bezorgOrder[state.bezorgIdx];
        if (!stop) return;
        const note = prompt('Notitie:', state.bezorgNotes[stop.id] || '');
        if (note !== null) { state.bezorgNotes[stop.id] = note.trim(); updateBsScherm(); }
    });
    document.getElementById('bs-sluiten').addEventListener('click', () => {
        bezorgScherm.classList.add('hidden');
    });
    // Terug naar compact scherm vanuit routelijst
    bezorgProgress.addEventListener('click', () => {
        if (state.bezorgModus) { bezorgScherm.classList.remove('hidden'); updateBsScherm(); }
    });
    bezorgProgress.style.cursor = 'pointer';
    bezorgProgress.title = 'Klik om bezorgscherm te openen';

    function autoAdvance() {
        // Ga automatisch naar volgende stop zonder status (wrap-around)
        const stops = state.bezorgOrder;
        if (!stops.length) { updateBsScherm(); return; }
        const startIdx = state.bezorgIdx;
        // Vooruit zoeken
        for (let i = startIdx + 1; i < stops.length; i++) {
            if (!state.bezorgStatus[stops[i].id]) {
                state.bezorgIdx = i;
                updateBsScherm();
                return;
            }
        }
        // Wrap-around: vanaf begin tot huidige
        for (let i = 0; i < startIdx; i++) {
            if (!state.bezorgStatus[stops[i].id]) {
                state.bezorgIdx = i;
                updateBsScherm();
                return;
            }
        }
        // Alles afgehandeld — herenderBezorg heeft eindsamenvatting al getoond
        updateBsScherm();
    }

    // Swipe links/rechts op compact scherm
    let touchStartX = 0;
    bezorgScherm.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    bezorgScherm.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
            state.bezorgIdx = dx < 0
                ? Math.min(state.bezorgOrder.length - 1, state.bezorgIdx + 1)
                : Math.max(0, state.bezorgIdx - 1);
            updateBsScherm();
        }
    });

    // Eindsamenvatting
    function toonEindSamenvatting() {
        const totaal    = state.stops.length;
        const bezorgd   = Object.values(state.bezorgStatus).filter(s => s === 'bezorgd').length;
        const nietThuis = state.bezorgOrder.filter(s => state.bezorgStatus[s.id] === 'niet-thuis');
        const minuten   = state.bezorgStart ? Math.floor((Date.now() - state.bezorgStart) / 60000) : 0;
        const uur = Math.floor(minuten / 60), min = minuten % 60;
        const tijdTekst = uur > 0 ? `${uur}u ${min}min` : `${min} min`;

        document.getElementById('eind-stats').innerHTML =
            `<p>✅ <strong>Bezorgd:</strong> ${bezorgd} van ${totaal}</p>` +
            `<p>⏱️ <strong>Tijd:</strong> ${tijdTekst}</p>`;

        const ntEl = document.getElementById('eind-niet-thuis');
        if (nietThuis.length) {
            ntEl.innerHTML = `<p><strong>❌ Niet thuis (${nietThuis.length}):</strong></p>` +
                nietThuis.map(s => `<p style="margin:2px 0 2px 12px;">• ${escapeHtml(s.name)}</p>`).join('');
        } else {
            ntEl.innerHTML = '<p style="color:#10b981;">🎉 Alles bezorgd!</p>';
        }
        bezorgScherm.classList.add('hidden');
        eindModal.classList.remove('hidden');
    }

    document.getElementById('eind-kopieer').addEventListener('click', () => {
        const nietThuis = state.bezorgOrder.filter(s => state.bezorgStatus[s.id] === 'niet-thuis');
        const tekst = 'NIET THUIS:\n' + (nietThuis.length
            ? nietThuis.map(s => '• ' + s.name).join('\n')
            : 'Geen');
        navigator.clipboard.writeText(tekst);
    });
    document.getElementById('eind-sluiten').addEventListener('click', () => {
        eindModal.classList.add('hidden');
        stopBezorgModus();
    });

    // Route opslaan & laden
    const savedRoutesSelect = document.getElementById('saved-routes-select');

    function getSavedRoutes() {
        return JSON.parse(localStorage.getItem('savedRoutes') || '{}');
    }

    function updateSavedRoutesSelect() {
        const routes = getSavedRoutes();
        const current = savedRoutesSelect.value;
        savedRoutesSelect.innerHTML = '<option value="">— Opgeslagen routes —</option>';
        Object.values(routes).forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.naam;
            const routeType = r.isOptimized ? '🔄 Route' : '📍 Adressen';
            const distance = r.isOptimized ? ` / ${(r.distance / 1000).toFixed(1)}km` : '';
            opt.textContent = `${routeType} — ${r.naam} (${r.stops.length} stops${distance}, ${r.opgeslagenOp})`;
            savedRoutesSelect.appendChild(opt);
        });
        if (current) savedRoutesSelect.value = current;
    }

    document.getElementById('save-route-btn').addEventListener('click', () => {
        if (state.stops.length === 0) return alert('Voeg eerst stops toe.');
        const naam = prompt('Naam voor deze route:', 'Mijn route');
        if (!naam || !naam.trim()) return;
        const routes = getSavedRoutes();
        const routeData = {
            naam: naam.trim(),
            stops: state.stops.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })),
            travelMode: state.travelMode,
            opgeslagenOp: new Date().toLocaleDateString('nl-NL'),
            roundTrip: state.roundTrip,
            courierCount: state.courierCount,
        };

        // Sla ook routegegevens op als de route is geoptimaliseerd
        if (state.optimized && state._lastRouteArgs) {
            const [route, matrix] = state._lastRouteArgs;
            routeData.isOptimized = true;
            routeData.distance = route.distance;
            routeData.duration = route.duration;
            routeData.courierRoutes = state.courierRoutes;
        }

        routes[naam.trim()] = routeData;
        localStorage.setItem('savedRoutes', JSON.stringify(routes));
        updateSavedRoutesSelect();
        savedRoutesSelect.value = naam.trim();
    });

    document.getElementById('load-route-btn').addEventListener('click', () => {
        const naam = savedRoutesSelect.value;
        if (!naam) return alert('Selecteer eerst een route.');
        const route = getSavedRoutes()[naam];
        if (!route) return;
        // Verwijder huidige stops
        [...state.stops].forEach(s => { s.marker.remove(); });
        state.stops = [];
        clearRoute();
        // Laad opgeslagen stops in opgeslagen volgorde
        route.stops.forEach(s => addMarker(s.lat, s.lng, s.name));
        // Vervoersmiddel herstellen
        if (route.travelMode) {
            state.travelMode = route.travelMode;
            document.querySelectorAll('.toggle-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.mode === route.travelMode));
        }
        // Herstellen van andere instellingen
        if (route.roundTrip !== undefined) {
            state.roundTrip = route.roundTrip;
            roundTripCheckbox.checked = route.roundTrip;
        }
        if (route.courierCount !== undefined) {
            state.courierCount = route.courierCount;
            courierCountInput.value = route.courierCount;
        }

        // Als dit een geoptimaliseerde route is, toon de opgeslagen routegegevens
        if (route.isOptimized && route.distance !== undefined) {
            state.optimized = true;
            state.courierRoutes = route.courierRoutes || [];
            routeSummary.classList.remove('hidden');
            // Toon opgeslagen routegegevens
            const distKm = (route.distance / 1000).toFixed(1);
            const durMin = Math.round(route.duration / 60);
            const hours = Math.floor(durMin / 60);
            const mins = durMin % 60;
            totalDistance.textContent = `${distKm} km`;
            totalTime.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            totalStops.textContent = state.stops.length;

            // Teken de route opnieuw
            drawRouteFromStops();
        }

        renderStopsList();
        updateButtons();
    });

    document.getElementById('delete-route-btn').addEventListener('click', () => {
        const naam = savedRoutesSelect.value;
        if (!naam) return alert('Selecteer eerst een route.');
        if (!confirm(`Route "${naam}" verwijderen?`)) return;
        const routes = getSavedRoutes();
        delete routes[naam];
        localStorage.setItem('savedRoutes', JSON.stringify(routes));
        updateSavedRoutesSelect();
    });

    updateSavedRoutesSelect(); // laad bestaande routes bij opstarten

    // Import modal
    const importCity = document.getElementById('import-city');

    importBtn.addEventListener('click', () => {
        importModal.classList.remove('hidden');
        importTextarea.value = '';
        importCity.focus();
    });

    importCancel.addEventListener('click', () => {
        importModal.classList.add('hidden');
    });

    importModal.addEventListener('click', (e) => {
        if (e.target === importModal) {
            importModal.classList.add('hidden');
        }
    });

    importConfirm.addEventListener('click', async () => {
        const city = importCity.value.trim();

        // --- CSV/Excel bestand pad ---
        if (importFileInput && importFileInput.files && importFileInput.files.length > 0) {
            const file = importFileInput.files[0];
            importModal.classList.add('hidden');
            const progressEl   = document.getElementById('import-progress');
            const progressFill = document.getElementById('import-progress-fill');
            const progressText = document.getElementById('import-progress-text');
            progressEl.classList.remove('hidden');
            importModal.classList.remove('hidden');

            progressText.textContent = 'Bestand inlezen...';
            const result = await importFromFile(file, city, (done, total, fase) => {
                const pct = Math.round(done / total * 100);
                progressFill.style.width = pct + '%';
                progressText.textContent = fase === 'geocode'
                    ? `Geocoderen ${done} van ${total}...`
                    : `Verwerken ${done} van ${total}...`;
            });

            if (result.error) {
                progressEl.classList.add('hidden');
                importModal.classList.add('hidden');
                alert(result.error);
                return;
            }

            result.stops.forEach(s => addMarker(s.lat, s.lng, s.name));
            progressEl.classList.add('hidden');
            importModal.classList.add('hidden');
            importFileInput.value = '';
            if (result.failed && result.failed.length > 0) {
                alert(`${result.stops.length} stops toegevoegd.\n\nNiet gevonden:\n${result.failed.join('\n')}`);
            }
            return;
        }

        // --- Tekst import pad (ongewijzigd) ---
        const lines = importTextarea.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return;

        // Check address limit for non-logged-in users
        if (!window.__isLoggedIn && lines.length > window.__freeAddressLimit) {
            alert(`Je mag maar ${window.__freeAddressLimit} adressen tegelijk importeren. Log in voor onbeperkt gebruik!`);
            return;
        }
        if (!window.__isLoggedIn && state.stops.length + lines.length > window.__freeAddressLimit) {
            alert(`Je hebt nog ${window.__freeAddressLimit - state.stops.length} gratis adressen over. Log in voor onbeperkt gebruik!`);
            return;
        }

        // Veelvoorkomende afkortingen en schrijffouten corrigeren
        const corrigeer = s => s
            .replace(/\bBurg\.?\s+/gi,      'Burgemeester ')
            .replace(/\bBurgermeester\b/gi, 'Burgemeester')
            .replace(/\bSt\.?\s+/gi,        'Sint ')
            .replace(/\bDr\.?\s+/gi,        'Doctor ')
            .replace(/\bProf\.?\s+/gi,      'Professor ')
            .replace(/\bPr\.?\s+/gi,        'Prins ')
            .replace(/\bKon\.?\s+/gi,       'Koningin ')
            .replace(/\bGr\.?\s+/gi,        'Graaf ');

        // Duplicaten samenvoegen: zelfde adres (hoofdletter-onafhankelijk) → één stop met x2/x3
        // Herken ook "Fresia 40 X2" als 2x hetzelfde adres (strip de Xn suffix)
        const telling = {};
        for (const line of lines) {
            const gecorrigeerd = corrigeer(line);
            const xMatch = gecorrigeerd.match(/\s+[xX](\d+)\s*$/);
            const adres = xMatch ? gecorrigeerd.slice(0, xMatch.index).trim() : gecorrigeerd;
            const multiplier = xMatch ? parseInt(xMatch[1]) : 1;
            const sleutel = adres.toLowerCase();
            if (!telling[sleutel]) telling[sleutel] = { origineel: adres, n: 0 };
            telling[sleutel].n += multiplier;
        }
        const uniekeLijst = Object.values(telling);

        importModal.classList.add('hidden');

        // Voortgangsbalk tonen
        const progressEl   = document.getElementById('import-progress');
        const progressFill = document.getElementById('import-progress-fill');
        const progressText = document.getElementById('import-progress-text');
        progressEl.classList.remove('hidden');
        importModal.classList.remove('hidden'); // modal open houden voor voortgang

        let added = 0;
        const failed = [];
        for (let i = 0; i < uniekeLijst.length; i++) {
            const { origineel, n } = uniekeLijst[i];

            // Valideer: adres moet een huisnummer bevatten
            if (!/\d/.test(origineel)) {
                failed.push(origineel);
                continue;
            }

            // Voortgang bijwerken
            const pct = Math.round((i + 1) / uniekeLijst.length * 100);
            progressFill.style.width = pct + '%';
            progressText.textContent = `Adres ${i + 1} van ${uniekeLijst.length} ophalen...`;

            // Geocodeer met meerdere pogingen zodat spelfouten en stadsnaam-problemen worden opgevangen
            let result = null;

            // Poging 1: vrije tekst (met stad indien opgegeven)
            const queryVrij = city && !origineel.toLowerCase().includes(city.toLowerCase())
                ? `${origineel}, ${city}` : origineel;
            result = await geocodeAddress(queryVrij);

            // Poging 2: gestructureerde zoekopdracht straat + stad apart (helpt bij spelfouten)
            if (!result && city) {
                try {
                    const url2 = `https://nominatim.openstreetmap.org/search?format=json` +
                        `&street=${encodeURIComponent(origineel)}&city=${encodeURIComponent(city)}` +
                        `&countrycodes=nl&limit=1`;
                    const data2 = await (await fetch(url2, { headers: { 'Accept-Language': 'nl' } })).json();
                    if (data2.length > 0) result = {
                        lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon),
                        name: data2[0].display_name.split(',').slice(0, 3).join(','),
                    };
                } catch {}
            }

            // Poging 3: naburige huisnummers proberen (28 niet gevonden → probeer 27, 29, 26, 30…)
            if (!result) {
                const nrMatch = origineel.match(/^(.*\D)(\d+)([a-zA-Z]?)\s*$/);
                if (nrMatch) {
                    const straat = nrMatch[1].trim();
                    const nr = parseInt(nrMatch[2]);
                    const toevoeging = nrMatch[3];
                    // Probeer dichtstbijzijnde nummers: ±1, ±2, ±3, ±5
                    for (const delta of [1, -1, 2, -2, 3, -3, 5, -5]) {
                        const kandidaat = nr + delta;
                        if (kandidaat < 1) continue;
                        const q = `${straat} ${kandidaat}${toevoeging}${city ? ', ' + city : ''}`;
                        const r = await geocodeAddress(q);
                        if (r) { result = { ...r, name: origineel }; break; }
                    }
                }
            }

            if (result) {
                const naam = n > 1 ? `${result.name}  x${n}` : result.name;
                addMarker(result.lat, result.lng, naam);
                added++;
            } else {
                failed.push(origineel);
            }
            // Small delay to respect Nominatim rate limits
            await new Promise(r => setTimeout(r, 1100));
        }

        progressEl.classList.add('hidden');
        importModal.classList.add('hidden');

        if (failed.length > 0) {
            const msg = `${added} van ${uniekeLijst.length} adressen toegevoegd.\n\n⚠️ Overgeslagen (geen huisnummer of niet gevonden):\n${failed.slice(0, 10).join('\n')}${failed.length > 10 ? `\n... en ${failed.length - 10} meer` : ''}`;
            alert(msg);
        }
    });

    // ================================================================
    // Gedeelde bezorger-links (URL-gebaseerd, geen server nodig)
    // ================================================================

    // Encodeer stops naar een deelbare URL voor één bezorger
    function encodeStopsToURL(stops, courierIdx) {
        const compact = stops.map(s => [
            parseFloat(s.lat.toFixed(5)),
            parseFloat(s.lng.toFixed(5)),
            s.name,
        ]);
        const json = JSON.stringify(compact);
        // URL-safe base64 (werkt ook met bijv. é, ë in straatnamen)
        const encoded = btoa(unescape(encodeURIComponent(json)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return `${location.origin}${location.pathname}?bezorger=${courierIdx + 1}&route=${encoded}`;
    }

    // Lees stops uit de URL als die aanwezig zijn
    function decodeStopsFromURL() {
        const params = new URLSearchParams(location.search);
        const encoded = params.get('route');
        if (!encoded) return null;
        try {
            const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
            const json = decodeURIComponent(escape(atob(padded)));
            const compact = JSON.parse(json);
            return {
                stops: compact.map(([lat, lng, name]) => ({ lat, lng, name })),
                bezorger: parseInt(params.get('bezorger')) || 1,
            };
        } catch (e) {
            console.error('Route URL decode mislukt:', e);
            return null;
        }
    }

    // Laad gedeelde route uit URL (voor bezorger die de link opent)
    function loadSharedRoute() {
        const data = decodeStopsFromURL();
        if (!data) return;

        // Verwijder ?route=... uit de URL zodat refreshen geen problemen geeft
        history.replaceState({}, '', location.pathname);

        data.stops.forEach(s => addMarker(s.lat, s.lng, s.name));

        // Toon banner
        const banner = document.getElementById('shared-route-banner');
        if (banner) {
            banner.textContent = `Bezorger ${data.bezorger} — ${data.stops.length} stops geladen`;
            banner.style.display = '';
        }

        // Pas kaart aan op de stops
        setTimeout(fitMapToStops, 300);
    }

    // --- Bezorger-routes weergeven inclusief deelknoppen ---
    function renderCourierRoutes() {
        const container = document.getElementById('courier-routes');
        if (!container) return;
        if (!state.courierRoutes || state.courierRoutes.length <= 1) {
            container.innerHTML = '';
            return;
        }
        const samenvatting = genereerBezorgerSamenvatting(state.courierRoutes);

        container.innerHTML = `
            <h3 style="margin:8px 0 6px;font-size:14px;font-weight:700;">
                Verdeling over ${samenvatting.length} bezorgers
            </h3>
            ${samenvatting.map((b, i) => {
                const url = encodeStopsToURL(b.stops, i);
                const qrUrl = url.length <= 2500
                    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`
                    : null;
                return `
                <div style="border-radius:10px;margin-bottom:8px;background:${b.kleur}12;border:1px solid ${b.kleur}40;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;">
                        <span style="font-weight:700;color:${b.kleur};">Bezorger ${b.nummer}</span>
                        <span style="font-size:13px;color:#555;">${b.aantalStops} stops</span>
                        <button class="start-bezorger-btn" data-idx="${i}"
                            style="margin-left:auto;padding:5px 10px;background:${b.kleur};color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                            &#128666; Start
                        </button>
                    </div>
                    <div style="display:flex;gap:6px;padding:0 10px 10px;flex-wrap:wrap;align-items:flex-start;">
                        <button class="kopieer-link-btn" data-url="${escapeHtml(url)}"
                            style="padding:5px 10px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;flex:1;min-width:120px;">
                            &#128203; Kopieer link
                        </button>
                        ${qrUrl ? `
                        <button class="toon-qr-btn" data-qr="${escapeHtml(qrUrl)}"
                            style="padding:5px 10px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;">
                            &#9636; QR-code
                        </button>
                        ` : ''}
                    </div>
                    <div class="qr-container" style="display:none;padding:0 10px 10px;text-align:center;"></div>
                </div>
                `;
            }).join('')}
        `;

        // Event listeners
        container.querySelectorAll('.start-bezorger-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                state.activeCourier = idx;
                state.bezorgOrder = state.courierRoutes[idx].slice();
                startBezorgModus();
            });
        });

        container.querySelectorAll('.kopieer-link-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(btn.dataset.url).then(() => {
                    const orig = btn.textContent;
                    btn.textContent = '✓ Gekopieerd!';
                    setTimeout(() => { btn.textContent = orig; }, 2000);
                });
            });
        });

        container.querySelectorAll('.toon-qr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const qrDiv = btn.closest('div[style]').nextElementSibling;
                if (qrDiv.style.display === 'none') {
                    qrDiv.style.display = '';
                    qrDiv.innerHTML = `<img src="${btn.dataset.qr}" alt="QR code bezorger"
                        style="border-radius:8px;border:1px solid #ddd;" />
                        <p style="font-size:11px;color:#888;margin:4px 0 0;">Laat bezorger scannen</p>`;
                    btn.textContent = '✕ Verberg QR';
                } else {
                    qrDiv.style.display = 'none';
                    btn.textContent = '⬛ QR-code';
                }
            });
        });
    }

    // --- Auto-import vanuit scan-pagina ---
    function checkScanWachtrij() {
        if (!window.location.hash.includes('import-scan')) return;
        try {
            const wachtrij = JSON.parse(localStorage.getItem('scanWachtrij') || '[]');
            if (wachtrij.length === 0) return;
            localStorage.removeItem('scanWachtrij');
            history.replaceState(null, '', 'index.html');
            importModal.classList.remove('hidden');
            importTextarea.value = wachtrij.join('\n');
            importTextarea.focus();
        } catch (e) { /* ignore */ }
    }
    checkScanWachtrij();
    loadSharedRoute();

    // Test-handles (alleen op localhost / file://)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
        window.__test = { state, map, startBezorgModus, updateBsScherm, addMarker };
    }

    })();
}
