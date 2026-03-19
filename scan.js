// ============================================================
// Scan adressen – Gemini Vision API integratie
// Foto van pakket → bezorgadres automatisch herkend
// ============================================================

(function () {
    'use strict';

    const PROXY_URL   = 'https://gemini-proxy.brent-jansen2009.workers.dev';
    const LS_WACHTRIJ = 'scanWachtrij';

    const cameraBtn     = document.getElementById('camera-btn');
    const gallerijBtn   = document.getElementById('gallerij-btn');
    const cameraInput   = document.getElementById('camera-input');
    const gallerijInput = document.getElementById('gallerij-input');
    const fotoPreview   = document.getElementById('foto-preview');
    const previewWrap   = document.getElementById('preview-wrap');
    const previewPlaceholder = document.getElementById('preview-placeholder');
    const analyseerBtn  = document.getElementById('analyseer-btn');
    const scanStatus    = document.getElementById('scan-status');

    const resultatenSectie = document.getElementById('resultaten-sectie');
    const adresLijst       = document.getElementById('adres-lijst');
    const toevoegenBtn     = document.getElementById('toevoegen-btn');
    const noeenBtn         = document.getElementById('nogeen-btn');

    const stapelInfo  = document.getElementById('stapel-info');
    const stapelCount = document.getElementById('stapel-count');
    const stapelWis   = document.getElementById('stapel-wis');
    const naarRouteBtn = document.getElementById('naar-route-btn');

    // --- State ---
    let huidigeFoto = null;      // base64 string zonder prefix
    let huidigeMime = 'image/jpeg';
    let gevondenAdressen = [];   // [{ tekst, geselecteerd }]

    // ============================================================
    // Foto verwerking
    // ============================================================

    function verwerkFoto(file) {
        if (!file) return;
        huidigeMime = file.type || 'image/jpeg';
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            // Haal base64 data op (zonder "data:image/jpeg;base64," prefix)
            huidigeFoto = dataUrl.split(',')[1];

            fotoPreview.src = dataUrl;
            fotoPreview.style.display = 'block';
            previewPlaceholder.style.display = 'none';
            previewWrap.classList.add('heeft-foto');
            analyseerBtn.style.display = 'flex';

            // Reset vorige resultaten
            resultatenSectie.style.display = 'none';
            scanStatus.className = '';
            scanStatus.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    cameraBtn.addEventListener('click', () => cameraInput.click());
    gallerijBtn.addEventListener('click', () => gallerijInput.click());
    cameraInput.addEventListener('change', e => verwerkFoto(e.target.files[0]));
    gallerijInput.addEventListener('change', e => verwerkFoto(e.target.files[0]));

    // ============================================================
    // Gemini API aanroep
    // ============================================================

    async function scanMetGemini() {
        if (!huidigeFoto) {
            scanStatus.className = 'fout';
            scanStatus.textContent = '⚠️ Maak eerst een foto.';
            return;
        }

        analyseerBtn.disabled = true;
        scanStatus.className = 'laden';
        scanStatus.textContent = '🔍 Adres wordt herkend... even geduld';
        resultatenSectie.style.display = 'none';

        const prompt = `Lees het BEZORGADRES van dit pakket.
Geef ALLEEN het adres terug, één adres per regel, in dit formaat:
Straatnaam Huisnummer, Postcode Plaats

Voorbeeld:
Lavendel 63, 2925 XE Krimpen aan den IJssel

Als er meerdere bezorgadressen op de foto staan, geef ze allemaal op aparte regels.
Geef GEEN afzendadres, GEEN namen, GEEN extra uitleg. Alleen het adres.`;

        try {
            const resp = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inline_data: { mime_type: huidigeMime, data: huidigeFoto } }
                        ]
                    }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
                })
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                const msg = err?.error?.message || `HTTP ${resp.status}`;
                if (resp.status === 429) {
                    scanStatus.className = 'fout';
                    scanStatus.textContent = '⏳ Te veel verzoeken. Wacht even en probeer opnieuw.';
                } else {
                    scanStatus.className = 'fout';
                    scanStatus.textContent = `❌ Fout: ${msg}`;
                }
                analyseerBtn.disabled = false;
                return;
            }

            const data = await resp.json();
            const tekst = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

            verwerkResultaat(tekst);

        } catch (e) {
            scanStatus.className = 'fout';
            scanStatus.textContent = `❌ Netwerkfout: ${e.message}`;
            analyseerBtn.disabled = false;
        }
    }

    function verwerkResultaat(tekst) {
        analyseerBtn.disabled = false;
        scanStatus.style.display = 'none';

        // Splits op regels, filter lege regels
        const regels = tekst.split('\n')
            .map(r => r.trim())
            .filter(r => r.length > 5 && /\d/.test(r)); // moet een cijfer bevatten

        if (regels.length === 0) {
            scanStatus.className = 'fout';
            scanStatus.textContent = '❌ Geen adres gevonden. Probeer een duidelijkere foto.';
            return;
        }

        gevondenAdressen = regels.map(tekst => ({ tekst, geselecteerd: true }));
        toonResultaten();
    }

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
        const geselecteerd = gevondenAdressen
            .filter(a => a.geselecteerd)
            .map(a => a.tekst);

        if (geselecteerd.length === 0) {
            alert('Selecteer minimaal één adres.');
            return;
        }

        const wachtrij = laadWachtrij();
        geselecteerd.forEach(adres => {
            if (!wachtrij.includes(adres)) wachtrij.push(adres);
        });
        slaWachtrijOp(wachtrij);
        updateWachtrijUI();

        // Reset voor volgende scan
        resultatenSectie.style.display = 'none';
        toevoegenBtn.style.display = 'none';
        noeenBtn.style.display = 'none';
        gevondenAdressen = [];
    });

    noeenBtn.addEventListener('click', () => {
        // Reset foto en resultaten voor nieuwe scan
        huidigeFoto = null;
        fotoPreview.style.display = 'none';
        fotoPreview.src = '';
        previewPlaceholder.style.display = 'block';
        previewWrap.classList.remove('heeft-foto');
        analyseerBtn.style.display = 'none';
        resultatenSectie.style.display = 'none';
        toevoegenBtn.style.display = 'none';
        noeenBtn.style.display = 'none';
        scanStatus.style.display = 'none';
        gevondenAdressen = [];
        // Reset file inputs zodat dezelfde foto opnieuw geselecteerd kan worden
        cameraInput.value = '';
        gallerijInput.value = '';
    });

    stapelWis.addEventListener('click', () => {
        if (confirm('Wachtrij leegmaken?')) {
            slaWachtrijOp([]);
            updateWachtrijUI();
        }
    });

    naarRouteBtn.addEventListener('click', () => {
        window.location.href = 'index.html#import-scan';
    });

    analyseerBtn.addEventListener('click', scanMetGemini);

    // ============================================================
    // Init
    // ============================================================
    updateWachtrijUI();

})();
