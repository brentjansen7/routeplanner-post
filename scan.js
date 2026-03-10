(function () {
    'use strict';

    // --- State ---
    const state = {
        provider: 'ocr',
        photos: [],      // { id, file, dataUrl, status: 'pending'|'done'|'error' }
        addresses: [],   // { text, photoId }
        nextId: 1,
    };

    // --- DOM refs ---
    const apiKeyInput = document.getElementById('api-key');
    const apiKeyRow = document.getElementById('api-key-row');
    const apiHint = document.getElementById('api-hint');
    const toggleKeyBtn = document.getElementById('toggle-key-btn');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const photosSection = document.getElementById('photos-section');
    const photosGrid = document.getElementById('photos-grid');
    const photoCount = document.getElementById('photo-count');
    const clearPhotosBtn = document.getElementById('clear-photos-btn');
    const scanAllBtn = document.getElementById('scan-all-btn');
    const resultsSection = document.getElementById('results-section');
    const resultsList = document.getElementById('results-list');
    const resultCount = document.getElementById('result-count');
    const copyAddressesBtn = document.getElementById('copy-addresses-btn');
    const sendToRouteBtn = document.getElementById('send-to-route-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const scanCityInput = document.getElementById('scan-city');

    // --- Load saved API key + provider + city ---
    const savedKey = localStorage.getItem('scan-api-key');
    const savedProvider = localStorage.getItem('scan-provider');
    const savedCity = localStorage.getItem('scan-city');
    if (savedKey) apiKeyInput.value = savedKey;
    if (savedProvider) state.provider = savedProvider;
    if (savedCity) scanCityInput.value = savedCity;

    scanCityInput.addEventListener('input', () => {
        localStorage.setItem('scan-city', scanCityInput.value.trim());
    });

    // --- Provider toggle ---
    document.querySelectorAll('[data-provider]').forEach(btn => {
        if (btn.dataset.provider === state.provider) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-provider]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.provider = btn.dataset.provider;
            localStorage.setItem('scan-provider', state.provider);
            updateProviderUI();
        });
    });

    function updateProviderUI() {
        const isOcr = state.provider === 'ocr';
        apiKeyRow.style.display = isOcr ? 'none' : '';
        if (isOcr) {
            apiHint.textContent = 'Gratis OCR werkt zonder API key — tekst wordt lokaal herkend in de browser.';
        } else if (state.provider === 'gemini') {
            apiHint.textContent = 'Vul je eigen Gemini key in (gratis via aistudio.google.com).';
        } else {
            apiHint.textContent = 'Vul je eigen Claude API key in (anthropic.com).';
        }
    }
    updateProviderUI();

    // --- API key ---
    apiKeyInput.addEventListener('input', () => {
        localStorage.setItem('scan-api-key', apiKeyInput.value.trim());
    });

    toggleKeyBtn.addEventListener('click', () => {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });

    // --- File upload ---
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
        fileInput.value = '';
    });

    function handleFiles(files) {
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            const reader = new FileReader();
            reader.onload = (e) => {
                state.photos.push({
                    id: state.nextId++,
                    file,
                    dataUrl: e.target.result,
                    status: 'pending',
                });
                renderPhotos();
            };
            reader.readAsDataURL(file);
        }
    }

    // --- Render photos ---
    function renderPhotos() {
        photosSection.classList.toggle('hidden', state.photos.length === 0);
        photoCount.textContent = `(${state.photos.length})`;

        photosGrid.innerHTML = '';
        state.photos.forEach(photo => {
            const card = document.createElement('div');
            card.className = `photo-card${photo.status === 'scanning' ? ' scanning' : ''}`;
            const errorTitle = photo.status === 'error' && photo.errorMsg
                ? ` title="${escapeHtml(photo.errorMsg)}"` : '';
            card.innerHTML = `
                <img src="${photo.dataUrl}" alt="Foto" />
                <button class="photo-remove" data-id="${photo.id}">&times;</button>
                <span class="photo-status ${photo.status}"${errorTitle}>${statusIcon(photo.status)}</span>
                ${photo.status === 'error' && photo.errorMsg ? `<div class="photo-error-msg">${escapeHtml(photo.errorMsg)}</div>` : ''}
            `;
            photosGrid.appendChild(card);
        });

        // Remove handlers
        photosGrid.querySelectorAll('.photo-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                state.photos = state.photos.filter(p => p.id !== id);
                state.addresses = state.addresses.filter(a => a.photoId !== id);
                renderPhotos();
                renderResults();
            });
        });
    }

    function statusIcon(status) {
        if (status === 'done') return '&#10003;';
        if (status === 'error') return '!';
        if (status === 'scanning') return '...';
        return '&#8943;';
    }

    clearPhotosBtn.addEventListener('click', () => {
        state.photos = [];
        state.addresses = [];
        renderPhotos();
        renderResults();
    });

    // --- Scan all photos ---
    scanAllBtn.addEventListener('click', async () => {
        let key = apiKeyInput.value.trim();

        if (state.provider !== 'ocr' && !key) {
            alert(`Voor ${state.provider === 'gemini' ? 'Gemini' : 'Claude'} heb je een eigen API key nodig.\nOf kies "Gratis OCR" — die werkt zonder key.`);
            return;
        }

        const pending = state.photos.filter(p => p.status === 'pending' || p.status === 'error');
        if (pending.length === 0) {
            alert('Alle foto\'s zijn al gescand.');
            return;
        }

        showLoading(true, `Scannen: 0 / ${pending.length}...`);

        for (let i = 0; i < pending.length; i++) {
            const photo = pending[i];
            photo.status = 'scanning';
            renderPhotos();
            showLoading(true, `Scannen: ${i + 1} / ${pending.length}...`);

            try {
                const addresses = await scanPhoto(photo, key);
                const valid = addresses.filter(a => !a.startsWith('Geen adres gevonden'));
                if (valid.length > 0) {
                    photo.status = 'done';
                    for (const addr of valid) {
                        state.addresses.push({ text: addr, photoId: photo.id });
                    }
                } else {
                    photo.status = 'error';
                    photo.errorMsg = addresses[0] || 'Geen adres gevonden';
                }
            } catch (err) {
                console.error('Scan error:', err);
                photo.status = 'error';
                photo.errorMsg = err.message || 'Onbekende fout';
            }

            renderPhotos();
            renderResults();
        }

        showLoading(false);

        const errors = state.photos.filter(p => p.status === 'error');
        if (errors.length > 0 && state.addresses.length === 0) {
            const msg = errors[0].errorMsg || 'Onbekende fout';
            alert(`Scannen mislukt:\n${msg}\n\nControleer je API key of probeer het opnieuw.`);
        }
    });

    // --- AI scan ---
    async function scanPhoto(photo, apiKey) {
        const base64 = photo.dataUrl.split(',')[1];
        const mimeType = photo.file.type || 'image/jpeg';

        if (state.provider === 'ocr') {
            return await scanWithTesseract(photo.dataUrl);
        } else if (state.provider === 'gemini') {
            return await scanWithGemini(base64, mimeType, apiKey);
        } else {
            return await scanWithClaude(base64, mimeType, apiKey);
        }
    }

    // Worker wordt vooraf geladen bij pagina-start
    let _workerReady = null;
    function preloadWorker() {
        _workerReady = Tesseract.createWorker('nld+eng')
            .catch(() => null);
    }
    preloadWorker();

    async function getWorker() {
        if (!_workerReady) preloadWorker();
        const worker = await _workerReady;
        if (!worker) throw new Error('OCR worker kon niet laden');
        return worker;
    }

    function preprocessImage(dataUrl, { maxWidth, filter }) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (maxWidth && w > maxWidth) {
                    h = Math.round(h * maxWidth / w);
                    w = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (filter) ctx.filter = filter;
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.95));
            };
            img.src = dataUrl;
        });
    }

    function hasValidAddress(addresses) {
        return addresses.some(isRealisticAddress);
    }

    // Controleert of een adres er logisch uitziet (geen rommel)
    function isRealisticAddress(text) {
        if (!text || text.length < 6) return false;

        // Moet een Nederlandse postcode hebben
        const postcodeRe = /\b\d{4}\s*[A-Za-z]{2}\b/;
        if (!postcodeRe.test(text)) return false;

        // Moet minstens één woord van 3+ letters bevatten (straatnaam of plaatsnaam)
        const hasWord = /[A-Za-zÀ-ÿ]{3,}/.test(text);
        if (!hasWord) return false;

        // Mag niet meer dan 40% speciale tekens zijn (rommel-check)
        const specialChars = (text.match(/[^A-Za-z0-9À-ÿ\s,.\-]/g) || []).length;
        if (specialChars / text.length > 0.4) return false;

        // Huisnummer moet aanwezig zijn — maar postcode-cijfers tellen NIET mee
        const withoutPostcode = text.replace(/\b\d{4}\s*[A-Za-z]{2}\b/, '');
        const houseNr = withoutPostcode.match(/\b(\d+)\b/g) || [];
        const hasRealisticNr = houseNr.some(n => parseInt(n) >= 1 && parseInt(n) <= 9999);
        if (!hasRealisticNr) return false;

        return true;
    }

    async function scanWithTesseract(dataUrl) {
        const worker = await getWorker();
        const city = scanCityInput.value.trim();

        // Strategieën: elke poging met betere beeldverwerking als vorige mislukt
        const strategies = [
            { maxWidth: 2000, filter: null },
            { maxWidth: 2000, filter: 'contrast(1.5) brightness(1.05)' },
            { maxWidth: 2000, filter: 'grayscale(1) contrast(2)' },
            { maxWidth: null,  filter: 'grayscale(1) contrast(2.5) brightness(1.1)' },
        ];

        let lastResult = null;
        for (const strategy of strategies) {
            const processed = await preprocessImage(dataUrl, strategy);
            const { data } = await worker.recognize(processed);
            const result = parseRecipientAddress(data, city);
            lastResult = result;
            if (hasValidAddress(result)) return result;
        }

        return lastResult;
    }

    // Normaliseer adres naar "Straatnaam Huisnummer, 1234 AB Plaats"
    function normalizeAddress(street, postcodeText, city) {
        // Postcode normaliseren: "1234ab" → "1234 AB"
        const pcMatch = postcodeText.match(/(\d{4})\s*([A-Za-z]{2})(.*)/);
        if (!pcMatch) return street || postcodeText;
        const postcode = `${pcMatch[1]} ${pcMatch[2].toUpperCase()}`;

        // Gebruik altijd de door gebruiker ingevulde stad (betrouwbaarder dan OCR)
        // Als die er niet is: lees uit OCR maar ruim rommel op
        let place = city.trim();
        if (!place) {
            let cityInPc = pcMatch[3].trim();
            // Strip trailing losse letters/cijfers (OCR-rommel zoals "I", "l", "1")
            cityInPc = cityInPc.replace(/(\s+[A-Za-z0-9]{1,2})+$/, '').trim();
            place = cityInPc.length > 2 ? cityInPc : '';
        }

        // Straatnaam opruimen: alleen letters, cijfers, spaties en koppeltekens
        const cleanStreet = street.replace(/[^A-Za-zÀ-ÿ0-9\s\-]/g, '').replace(/\s+/g, ' ').trim();

        if (cleanStreet && place) return `${cleanStreet}, ${postcode} ${place}`;
        if (cleanStreet) return `${cleanStreet}, ${postcode}`;
        if (place) return `${postcode} ${place}`;
        return postcode;
    }

    // Probeert een straatregel te parsen naar { name, number } of null als het geen echte straat is
    function parseStreetLine(text) {
        // Strip leading garbage symbols (©, –, •, etc.)
        const t = text.trim().replace(/^[^A-Za-zÀ-ÿ]+/, '');
        // Moet beginnen met minstens 3 letters (werkt ook bij HOOFDLETTERS zoals "HYACINT 8")
        if (!/^[A-Za-zÀ-ÿ]{3,}/.test(t)) return null;
        // Straatnaam mag ALLEEN letters/spaties/koppeltekens bevatten, gevolgd door 1 huisnummer
        // Optionele komma tussen naam en nummer ("Pluim-es, 104" → naam="Pluim-es", nummer="104")
        const match = t.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-\.\']*),?\s+(\d{1,4}[A-Za-z]?)\s*$/);
        if (!match) return null;
        const name = match[1].trim();
        const number = match[2];
        // Straatnaam mag geen lange reeksen van 1-2 letter fragmenten bevatten (rommel)
        const words = name.split(/\s+/);
        const shortWords = words.filter(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length <= 2);
        if (shortWords.length > words.length / 2) return null;
        return { name, number };
    }

    function parseRecipientAddress(data, city = '') {
        const postcodeRe = /\b(\d{4})\s*([A-Za-z]{2})\b/;
        const lines = data.lines || [];
        const cityLower = city.toLowerCase();

        // Als er een plaats is ingevuld: zoek de postcode-regel die bij die plaats hoort
        // Anders: pak de postcode-regel die het LAAGST staat (= ontvanger)
        let recipientLine = null;
        let maxY = -1;

        for (const line of lines) {
            const text = line.text.trim();
            if (!postcodeRe.test(text)) continue;

            if (cityLower) {
                // Kijk of deze regel of de regels rondom de plaatsnaam bevatten
                const idx = lines.indexOf(line);
                const context = lines.slice(Math.max(0, idx - 2), idx + 3)
                    .map(l => l.text.toLowerCase()).join(' ');
                if (context.includes(cityLower) && line.bbox.y0 > maxY) {
                    maxY = line.bbox.y0;
                    recipientLine = line;
                }
            } else {
                if (line.bbox.y0 > maxY) {
                    maxY = line.bbox.y0;
                    recipientLine = line;
                }
            }
        }

        // Als plaatsfilter niets oplevert, val terug op laagste postcode
        if (!recipientLine && cityLower) {
            for (const line of lines) {
                const text = line.text.trim();
                if (postcodeRe.test(text) && line.bbox.y0 > maxY) {
                    maxY = line.bbox.y0;
                    recipientLine = line;
                }
            }
        }

        if (!recipientLine) {
            return ['Geen adres gevonden — maak een dichtere foto van het adres-label'];
        }

        // Zoek de straatregel: de regel direct boven de postcode-regel
        const above = lines
            .filter(l => l.bbox.y0 < recipientLine.bbox.y0)
            .sort((a, b) => b.bbox.y0 - a.bbox.y0);

        let parsed = above.slice(0, 5).reduce((found, l) => found || parseStreetLine(l.text), null);

        // Fallback: soms zet Tesseract straat + postcode op 1 regel
        // Zoek dan naar tekst VÓÓR de postcode op diezelfde regel
        if (!parsed) {
            const beforePostcode = recipientLine.text.replace(/\d{4}\s*[A-Za-z]{2}.*$/, '').trim();
            if (beforePostcode) parsed = parseStreetLine(beforePostcode);
        }

        // Bouw straat op als "Naam Huisnummer" zodat er altijd maar 1 huisnummer is
        const street = parsed ? `${parsed.name} ${parsed.number}` : '';

        // Strip leading non-alphanumeric rommel (bv. "| 2925CN" → "2925CN")
        const pcText = recipientLine.text.trim().replace(/^[^A-Za-z0-9]+/, '');
        const finalAddress = normalizeAddress(street, pcText, city);

        // Eindscheck: geef alleen terug als het er als een echt adres uitziet
        if (!isRealisticAddress(finalAddress)) {
            return ['Geen adres gevonden — maak een dichtere foto van het adres-label'];
        }
        return [finalAddress];
    }

    async function scanWithGemini(base64, mimeType, apiKey) {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                text: 'Lees alle post-adressen (bezorgadressen) die je ziet in deze foto. ' +
                                    'Geef elk adres op een aparte regel, in het formaat: Straatnaam Huisnummer, Postcode Plaats. ' +
                                    'Geef ALLEEN de adressen, geen uitleg of extra tekst. ' +
                                    'Als je geen adressen ziet, antwoord dan met "GEEN".'
                            },
                            {
                                inline_data: { mime_type: mimeType, data: base64 }
                            }
                        ]
                    }]
                })
            }
        );

        if (!res.ok) {
            const err = await res.text();
            if (res.status === 429) {
                throw new Error('Quota overschreden. Haal een gratis API key op via aistudio.google.com en vul hem in bij Instellingen.');
            }
            throw new Error(`Gemini API error: ${res.status} - ${err}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return parseAddresses(text);
    }

    async function scanWithClaude(base64, mimeType, apiKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64,
                            }
                        },
                        {
                            type: 'text',
                            text: 'Lees alle post-adressen (bezorgadressen) die je ziet in deze foto. ' +
                                'Geef elk adres op een aparte regel, in het formaat: Straatnaam Huisnummer, Postcode Plaats. ' +
                                'Geef ALLEEN de adressen, geen uitleg of extra tekst. ' +
                                'Als je geen adressen ziet, antwoord dan met "GEEN".'
                        }
                    ]
                }]
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Claude API error: ${res.status} - ${err}`);
        }

        const data = await res.json();
        const text = data.content?.[0]?.text || '';
        return parseAddresses(text);
    }

    function parseAddresses(text) {
        if (!text || text.trim().toUpperCase() === 'GEEN') return [];
        return text
            .split('\n')
            .map(line => line.replace(/^(\d+[.)]\s*|-\s*)/, '').trim())
            .filter(line => line.length > 3 && line.toUpperCase() !== 'GEEN');
    }

    // --- Render results ---
    function renderResults() {
        resultsSection.classList.toggle('hidden', state.addresses.length === 0);
        resultCount.textContent = state.addresses.length;

        resultsList.innerHTML = '';
        state.addresses.forEach((addr, i) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="result-address">${escapeHtml(addr.text)}</span>
                <span class="result-source">Foto ${addr.photoId}</span>
                <button class="result-remove" data-idx="${i}">&times;</button>
            `;
            resultsList.appendChild(li);
        });

        resultsList.querySelectorAll('.result-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                state.addresses.splice(parseInt(btn.dataset.idx), 1);
                renderResults();
            });
        });
    }

    // --- Copy addresses ---
    copyAddressesBtn.addEventListener('click', () => {
        const text = state.addresses.map(a => a.text).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            copyAddressesBtn.textContent = 'Gekopieerd!';
            setTimeout(() => {
                copyAddressesBtn.innerHTML = '&#128203; Kopieer adressen';
            }, 2000);
        });
    });

    // --- Send to route planner ---
    sendToRouteBtn.addEventListener('click', () => {
        const addresses = state.addresses.map(a => a.text);
        // Store in localStorage for the route planner to pick up
        localStorage.setItem('scanned-addresses', JSON.stringify(addresses));
        window.location.href = 'index.html?import=scan';
    });

    // --- Helpers ---
    function showLoading(show, text) {
        loadingOverlay.classList.toggle('hidden', !show);
        if (text) loadingText.textContent = text;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
