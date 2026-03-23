// cluster.js - Geografisch clusteren van stops voor grote routes
// Gebruikt k-means op GPS-coördinaten met Haversine-afstand

'use strict';

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Hoeveel clusters voor n stops (heuristiek: n/20, min 2, max 30)
function clusterCount(n) {
    return Math.min(30, Math.max(2, Math.round(n / 20)));
}

// k-means++ initialisatie + iteraties op GPS-coördinaten
// Geeft array terug van cluster-indices (1 per stop)
function kMeans(stops, k, maxIter = 100) {
    if (stops.length <= k) {
        return stops.map((_, i) => i);
    }

    // k-means++ initialisatie: verspreide startpunten
    const centroids = [{ lat: stops[0].lat, lng: stops[0].lng }];
    for (let c = 1; c < k; c++) {
        let farthest = 0, farthestDist = -1;
        for (let i = 0; i < stops.length; i++) {
            const minDist = Math.min(...centroids.map(cent =>
                haversineKm(stops[i].lat, stops[i].lng, cent.lat, cent.lng)
            ));
            if (minDist > farthestDist) {
                farthestDist = minDist;
                farthest = i;
            }
        }
        centroids.push({ lat: stops[farthest].lat, lng: stops[farthest].lng });
    }

    let assignments = new Array(stops.length).fill(0);

    for (let iter = 0; iter < maxIter; iter++) {
        // Wijs elke stop toe aan dichtstbijzijnde centroid
        const newAssignments = stops.map(s => {
            let best = 0, bestDist = Infinity;
            for (let c = 0; c < k; c++) {
                const d = haversineKm(s.lat, s.lng, centroids[c].lat, centroids[c].lng);
                if (d < bestDist) { bestDist = d; best = c; }
            }
            return best;
        });

        const changed = newAssignments.some((a, i) => a !== assignments[i]);
        assignments = newAssignments;
        if (!changed) break;

        // Update centroids
        for (let c = 0; c < k; c++) {
            const members = stops.filter((_, i) => assignments[i] === c);
            if (members.length > 0) {
                centroids[c].lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
                centroids[c].lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
            }
        }
    }

    return assignments;
}

// Splits stops in k clusters, geeft array van arrays terug
function splitIntoClusters(stops, k) {
    const assignments = kMeans(stops, k);
    const clusters = Array.from({ length: k }, () => []);
    stops.forEach((s, i) => clusters[assignments[i]].push(s));
    return clusters.filter(c => c.length > 0); // verwijder lege clusters
}

// Centroïde van een cluster
function clusterCentroid(cluster) {
    return {
        lat: cluster.reduce((s, c) => s + c.lat, 0) / cluster.length,
        lng: cluster.reduce((s, c) => s + c.lng, 0) / cluster.length,
    };
}

// Sorteert clusters op nabijheid via nearest-neighbor op centroïden
function orderClusters(clusters) {
    if (clusters.length <= 1) return clusters;
    const centroids = clusters.map(clusterCentroid);
    const visited = new Set([0]);
    const order = [0];
    while (order.length < clusters.length) {
        const cur = centroids[order[order.length - 1]];
        let best = -1, bestDist = Infinity;
        for (let i = 0; i < clusters.length; i++) {
            if (visited.has(i)) continue;
            const d = haversineKm(cur.lat, cur.lng, centroids[i].lat, centroids[i].lng);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        visited.add(best);
        order.push(best);
    }
    return order.map(i => clusters[i]);
}
