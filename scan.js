(function () {
    'use strict';

    // --- State ---
    const state = {
        provider: 'gemini',
        photos: [],      // { id, file, dataUrl, status: 'pending'|'done'|'error' }
        addresses: [],   // { text, photoId }
        nextId: 1,
    };

    // --- DOM refs ---
    const apiKeyInput = document.getElementById('api-key');
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

    // --- Load saved API key + provider ---
    const savedKey = localStorage.getItem('scan-api-key');
    const savedProvider = localStorage.getItem('scan-provider');
    if (savedKey) apiKeyInput.value = savedKey;
    if (savedProvider) state.provider = savedProvider;

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
        });
    });

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
            card.innerHTML = `
                <img src="${photo.dataUrl}" alt="Foto" />
                <button class="photo-remove" data-id="${photo.id}">&times;</button>
                <span class="photo-status ${photo.status}">${statusIcon(photo.status)}</span>
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
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('Vul eerst je API key in.');
            apiKeyInput.focus();
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
                photo.status = 'done';
                for (const addr of addresses) {
                    state.addresses.push({ text: addr, photoId: photo.id });
                }
            } catch (err) {
                console.error('Scan error:', err);
                photo.status = 'error';
            }

            renderPhotos();
            renderResults();
        }

        showLoading(false);
    });

    // --- AI scan ---
    async function scanPhoto(photo, apiKey) {
        const base64 = photo.dataUrl.split(',')[1];
        const mimeType = photo.file.type || 'image/jpeg';

        if (state.provider === 'gemini') {
            return await scanWithGemini(base64, mimeType, apiKey);
        } else {
            return await scanWithClaude(base64, mimeType, apiKey);
        }
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
            .map(line => line.replace(/^[-\d.)\s]+/, '').trim())
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
