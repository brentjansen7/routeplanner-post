// ============================================================
// Route Optimizer - Client-side route optimization app
// Uses Leaflet + OpenStreetMap, Nominatim geocoding, OSRM routing
// ============================================================

(function () {
    'use strict';

    // --- State ---
    const state = {
        stops: [],          // { id, name, lat, lng, marker }
        routeLine: null,
        optimized: false,
        nextId: 1,
        travelMode: 'driving',  // 'driving', 'cycling', or 'foot'
        roundTrip: false,
    };

    // --- Map setup ---
    const map = L.map('map', {
        zoomControl: true,
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

    function addMarker(lat, lng, name) {
        const id = state.nextId++;
        const marker = L.marker([lat, lng], {
            icon: createNumberedIcon(state.stops.length + 1, state.stops.length + 1),
            draggable: true,
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
            li.setAttribute('draggable', 'true');
            li.dataset.id = stop.id;

            li.innerHTML = `
                <span class="drag-handle">⠿</span>
                <span class="stop-number">${i + 1}</span>
                <span class="stop-name" title="${escapeHtml(stop.name)}">${escapeHtml(stop.name)}</span>
                <button class="stop-remove" data-id="${stop.id}" title="Verwijder">&times;</button>
            `;

            // Drag & drop
            li.addEventListener('dragstart', handleDragStart);
            li.addEventListener('dragover', handleDragOver);
            li.addEventListener('drop', handleDrop);
            li.addEventListener('dragend', handleDragEnd);

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
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
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

    // --- OSRM profile mapping ---
    // The OSRM demo server only supports 'driving'. For cycling/foot we fall
    // back to driving routing but apply a speed factor so estimated times are
    // more realistic. The geometry still follows roads.
    function osrmProfile() {
        // OSRM demo only reliably supports 'driving'
        return 'driving';
    }

    function speedFactor() {
        // Rough speed ratios relative to driving to adjust duration estimates
        if (state.travelMode === 'cycling') return 3.5;
        if (state.travelMode === 'foot') return 10;
        return 1;
    }

    // --- OSRM Distance Matrix ---
    async function getDistanceMatrix(stops) {
        const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/${osrmProfile()}/${coords}?annotations=duration,distance`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code !== 'Ok') {
            throw new Error('OSRM table request failed: ' + data.code);
        }

        // Apply speed factor to durations for non-driving modes
        const factor = speedFactor();
        if (factor !== 1) {
            for (let i = 0; i < data.durations.length; i++) {
                for (let j = 0; j < data.durations[i].length; j++) {
                    data.durations[i][j] *= factor;
                }
            }
        }

        return {
            durations: data.durations,
            distances: data.distances,
        };
    }

    // --- OSRM Route ---
    async function getRoute(stops) {
        const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/${osrmProfile()}/${coords}?overview=full&geometries=geojson&steps=true`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code !== 'Ok') {
            throw new Error('OSRM route request failed: ' + data.code);
        }

        // Adjust duration for non-driving modes
        const factor = speedFactor();
        if (factor !== 1) {
            data.routes[0].duration *= factor;
            if (data.routes[0].legs) {
                data.routes[0].legs.forEach(leg => {
                    leg.duration *= factor;
                });
            }
        }

        return data.routes[0];
    }

    // --- TSP Solver (Multi-start Nearest Neighbor + 2-opt + Or-opt) ---

    function totalRouteDistance(order, dist) {
        let total = 0;
        for (let i = 0; i < order.length - 1; i++) {
            total += dist[order[i]][order[i + 1]];
        }
        if (state.roundTrip) {
            total += dist[order[order.length - 1]][order[0]];
        }
        return total;
    }

    function nearestNeighbor(dist, n, startIdx) {
        const visited = new Set([startIdx]);
        const order = [startIdx];
        while (visited.size < n) {
            const current = order[order.length - 1];
            let nearestDist = Infinity;
            let nearest = -1;
            for (let i = 0; i < n; i++) {
                if (!visited.has(i) && dist[current][i] < nearestDist) {
                    nearestDist = dist[current][i];
                    nearest = i;
                }
            }
            visited.add(nearest);
            order.push(nearest);
        }
        return order;
    }

    function improve2Opt(order, dist) {
        const n = order.length;
        const isRound = state.roundTrip;
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 1; i < n - 1; i++) {
                for (let j = i + 1; j < n; j++) {
                    // Skip reversing segment that includes fixed endpoints for non-round trips
                    if (!isRound && j === n - 1) continue;
                    const a = order[i - 1], b = order[i];
                    const c = order[j], d = (j + 1 < n) ? order[j + 1] : (isRound ? order[0] : null);
                    if (d === null) continue;
                    const before = dist[a][b] + dist[c][d];
                    const after = dist[a][c] + dist[b][d];
                    if (after - before < -0.001) {
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

    function improveOrOpt(order, dist) {
        const n = order.length;
        const isRound = state.roundTrip;
        let improved = true;
        while (improved) {
            improved = false;
            // Try relocating segments of length 1, 2, 3
            for (let segLen = 1; segLen <= Math.min(3, n - 2); segLen++) {
                for (let i = 1; i < n - segLen; i++) {
                    // Cost of removing segment [i..i+segLen-1]
                    const prevNode = order[i - 1];
                    const segStart = order[i];
                    const segEnd = order[i + segLen - 1];
                    const nextIdx = i + segLen;
                    const nextNode = (nextIdx < n) ? order[nextIdx] : (isRound ? order[0] : null);
                    if (nextNode === null) continue;

                    const removeCost = dist[prevNode][segStart] + dist[segEnd][nextNode];
                    const bridgeCost = dist[prevNode][nextNode];

                    // Try inserting segment at each other position
                    for (let j = 0; j < n - 1; j++) {
                        if (j >= i - 1 && j < i + segLen) continue; // skip overlap
                        const jA = order[j], jB = order[j + 1];
                        const insertCost = dist[jA][segStart] + dist[segEnd][jB];
                        const currentEdgeCost = dist[jA][jB];

                        const delta = (bridgeCost + insertCost) - (removeCost + currentEdgeCost);
                        if (delta < -0.001) {
                            // Perform the move: extract segment and insert after position j
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

    function solveTSP(distanceMatrix) {
        const n = distanceMatrix.length;
        if (n <= 2) return Array.from({ length: n }, (_, i) => i);
        if (n === 3) {
            // Only 3 stops: try all permutations starting from 0
            const perms = [[0,1,2],[0,2,1]];
            let bestDist = Infinity, bestOrder = perms[0];
            for (const p of perms) {
                const d = totalRouteDistance(p, distanceMatrix);
                if (d < bestDist) { bestDist = d; bestOrder = p; }
            }
            return bestOrder;
        }

        // Multi-start: try nearest neighbor from every starting node
        let bestOrder = null;
        let bestDist = Infinity;

        // For large inputs, limit starts to save time
        const maxStarts = Math.min(n, 10);
        for (let start = 0; start < maxStarts; start++) {
            const order = nearestNeighbor(distanceMatrix, n, start);

            // Apply 2-opt
            improve2Opt(order, distanceMatrix);

            // Apply or-opt
            improveOrOpt(order, distanceMatrix);

            // Apply 2-opt again after or-opt moves
            improve2Opt(order, distanceMatrix);

            const dist = totalRouteDistance(order, distanceMatrix);
            if (dist < bestDist) {
                bestDist = dist;
                bestOrder = [...order];
            }
        }

        return bestOrder;
    }

    // --- Route optimization ---
    async function optimizeRoute() {
        if (state.stops.length < 2) return;

        showLoading(true);

        try {
            // Get distance matrix from OSRM
            const matrix = await getDistanceMatrix(state.stops);

            // Solve TSP
            const optimalOrder = solveTSP(matrix.distances);

            // Reorder stops
            const reordered = optimalOrder.map(i => state.stops[i]);
            state.stops = reordered;

            updateMarkerIcons();
            renderStopsList();

            // Build waypoints for route (add first stop at end for round trip)
            let routeStops = [...state.stops];
            if (state.roundTrip && state.stops.length >= 2) {
                routeStops.push({ ...state.stops[0] });
            }

            // Get actual route geometry
            const route = await getRoute(routeStops);

            drawRoute(route);
            showRouteSummary(route, matrix, optimalOrder);
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

    // --- Route summary ---
    function showRouteSummary(route, matrix, order) {
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

            div.innerHTML = `
                <span class="step-number">${i + 1}</span>
                <span class="step-info">${escapeHtml(stop.name)}</span>
                <span class="step-distance">${distText}</span>
            `;
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

    addBtn.addEventListener('click', () => {
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

    // Click on map to add stop
    map.on('click', async (e) => {
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

    // Import modal
    importBtn.addEventListener('click', () => {
        importModal.classList.remove('hidden');
        importTextarea.value = '';
        importTextarea.focus();
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
        const lines = importTextarea.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return;

        importModal.classList.add('hidden');
        showLoading(true);

        let added = 0;
        for (const line of lines) {
            const result = await geocodeAddress(line);
            if (result) {
                addMarker(result.lat, result.lng, result.name);
                added++;
            }
            // Small delay to respect Nominatim rate limits
            await new Promise(r => setTimeout(r, 1100));
        }

        showLoading(false);

        if (added < lines.length) {
            alert(`${added} van ${lines.length} adressen gevonden en toegevoegd.`);
        }
    });

})();
