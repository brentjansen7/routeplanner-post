// Test parsing + OCR op de eerste 4 foto's — inclusief TOP-HALF crop als fallback
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const LANG_PATH = __dirname;
const STAD = 'Krimpen aan den IJssel';

function textToLines(text) {
    return (text || '').split('\n')
        .map((t, i) => ({ text: t, bbox: { y0: i * 40 } }))
        .filter(l => l.text.trim());
}
function isRealisticAddress(text) {
    if (!text || text.length < 6) return false;
    if (!/\b\d{4}\s*[A-Za-z]{2}\b/.test(text)) return false;
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(text)) return false;
    const sp = (text.match(/[^A-Za-z0-9À-ÿ\s,.\-]/g) || []).length;
    if (sp / text.length > 0.4) return false;
    const wo = text.replace(/\b\d{4}\s*[A-Za-z]{2}\b/, '');
    return (wo.match(/\b\d+/g) || []).some(n => parseInt(n) >= 1 && parseInt(n) <= 9999);
}
function normalizeAddress(street, postcodeText, city) {
    const m = postcodeText.match(/(\d{4})\s*([A-Za-z]{2})(.*)/);
    if (!m) return street || postcodeText;
    const pc = m[1] + ' ' + m[2].toUpperCase();
    let place = city.trim();
    if (!place) { let c = m[3].trim().replace(/(\s+[A-Za-z0-9]{1,2})+$/, '').trim(); place = c.length > 2 ? c : ''; }
    const s = street.replace(/[^A-Za-zÀ-ÿ0-9\s\-]/g, '').replace(/\s+/g, ' ').trim();
    if (s && place) return s + ', ' + pc + ' ' + place;
    if (s) return s + ', ' + pc;
    if (place) return pc + ' ' + place;
    return pc;
}
function parseStreetLine(text) {
    const t = text.trim().replace(/^[^A-Za-zÀ-ÿ\d]+/, '').replace(/[^A-Za-z0-9]+$/, '').trim();
    if (!/^\d[A-Za-z]?\s+[A-Za-zÀ-ÿ]/.test(t) && !/^[A-Za-zÀ-ÿ]{2,}/.test(t)) return null;
    // Uitgebreide regex: staat ook "64 a" toe (spatie voor letter-suffix)
    const m = t.match(/^((?:\d[A-Za-z]?\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-\.\']*?)[,;\s]+(\d{1,4}(?:[A-Za-z\-]|\s+[A-Za-z]{1,3})?(?:\s*(?:bis|ter))?)[\s,;]*$/i);
    if (!m) return null;
    const name = m[1].trim(), number = m[2].trim().replace(/\s+/g, '');
    if (!name || name.length < 2) return null;
    if (!name.split(/\s+/).some(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3)) return null;
    if (name.replace(/[^A-Za-zÀ-ÿ]/g, '').length > 26) return null;
    return { name, number };
}
function parseRecipientAddress(lines, city) {
    if (!city) city = '';
    const pcRe = /\b(\d{4})\s*([A-Za-z]{2})\b/;
    const kw = city.toLowerCase().split(' ')[0];
    let recipientLine = null, maxY = -1;
    for (const line of lines) {
        if (!pcRe.test(line.text.trim())) continue;
        const idx = lines.indexOf(line);
        const ctx = lines.slice(Math.max(0, idx-2), idx+3).map(l => l.text.toLowerCase()).join(' ');
        if ((!kw || ctx.includes(kw)) && line.bbox.y0 > maxY) { maxY = line.bbox.y0; recipientLine = line; }
    }
    if (!recipientLine) {
        for (const line of lines) {
            if (pcRe.test(line.text) && line.bbox.y0 > maxY) { maxY = line.bbox.y0; recipientLine = line; }
        }
    }
    if (!recipientLine) return null;
    const above = lines.filter(l => l.bbox.y0 < recipientLine.bbox.y0).sort((a,b) => b.bbox.y0 - a.bbox.y0);
    let parsed = above.slice(0,5).reduce((f,l) => f || parseStreetLine(l.text), null);
    if (!parsed) { const bp = recipientLine.text.replace(/\d{4}\s*[A-Za-z]{2}.*$/, '').trim(); if (bp) parsed = parseStreetLine(bp); }
    const street = parsed ? parsed.name + ' ' + parsed.number : '';
    const pcText = recipientLine.text.trim().replace(/^[^A-Za-z0-9]+/, '');
    const addr = normalizeAddress(street, pcText, city);
    return isRealisticAddress(addr) ? addr : null;
}

async function prep(sharp_img, crop) {
    const meta = await sharp_img.clone().metadata();
    const W = meta.width, H = meta.height;
    let img = sharp_img.clone().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true });
    if (crop) {
        const sc = Math.min(1200/W, 1200/H, 1);
        const sW = Math.round(W*sc), sH = Math.round(H*sc);
        img = img.extract({ left: Math.round(crop.x*sW), top: Math.round(crop.y*sH), width: Math.round(crop.w*sW), height: Math.round(crop.h*sH) });
    }
    return img.greyscale().normalise().png().toBuffer();
}

const FOTOS = [
    'C:/Users/Naam Leerling/Downloads/compressed_images/IMG_1593-min.jpeg',
    'C:/Users/Naam Leerling/Downloads/compressed_images/IMG_1595-min.jpeg',
    'C:/Users/Naam Leerling/Downloads/compressed_images/IMG_1596-min.jpeg',
    'C:/Users/Naam Leerling/Downloads/compressed_images/IMG_1597-min.jpeg',
];

const CROPS = [null, {x:0,y:0,w:1,h:0.6}, {x:0,y:0.25,w:1,h:0.75}];

(async () => {
    const worker = await createWorker('nld+eng', 1, { langPath: LANG_PATH, cacheMethod: 'none' });
    for (const foto of FOTOS) {
        console.log('\n=== ' + foto.split('/').pop() + ' ===');
        let found = null;
        const sharpBase = sharp(foto).rotate();
        for (const crop of CROPS) {
            await worker.setParameters({ tessedit_pageseg_mode: 6 });
            const buf = await prep(sharpBase, crop);
            const { data } = await worker.recognize(buf);
            const lines = textToLines(data.text);
            const addr = parseRecipientAddress(lines, STAD);
            console.log('  crop=' + JSON.stringify(crop) + ' tekst="' + data.text.trim().replace(/\n/g,'|') + '" → ' + (addr || 'NIET GEVONDEN'));
            if (addr && !found) found = addr;
        }
        console.log('  UITSLAG: ' + (found || 'MISLUKT'));
    }
    await worker.terminate();
})().catch(e => console.error(e));
