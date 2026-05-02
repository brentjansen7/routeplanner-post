// import.js - CSV/Excel import + batch geocoding voor grote postsorteerbedrijven
// Ondersteunt: CSV met/zonder coordinaten, Excel (.xlsx), tekst met postcodes
// Fallback: batch Nominatim geocoding in chunks van 3 met 400ms vertraging

'use strict';

// --- CSV-parser (geen dependencies) ---
// Herkent komma's en puntkomma's als scheidingstekens
function parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    // Detecteer scheidingsteken
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';

    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i], sep);
        if (cols.length < 2) continue;
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (cols[idx] || '').replace(/['"]/g, '').trim(); });
        rows.push(obj);
    }
    return rows;
}

function splitCSVLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
            inQuotes = !inQuotes;
        } else if (line[i] === sep && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += line[i];
        }
    }
    result.push(current);
    return result;
}

// --- Kolomnamen herkennen ---
// Probeert flexibel kolommen te matchen ongeacht de exacte naam
function detectColumns(headers) {
    const find = (keywords) => headers.find(h => keywords.some(k => h.includes(k)));

    return {
        straat: find(['straat', 'street', 'adres', 'address', 'weg', 'laan', 'plein']),
        huisnr: find(['huisnr', 'huisnummer', 'nummer', 'number', 'nr', 'house']),
        postcode: find(['postcode', 'zipcode', 'zip', 'pc']),
        stad: find(['stad', 'city', 'plaats', 'place', 'town', 'gemeente']),
        lat: find(['lat', 'latitude', 'breedtegraad']),
        lng: find(['lng', 'lon', 'longitude', 'lengtegraad']),
        naam: find(['naam', 'name', 'ontvanger', 'recipient', 'klant']),
        volledig: find(['volledig', 'adres', 'full', 'address']),
    };
}

// --- Rij naar adresobject ---
function rowToAddress(row, cols) {
    const addr = {};

    // Coördinaten direct aanwezig?
    if (cols.lat && cols.lng && row[cols.lat] && row[cols.lng]) {
        const lat = parseFloat(row[cols.lat].replace(',', '.'));
        const lng = parseFloat(row[cols.lng].replace(',', '.'));
        if (!isNaN(lat) && !isNaN(lng)) {
            addr.lat = lat;
            addr.lng = lng;
        }
    }

    // Volledig adres als één string?
    if (cols.volledig && row[cols.volledig]) {
        addr.fullAddress = row[cols.volledig];
        addr.displayName = row[cols.volledig];
        return addr;
    }

    // Huisnummer verplicht als straat aanwezig is
    if (cols.straat && row[cols.straat] && (!cols.huisnr || !row[cols.huisnr])) {
        return null; // straat zonder huisnummer niet toegestaan
    }

    // Straat + huisnummer + postcode + stad samenstellen
    const parts = [];
    if (cols.straat && row[cols.straat]) parts.push(row[cols.straat]);
    if (cols.huisnr && row[cols.huisnr]) parts.push(row[cols.huisnr]);

    const postcode = cols.postcode ? (row[cols.postcode] || '') : '';
    const stad = cols.stad ? (row[cols.stad] || '') : '';

    if (parts.length === 0 && !postcode) return null;

    addr.displayName = parts.join(' ') + (postcode ? `, ${postcode}` : '') + (stad ? ` ${stad}` : '');
    addr.fullAddress = addr.displayName;
    addr.postcode = postcode.replace(/\s/g, '').toUpperCase();
    addr.huisnr = cols.huisnr ? row[cols.huisnr] : '';

    // Ontvangernaam als extra label
    if (cols.naam && row[cols.naam]) addr.label = row[cols.naam];

    return addr;
}

// --- PC4-lookup (postcodecentroïden van CBS) ---
// Laadt pc4.json als het beschikbaar is, anders null
let _pc4Data = null;
let _pc4LoadAttempted = false;

async function loadPC4() {
    if (_pc4LoadAttempted) return _pc4Data;
    _pc4LoadAttempted = true;
    try {
        const resp = await fetch('pc4.json');
        if (resp.ok) {
            _pc4Data = await resp.json();
            console.log(`PC4-database geladen: ${Object.keys(_pc4Data).length} postcodes`);
        }
    } catch (e) {
        console.info('pc4.json niet beschikbaar, gebruik Nominatim als fallback');
    }
    return _pc4Data;
}

// Zoek coördinaten op via postcode (PC4 = eerste 4 cijfers)
function lookupPC4(postcode) {
    if (!_pc4Data || !postcode) return null;
    const pc4 = postcode.replace(/\s/g, '').substring(0, 4);
    return _pc4Data[pc4] || null;
}

