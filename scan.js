// ============================================================
// Scan adressen – Gemini Vision API integratie
// Foto van pakket → bezorgadres automatisch herkend
// ============================================================

(function () {
    'use strict';

    const PROXY_URL    = 'https://claude-proxy.brent-jansen2009.workers.dev';
    const LS_WACHTRIJ  = 'scanWachtrij';
    const DAGMAX       = 50;   // zelfde als MAX_PER_DAY in de Worker
    const LS_DAGNAAM   = 'scanDag';
    const LS_DAGTELLER = 'scanTeller';

    const PROMPT = `Dit is een foto van een pakket of tijdschrift dat bezorgd moet worden.
Lees het BEZORGADRES (het adres van de ontvanger, NIET het retouradres/afzender).

Geef het adres in dit formaat: Straatnaam Huisnummer, Postcode Stad
Voorbeeld: Lavendel 63, 2925 XE Krimpen aan den IJssel

Als er meerdere bezorgadressen op de foto staan, geef ze allemaal op aparte regels.
Als het onleesbaar is, schrijf dan alleen: ONLEESBAAR
Geef GEEN afzendadres, GEEN namen, GEEN extra uitleg. Alleen het adres.`;

    // --- DOM refs ---
    const cameraBtn          = document.getElementById('camera-btn');
    const gallerijBtn        = document.getElementById('gallerij-btn');
    const cameraInput        = document.getElementById('camera-input');
    const gallerijInput      = document.getElementById('gallerij-input');
    const fotoPreview        = document.getElementById('foto-preview');
    const previewWrap        = document.getElementById('preview-wrap');
    const previewPlaceholder = document.getElementById('preview-placeholder');
    const analyseerBtn       = document.getElementById('analyseer-btn');
    const scanStatus         = document.getElementById('scan-status');
    const scanProgress       = document.getElementById('scan-progress');
    const scanProgressBar    = document.getElementById('scan-progress-bar');
    const scanProgressTekst  = document.getElementById('scan-progress-tekst');
    const resultatenSectie   = document.getElementById('resultaten-sectie');
    const adresLijst         = document.getElementById('adres-lijst');
    const toevoegenBtn       = document.getElementById('toevoegen-btn');
    const noeenBtn           = document.getElementById('nogeen-btn');
    const stapelInfo         = document.getElementById('stapel-info');
    const stapelCount        = document.getElementById('stapel-count');
    const stapelWis          = document.getElementById('stapel-wis');
    const naarRouteBtn       = document.getElementById('naar-route-btn');

    // --- Dagelijkse scan-teller ---
    function vandaag() { return new Date().toISOString().slice(0, 10); }

    function getScansVandaag() {
        if (localStorage.getItem(LS_DAGNAAM) !== vandaag()) {
            localStorage.setItem(LS_DAGNAAM,   vandaag());
            localStorage.setItem(LS_DAGTELLER, '0');
        }
        return parseInt(localStorage.getItem(LS_DAGTELLER) || '0');
    }

    function incrementTeller(n = 1) {
        getScansVandaag(); // reset dag indien nodig
        const nieuw = getScansVandaag() + n;
        localStorage.setItem(LS_DAGTELLER, String(nieuw));
        updateTellerUI();
        return nieuw;
    }

    function updateTellerUI() {
        const gebruikt = getScansVandaag();
        const resterend = Math.max(0, DAGMAX - gebruikt);
        const el = document.getElementById('scan-teller');
        if (!el) return;
        el.textContent = `${resterend} van ${DAGMAX} scans over vandaag`;
        el.style.color = resterend <= 5 ? '#ef4444' : resterend <= 15 ? '#f59e0b' : '#6b7280';
    }

    // --- State ---
    let geselecteerdeFiles = [];   // FileList → Array
    let gevondenAdressen   = [];   // [{ tekst, geselecteerd }]
    let bezig              = false;

    // ============================================================
    // Bestand naar base64
    // ============================================================
    function leesBase64(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = e => resolve({
                data: e.target.result.split(',')[1],
                mime: file.type || 'image/jpeg',
            });
            reader.readAsDataURL(file);
        });
    }

    // ============================================================
    // Preview
    // ============================================================
    function toonPreview(files) {
        if (!files.length) return;
        const reader = new FileReader();
        reader.onload = e => {
            fotoPreview.src = e.target.result;
            fotoPreview.style.display = 'block';
            previewPlaceholder.style.display = 'none';
            previewWrap.classList.add('heeft-foto');
        };
        reader.readAsDataURL(files[0]);

        // Update placeholder tekst als er meerdere zijn
        if (files.length > 1) {
            previewPlaceholder.querySelector('p').textContent =
                `${files.length} foto's geselecteerd`;
        }
    }

    function verwerkSelectie(files) {
        if (!files || files.length === 0) return;
        geselecteerdeFiles = Array.from(files);
        gevondenAdressen   = [];
        resultatenSectie.style.display = 'none';
        scanStatus.style.display = 'none';
        toonPreview(geselecteerdeFiles);

        if (geselecteerdeFiles.length === 1) {
            // Enkelvoudig: toon analyseer-knop
            analyseerBtn.style.display = 'flex';
            analyseerBtn.textContent = '🔍 Analyseer adres';
        } else {
            // Meerdere: direct starten
            analyseerBtn.style.display = 'none';
            scanAllesFotos();
        }
    }

    cameraBtn.addEventListener('click',   () => cameraInput.click());
    gallerijBtn.addEventListener('click', () => gallerijInput.click());
    cameraInput.addEventListener('change',   e => verwerkSelectie(e.target.files));
    gallerijInput.addEventListener('change', e => verwerkSelectie(e.target.files));

    // ============================================================
    // Eén foto scannen via proxy
    // ============================================================
    // Bijhouden of we een 429 rate-limit fout hebben gehad
    let rateLimitFout = false;

    async function scanEenFoto(base64, mime) {
        const resp = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [
                    { text: PROMPT },
                    { inline_data: { mime_type: mime, data: base64 } }
                ]}],
                generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
            })
        });

        if (resp.status === 429) {
            rateLimitFout = true;
            throw new Error('RATELIMIT');
        }

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err?.error?.message || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // ============================================================
    // Alle foto's scannen
    // ============================================================
    async function scanAllesFotos() {
        if (bezig) return;

        rateLimitFout = false;

        // Controleer daglimiet vóór het starten
        const gebruikt = getScansVandaag();
        const totaalGevraagd = geselecteerdeFiles.length;
        if (gebruikt >= DAGMAX) {
            scanStatus.className = 'fout';
            scanStatus.style.display = 'block';
            scanStatus.textContent = `⛔ Daglimiet bereikt (${DAGMAX} scans/dag). Probeer morgen opnieuw.`;
            return;
        }

        bezig = true;
        analyseerBtn.disabled = true;
        gevondenAdressen = [];

        const totaal = geselecteerdeFiles.length;
        scanProgress.style.display = 'block';
        scanStatus.style.display = 'none';
        resultatenSectie.style.display = 'none';

        let fouten = 0;

        // Verwerk foto's één voor één om API rate limit te voorkomen
        for (let i = 0; i < totaal; i++) {
            // Progress bijwerken
            const pct = Math.round((i / totaal) * 100);
            scanProgressBar.style.width = pct + '%';
            scanProgressTekst.textContent = `Foto ${i + 1} van ${totaal} wordt gescand...`;

            // Preview bijwerken
            const previewDataUrl = await new Promise(r => {
                const rd = new FileReader();
                rd.onload = e => r(e.target.result);
                rd.readAsDataURL(geselecteerdeFiles[i]);
            });
            fotoPreview.src = previewDataUrl;

            // Stop als daglimiet bereikt is
            if (getScansVandaag() >= DAGMAX) {
                fouten += (totaal - i);
                scanStatus.className = 'fout';
                scanStatus.style.display = 'block';
                scanStatus.textContent = `⛔ Daglimiet bereikt (${DAGMAX} scans/dag). ${totaal - i} foto's overgeslagen.`;
                break;
            }

            // Stop als rate limit al bereikt is
            if (rateLimitFout) { fouten++; continue; }

            try {
                const { data, mime } = await leesBase64(geselecteerdeFiles[i]);
                const tekst = await scanEenFoto(data, mime);
                incrementTeller(1);

                if (tekst) {
                    tekst.split('\n')
                        .map(r => r.trim())
                        .map(r => r.replace(/\b(\d{4})([A-Za-z]{2})\b/g, '$1 $2'))
                        .filter(r => r.length > 5 && /\d/.test(r) && !/^onleesbaar$/i.test(r))
                        .forEach(r => {
                            if (!gevondenAdressen.find(a => a.tekst === r)) {
                                gevondenAdressen.push({ tekst: r, geselecteerd: true });
                            }
                        });
                }
            } catch (e) {
                fouten++;
            }

            // Stop direct als rate limit bereikt is
            if (rateLimitFout) {
                fouten += (totaal - i - 1);
                break;
            }

            // Pauze tussen foto's om rate limit te voorkomen (4 sec = max ~15/min)
            if (i + 1 < totaal) {
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        // Klaar
        scanProgressBar.style.width = '100%';
        scanProgressTekst.textContent = `Klaar! ${totaal - fouten} van ${totaal} foto's gescand.`;

        setTimeout(() => { scanProgress.style.display = 'none'; }, 2000);

        bezig = false;
        analyseerBtn.disabled = false;

        if (gevondenAdressen.length === 0) {
            scanStatus.className = 'fout';
            scanStatus.style.display = 'block';
            if (rateLimitFout) {
                scanStatus.textContent = '⚠️ API limiet bereikt. Wacht een minuut en probeer opnieuw.';
            } else {
                scanStatus.textContent = '❌ Geen adressen gevonden. Probeer duidelijkere foto\'s.';
            }
            return;
        }

        toonResultaten();
    }

    analyseerBtn.addEventListener('click', scanAllesFotos);

    // ============================================================
    // Resultaten weergave
    // ============================================================
    function toonResultaten() {
        adresLijst.innerHTML = '';

        gevondenAdressen.forEach((adres) => {
            const li = document.createElement('li');
            li.className = 'adres-item' + (adres.geselecteerd ? ' geselecteerd' : '');
            li.innerHTML = `
                <div class="adres-check">✓</div>
                <div class="adres-tekst">${escHtml(adres.tekst)}</div>
            `;
            li.addEventListener('click', () => {
                adres.geselecteerd = !adres.geselecteerd;
                li.classList.toggle('geselecteerd', adres.geselecteerd);
            });
            adresLijst.appendChild(li);
        });

        resultatenSectie.style.display = 'block';
        toevoegenBtn.style.display = 'block';
        noeenBtn.style.display = 'block';
    }

    function escHtml(t) {
        return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ============================================================
    // Wachtrij beheer (localStorage)
    // ============================================================
    function laadWachtrij() {
        try { return JSON.parse(localStorage.getItem(LS_WACHTRIJ) || '[]'); }
        catch { return []; }
    }

    function slaWachtrijOp(lijst) {
        localStorage.setItem(LS_WACHTRIJ, JSON.stringify(lijst));
    }

    function updateWachtrijUI() {
        const wachtrij = laadWachtrij();
        if (wachtrij.length > 0) {
            stapelCount.textContent = wachtrij.length;
            stapelInfo.style.display = 'flex';
            naarRouteBtn.style.display = 'block';
        } else {
            stapelInfo.style.display = 'none';
            naarRouteBtn.style.display = 'none';
        }
    }

    toevoegenBtn.addEventListener('click', () => {
        const geselecteerd = gevondenAdressen.filter(a => a.geselecteerd).map(a => a.tekst);
        if (geselecteerd.length === 0) { alert('Selecteer minimaal één adres.'); return; }

        const wachtrij = laadWachtrij();
        geselecteerd.forEach(adres => {
            if (!wachtrij.includes(adres)) wachtrij.push(adres);
        });
        slaWachtrijOp(wachtrij);
        updateWachtrijUI();

        // Reset
        resultatenSectie.style.display = 'none';
        toevoegenBtn.style.display = 'none';
        noeenBtn.style.display = 'none';
        gevondenAdressen = [];
    });

    noeenBtn.addEventListener('click', () => {
        geselecteerdeFiles = [];
        gevondenAdressen   = [];
        fotoPreview.style.display = 'none';
        fotoPreview.src = '';
        previewPlaceholder.style.display = 'block';
        previewWrap.classList.remove('heeft-foto');
        analyseerBtn.style.display = 'none';
        resultatenSectie.style.display = 'none';
        toevoegenBtn.style.display = 'none';
        noeenBtn.style.display = 'none';
        scanStatus.style.display = 'none';
        scanProgress.style.display = 'none';
        cameraInput.value = '';
        gallerijInput.value = '';
    });

    stapelWis.addEventListener('click', () => {
        if (confirm('Wachtrij leegmaken?')) { slaWachtrijOp([]); updateWachtrijUI(); }
    });

    naarRouteBtn.addEventListener('click', () => {
        window.location.href = 'index.html#import-scan';
    });

    // ============================================================
    // Init
    // ============================================================
    updateWachtrijUI();
    updateTellerUI();

})();
