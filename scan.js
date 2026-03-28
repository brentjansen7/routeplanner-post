// ============================================================
// Scan adressen – Gemini Vision API integratie
// Foto van pakket → bezorgadres automatisch herkend
// ============================================================

(function () {
    'use strict';

    const PROXY_URL   = 'https://gemini-proxy.brent-jansen2009.workers.dev';
    const LS_WACHTRIJ = 'scanWachtrij';

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
    async function scanEenFoto(base64, mime, pogingen = 3) {
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

        if (resp.status === 429 && pogingen > 1) {
            // Rate limit: wacht 15 seconden en probeer opnieuw
            await new Promise(r => setTimeout(r, 15000));
            return scanEenFoto(base64, mime, pogingen - 1);
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
        bezig = true;
        analyseerBtn.disabled = true;
        gevondenAdressen = [];

        const totaal = geselecteerdeFiles.length;
        scanProgress.style.display = 'block';
        scanStatus.style.display = 'none';
        resultatenSectie.style.display = 'none';

        let fouten = 0;

        // Verwerk in batches van 3 parallel (3× sneller dan sequentieel)
        const batchSize = 3;
        for (let i = 0; i < totaal; i += batchSize) {
            const batch = geselecteerdeFiles.slice(i, i + batchSize);

            // Progress bijwerken naar eerste van deze batch
            const pct = Math.round((i / totaal) * 100);
            scanProgressBar.style.width = pct + '%';
            scanProgressTekst.textContent =
                `Foto ${i + 1}–${Math.min(i + batchSize, totaal)} van ${totaal} worden gescand...`;

            // Preview bijwerken naar eerste foto van de batch
            const previewDataUrl = await new Promise(r => {
                const rd = new FileReader();
                rd.onload = e => r(e.target.result);
                rd.readAsDataURL(batch[0]);
            });
            fotoPreview.src = previewDataUrl;

            // Scan de batch parallel
            const batchResultaten = await Promise.all(batch.map(async file => {
                try {
                    const { data, mime } = await leesBase64(file);
                    return await scanEenFoto(data, mime);
                } catch (e) {
                    fouten++;
                    return '';
                }
            }));

            // Verwerk gevonden adressen
            for (const tekst of batchResultaten) {
                if (!tekst) continue;
                tekst.split('\n')
                    .map(r => r.trim())
                    // Postcode normaliseren: 2925EZ → 2925 EZ
                    .map(r => r.replace(/\b(\d{4})([A-Za-z]{2})\b/g, '$1 $2'))
                    .filter(r => r.length > 5 && /\d/.test(r) && !/^onleesbaar$/i.test(r))
                    .forEach(r => {
                        if (!gevondenAdressen.find(a => a.tekst === r)) {
                            gevondenAdressen.push({ tekst: r, geselecteerd: true });
                        }
                    });
            }

            // Pauze tussen batches (rate limit)
            if (i + batchSize < totaal) {
                await new Promise(r => setTimeout(r, 2000));
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
            scanStatus.textContent = '❌ Geen adressen gevonden. Probeer duidelijkere foto\'s.';
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

})();
