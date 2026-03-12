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

    // --- Load saved API key + provider + city + scan resultaten ---
    const savedKey = localStorage.getItem('scan-api-key');
    const savedProvider = localStorage.getItem('scan-provider');
    const savedCity = localStorage.getItem('scan-city');
    const savedResults = localStorage.getItem('scan-results');
    if (savedKey) apiKeyInput.value = savedKey;
    if (savedProvider) state.provider = savedProvider;
    if (savedCity) scanCityInput.value = savedCity;
    if (savedResults) {
        try {
            const parsed = JSON.parse(savedResults);
            if (Array.isArray(parsed) && parsed.length > 0) {
                state.addresses = parsed;
                renderResults();
            }
        } catch (_) {}
    }

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
                const dataUrl = e.target.result;
                // Maak klein thumbnail (200px) voor weergave — los van de grote scan-dataUrl
                const img = new Image();
                img.onload = () => {
                    const c = document.createElement('canvas');
                    const scale = Math.min(1, 200 / img.width);
                    c.width = Math.round(img.width * scale);
                    c.height = Math.round(img.height * scale);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    state.photos.push({
                        id: state.nextId++,
                        file,
                        dataUrl,
                        thumbUrl: c.toDataURL('image/jpeg', 0.7),
                        status: 'pending',
                    });
                    renderPhotos();
                };
                img.src = dataUrl;
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
                <img src="${photo.thumbUrl || photo.dataUrl || ''}" alt="Foto" />
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

        // Scherm wakker houden tijdens scannen
        let wakeLock = null;
        if ('wakeLock' in navigator) {
            try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
        }

        // Vraag toestemming voor notificaties (één keer)
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        const startAddressCount = state.addresses.length;

        for (let i = 0; i < pending.length; i++) {
            const photo = pending[i];
            photo.status = 'scanning';
            renderPhotos();
            showLoading(true, `Scannen: ${i + 1} / ${pending.length}...`);

            try {
                const addresses = await scanPhoto(photo, key);
                const valid = addresses.filter(a => isRealisticAddress(a));
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

            // Foto uit geheugen vrijgeven na scannen (behoudt kleine thumbnail URL)
            photo.dataUrl = null;

            // Sla gevonden adressen op zodat ze bewaard blijven als de app sluit
            localStorage.setItem('scan-results', JSON.stringify(state.addresses));

            renderPhotos();
            renderResults();

            // Worker herstarten elke 10 foto's om geheugenlek te voorkomen
            if ((i + 1) % 10 === 0) {
                if (_workerReady) {
                    const w = await _workerReady;
                    if (w) await w.terminate();
                }
                _workerReady = null;
                preloadWorker();
            }
        }

        // Scherm-wakker-lock vrijgeven
        if (wakeLock) wakeLock.release();

        showLoading(false);

        // Pushnotificatie als het scannen klaar is
        const newFound = state.addresses.length - startAddressCount;
        const errors = state.photos.filter(p => p.status === 'error');
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Route Optimizer', {
                body: newFound > 0
                    ? `✅ ${newFound} adres${newFound !== 1 ? 'sen' : ''} gevonden!${errors.length ? ` (${errors.length} mislukt)` : ''}`
                    : `❌ Geen adressen gevonden — maak dichtere foto's van de labels.`,
                icon: 'icon-192.svg'
            });
        }

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

    // Verwerk afbeelding voor OCR: schalen, croppen, contrast aanpassen
    // crop = { x, y, w, h } als fracties van 0-1 (bijv. { x:0, y:0.5, w:1, h:0.5 } = onderste helft)
    function preprocessImage(dataUrl, { maxWidth = 2500, filter, binarize, autoContrast, crop, invert, sharpen, otsu } = {}) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                // Bepaal bronregio (crop of volledig)
                const srcX = crop ? Math.round(crop.x * img.width)  : 0;
                const srcY = crop ? Math.round(crop.y * img.height) : 0;
                const srcW = crop ? Math.round(crop.w * img.width)  : img.width;
                const srcH = crop ? Math.round(crop.h * img.height) : img.height;

                // Schaal naar maxWidth — maar crop-regio's opschalen voor beter detail
                let dstW = srcW, dstH = srcH;
                if (maxWidth && dstW > maxWidth) {
                    dstH = Math.round(dstH * maxWidth / dstW);
                    dstW = maxWidth;
                } else if (crop && dstW < 1500) {
                    // Kleine crop opschalen voor meer detail
                    const scale = Math.min(3, 1500 / dstW);
                    dstW = Math.round(dstW * scale);
                    dstH = Math.round(dstH * scale);
                }

                const canvas = document.createElement('canvas');
                canvas.width = dstW;
                canvas.height = dstH;
                const ctx = canvas.getContext('2d');
                if (filter) ctx.filter = filter;
                ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);
                ctx.filter = 'none';

                // Pixel-manipulaties op het canvas
                const imgData = ctx.getImageData(0, 0, dstW, dstH);
                const d = imgData.data;

                // Stap 1: omzetten naar grijswaarden
                const lums = new Float32Array(dstW * dstH);
                for (let i = 0, p = 0; i < d.length; i += 4, p++) {
                    lums[p] = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
                }

                // Stap 2: verscherpen (unsharp mask) voor wazige labels
                let sharpened = lums;
                if (sharpen) {
                    sharpened = new Float32Array(dstW * dstH);
                    const strength = typeof sharpen === 'number' ? sharpen : 1.5;
                    for (let y = 1; y < dstH - 1; y++) {
                        for (let x = 1; x < dstW - 1; x++) {
                            const p = y * dstW + x;
                            const blur = (lums[p-1] + lums[p+1] + lums[p-dstW] + lums[p+dstW]) * 0.25;
                            sharpened[p] = Math.max(0, Math.min(255, lums[p] + strength * (lums[p] - blur)));
                        }
                    }
                }

                // Stap 3: auto-contrast = histogram stretchen naar 0-255
                let min = 255, max = 0;
                if (autoContrast || binarize || otsu) {
                    for (let p = 0; p < sharpened.length; p++) {
                        if (sharpened[p] < min) min = sharpened[p];
                        if (sharpened[p] > max) max = sharpened[p];
                    }
                }
                const range = max - min || 1;

                // Stap 4: Otsu drempelwaarde berekenen (voor optimale binarisatie)
                let otsuThreshold = 128;
                if (otsu || binarize === 'otsu') {
                    const hist = new Int32Array(256);
                    for (let p = 0; p < sharpened.length; p++) {
                        hist[Math.round((sharpened[p] - min) / range * 255)]++;
                    }
                    const total = sharpened.length;
                    let sum = 0;
                    for (let i = 0; i < 256; i++) sum += i * hist[i];
                    let sumB = 0, wB = 0, maxVar = 0;
                    for (let t = 0; t < 256; t++) {
                        wB += hist[t];
                        if (!wB) continue;
                        const wF = total - wB;
                        if (!wF) break;
                        sumB += t * hist[t];
                        const mB = sumB / wB;
                        const mF = (sum - sumB) / wF;
                        const between = wB * wF * (mB - mF) * (mB - mF);
                        if (between > maxVar) { maxVar = between; otsuThreshold = t; }
                    }
                }

                for (let i = 0, p = 0; i < d.length; i += 4, p++) {
                    let val = (autoContrast || binarize || otsu)
                        ? Math.round((sharpened[p] - min) / range * 255)
                        : sharpened[p];

                    // Binarisatie na auto-contrast
                    const threshold = (binarize === 'otsu' || otsu) ? otsuThreshold : binarize;
                    if (threshold) val = val > threshold ? 255 : 0;
                    // Inverteer (voor donkere achtergrond met lichte tekst)
                    if (invert) val = 255 - val;

                    d[i] = d[i+1] = d[i+2] = val;
                    d[i+3] = 255;
                }
                ctx.putImageData(imgData, 0, 0);

                resolve(canvas.toDataURL('image/png'));
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
        // \b\d+ matcht ook "12" in "12A" of "12-14"
        const withoutPostcode = text.replace(/\b\d{4}\s*[A-Za-z]{2}\b/, '');
        const houseNr = withoutPostcode.match(/\b\d+/g) || [];
        const hasRealisticNr = houseNr.some(n => parseInt(n) >= 1 && parseInt(n) <= 9999);
        if (!hasRealisticNr) return false;

        return true;
    }

    async function scanWithTesseract(dataUrl) {
        const worker = await getWorker();
        const city = scanCityInput.value.trim();

        // Regio-definities (fracties van de afbeelding)
        const FULL       = null;
        const TOP_HALF   = { x: 0,    y: 0,    w: 1,    h: 0.5  };
        const BOT_HALF   = { x: 0,    y: 0.5,  w: 1,    h: 0.5  };
        const MID_STRIP  = { x: 0,    y: 0.25, w: 1,    h: 0.5  };
        const BOT_LEFT   = { x: 0,    y: 0.45, w: 0.55, h: 0.55 };
        const BOT_RIGHT  = { x: 0.45, y: 0.45, w: 0.55, h: 0.55 };
        const TOP_LEFT   = { x: 0,    y: 0,    w: 0.55, h: 0.55 };
        const TOP_RIGHT  = { x: 0.45, y: 0,    w: 0.55, h: 0.55 };
        const MID_LEFT   = { x: 0,    y: 0.2,  w: 0.55, h: 0.6  };
        const MID_RIGHT  = { x: 0.45, y: 0.2,  w: 0.55, h: 0.6  };

        // Strategieën per PSM-mode — probeer PSM 6 (tekst-blok) en PSM 4 (kolom) allebei
        // Gerangschikt van meest naar minst kansrijk
        const strategiesList = [
            // Volledige foto — snel en werkt voor duidelijke labels
            { psm: 6, crop: FULL,      autoContrast: true, sharpen: 1.5              },
            { psm: 6, crop: FULL,      autoContrast: true, otsu: true                },
            { psm: 4, crop: FULL,      autoContrast: true, sharpen: 1.5              },

            // Onderste helft — stickers zitten vaak onderaan
            { psm: 6, crop: BOT_HALF,  autoContrast: true, sharpen: 1.5              },
            { psm: 6, crop: BOT_HALF,  autoContrast: true, otsu: true                },
            { psm: 4, crop: BOT_HALF,  autoContrast: true, otsu: true                },

            // Bovenste helft
            { psm: 6, crop: TOP_HALF,  autoContrast: true, otsu: true                },

            // Midden-strip (horizontale baan door midden)
            { psm: 6, crop: MID_STRIP, autoContrast: true, otsu: true                },

            // Hoeken — label kan overal zitten
            { psm: 6, crop: BOT_LEFT,  autoContrast: true, otsu: true                },
            { psm: 6, crop: BOT_RIGHT, autoContrast: true, otsu: true                },
            { psm: 6, crop: TOP_LEFT,  autoContrast: true, otsu: true                },
            { psm: 6, crop: TOP_RIGHT, autoContrast: true, otsu: true                },

            // Midden-kolommen
            { psm: 6, crop: MID_LEFT,  autoContrast: true, otsu: true                },
            { psm: 6, crop: MID_RIGHT, autoContrast: true, otsu: true                },

            // Fallbacks: geïnverteerd voor donkere stickers met lichte tekst
            { psm: 6, crop: FULL,      autoContrast: true, otsu: true, invert: true   },
            { psm: 6, crop: BOT_HALF,  autoContrast: true, otsu: true, invert: true   },

            // PSM 11 (ruwe tekstdetectie) als alles faalt
            { psm: 11, crop: FULL,     autoContrast: true, otsu: true                },
            { psm: 11, crop: BOT_HALF, autoContrast: true, otsu: true                },
        ];

        let lastResult = null;
        let lastPsm = null;
        for (const strategy of strategiesList) {
            // PSM enkel instellen als hij verandert
            if (strategy.psm !== lastPsm) {
                await worker.setParameters({ tessedit_pageseg_mode: strategy.psm });
                lastPsm = strategy.psm;
            }
            const { psm: _psm, ...preprocessOpts } = strategy;
            const processed = await preprocessImage(dataUrl, preprocessOpts);
            const { data } = await worker.recognize(processed);
            const result = parseRecipientAddress(data, city);
            lastResult = result;
            if (hasValidAddress(result)) return result;
        }

        return lastResult ?? ['Geen adres gevonden — maak een dichtere foto van het adres-label'];
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
        // Strip leading én trailing garbage (©, ;, |, etc.)
        const t = text.trim().replace(/^[^A-Za-zÀ-ÿ\d]+/, '').replace(/[^A-Za-z0-9]+$/, '').trim();

        // Speciaal geval: straat begint met cijfer (bijv. "2e Hyacintstraat 8")
        const startsWithNum = /^\d[A-Za-z]?\s+[A-Za-zÀ-ÿ]/.test(t);

        // Moet beginnen met minstens 2 letters OF een getal gevolgd door letters
        if (!startsWithNum && !/^[A-Za-zÀ-ÿ]{2,}/.test(t)) return null;

        // Straatnaam + huisnummer — soepelere regex:
        // - naam kan beginnen met getal ("2e ...", "3de ...")
        // - komma/puntkomma toegestaan tussen naam en huisnummer
        // - toevoeging na huisnummer toegestaan (bijv. "12A", "12-14", "12 bis")
        const match = t.match(
            /^((?:\d[A-Za-z]?\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-\.\']*?)[,;\s]+(\d{1,4}[A-Za-z\-]?(?:\s*(?:bis|ter))?)[\s,;]*$/i
        );
        if (!match) return null;

        const name = match[1].trim();
        const number = match[2].trim();

        if (!name || name.length < 2) return null;

        // Straatnaam mag geen lange reeksen van 1-2 letter fragmenten bevatten (rommel)
        const words = name.split(/\s+/);
        const longWords = words.filter(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3);
        if (longWords.length === 0) return null;

        // Bedrijfsnamen uitsluiten: naam zonder spaties mag max 26 letters zijn
        const nameLetters = name.replace(/[^A-Za-zÀ-ÿ]/g, '');
        if (nameLetters.length > 26) return null;

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

        // Maximaal 5 regels boven de postcode (bedrijfsnamen worden afgevangen door 26-char limiet)
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