// --- Nominatim batch geocoding ---
// Verwerkt adressen in chunks van 3 met 400ms vertraging tussen chunks
async function batchGeocode(addresses, onProgress) {
    const results = new Array(addresses.length).fill(null);
    const chunkSize = 3;
    const delay = 400;

    for (let i = 0; i < addresses.length; i += chunkSize) {
        const chunk = addresses.slice(i, i + chunkSize);
        const promises = chunk.map(async (addr, j) => {
            const idx = i + j;
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr.fullAddress)}&countrycodes=nl`;
                const resp = await fetch(url, {
                    headers: { 'Accept-Language': 'nl', 'User-Agent': 'RouteOptimizer/2.0' }
                });
                const data = await resp.json();
                if (data.length > 0) {
                    results[idx] = {
                        lat: parseFloat(data[0].lat),
                        lng: parseFloat(data[0].lon),
                        name: addr.label || addr.displayName,
                    };
                }
            } catch (e) {
                console.warn('Geocode mislukt voor:', addr.fullAddress);
            }
        });

        await Promise.all(promises);

        if (onProgress) onProgress(Math.min(i + chunkSize, addresses.length), addresses.length);

        if (i + chunkSize < addresses.length) {
            await new Promise(r => setTimeout(r, delay));
        }
    }

    return results;
}

// --- Hoofd exportfunctie ---
// Verwerkt CSV-tekst of rijen, geeft array van {lat, lng, name} terug
async function importFromCSV(csvText, defaultCity, onProgress) {
    const rows = parseCSV(csvText);
    if (rows.length === 0) return { stops: [], failed: [] };

    const headers = Object.keys(rows[0]).map(h => h.toLowerCase());
    const cols = detectColumns(headers);

    const addresses = rows.map(row => rowToAddress(row, cols)).filter(Boolean);
    if (addresses.length === 0) return { stops: [], failed: [] };

    // Probeer PC4-database te laden
    await loadPC4();

    const stops = [];
    const needsGeocode = [];

    // Stap 1: gebruik bestaande coördinaten of PC4-lookup
    for (const addr of addresses) {
        if (addr.lat && addr.lng) {
            stops.push({ lat: addr.lat, lng: addr.lng, name: addr.label || addr.displayName });
        } else {
            const pc4Result = lookupPC4(addr.postcode);
            if (pc4Result) {
                // PC4 geeft centroïde van de postcode — goed genoeg voor clustering
                stops.push({ lat: pc4Result.lat, lng: pc4Result.lng, name: addr.label || addr.displayName });
            } else {
                needsGeocode.push({ addr, stopsIdx: stops.length });
                stops.push(null); // placeholder
            }
        }
    }

    // Stap 2: batch Nominatim voor adressen zonder coördinaten
    const failed = [];
    if (needsGeocode.length > 0) {
        const toGeocode = needsGeocode.map(({ addr }) => {
            // Voeg standaard stad toe als het adres die nog niet heeft
            if (defaultCity && addr.fullAddress && !addr.fullAddress.toLowerCase().includes(defaultCity.toLowerCase())) {
                return { ...addr, fullAddress: `${addr.fullAddress}, ${defaultCity}` };
            }
            return addr;
        });

        const geocoded = await batchGeocode(toGeocode, (done, total) => {
            if (onProgress) onProgress(done, total, 'geocode');
        });

        needsGeocode.forEach(({ stopsIdx }, i) => {
            if (geocoded[i]) {
                stops[stopsIdx] = geocoded[i];
            } else {
                stops[stopsIdx] = null;
                failed.push(needsGeocode[i].addr.displayName);
            }
        });
    }

    return {
        stops: stops.filter(Boolean),
        failed,
    };
}

// --- Excel-import via FileReader (geen externe library nodig voor .csv vermomd als .xlsx) ---
// Voor echte .xlsx-bestanden: geeft instructie terug om als CSV op te slaan
async function importFromFile(file, defaultCity, onProgress) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const text = await file.text();
        return importFromCSV(text, defaultCity, onProgress);
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        // Probeer SheetJS als dat beschikbaar is (geladen via CDN in index.html)
        if (typeof XLSX !== 'undefined') {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
                    const result = await importFromCSV(csv, defaultCity, onProgress);
                    resolve(result);
                };
                reader.readAsArrayBuffer(file);
            });
        } else {
            return {
                stops: [],
                failed: [],
                error: 'Excel-import vereist de SheetJS-library. Sla het bestand op als CSV (.csv) en probeer opnieuw.',
            };
        }
    }

    return { stops: [], failed: [], error: 'Onbekend bestandsformaat. Gebruik .csv of .xlsx' };
}
