// Batch scan — test alle foto's automatisch
// Gebruik: node scan-batch.js  (of: node scan-batch.js -v voor debug-uitvoer)

const { createWorker } = require('tesseract.js');
const sharpLib = require('sharp');
const fs   = require('fs');
const path = require('path');

const FOTO_MAP  = 'C:\\Users\\Naam Leerling\\Downloads\\compressed_images';
const EXTRA_MAP = 'C:\\Users\\Naam Leerling\\OneDrive - Krimpenerwaard College\\Informatica 4H';
const LANG_PATH = __dirname;
const STAD      = 'Krimpen aan den IJssel';
const VERBOSE   = process.argv.includes('-v') || process.argv.includes('--verbose');

// Bekende postcodegebieden per stad (3 cijfers)
const POSTCODE_GEBIED = { krimpen: '292' };

// ===== Straatnamen-database Krimpen aan den IJssel =====
const KRIMPEN_STRATEN = [
    'Algerastraat','Anjer','Anjerstraat','Anemoon','Anemoonstraat',
    'Aster','Asterstraat','Aurikel','Boerhaavelaan','Chrysant',
    'Chrysantstraat','Cyclaam','Dahlia','Dahliastraat','Fluitenkruid',
    'Freesia','Gentiaan','Gladiool','Hyacint','Hyacintstraat',
    'IJsseldijk','Industrieweg','Iris','Irisstraat',
    'Kamperfoelie','Klaver','Korenbloem','Kortendijk',
    'Lelie','Leliestraat','Linde','Lindestraat','Lotus','Lotusstraat',
    'Meidoorn','Meidoornstraat','Narcis','Narcisstraat',
    'Populier','Populierstraat','Rondo','Roos','Roosstraat',
    'Tulp','Tulpstraat','Viooltje','Zonnebloem','Zonnebloemplein',
    'Burgemeester Lepelaarssingel',
].map(s => s.toLowerCase());

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, (_, i) =>
        Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function correctStreetName(name) {
    if (!name || name.length < 3) return name;

    // Specifieke correcties: afkortingen en veelvoorkomende OCR-fouten
    name = name
        .replace(/\bBurg\b/gi,          'Burgemeester')   // Afkorting
        .replace(/\bBurgermeester\b/gi, 'Burgemeester');  // Extra 'r' door OCR

    const lower = name.toLowerCase();
    if (KRIMPEN_STRATEN.includes(lower)) return name; // al correct
    let bestDist = Infinity, bestMatch = null;
    for (const street of KRIMPEN_STRATEN) {
        if (Math.abs(street.length - lower.length) > 3) continue;
        const threshold = lower.length <= 4 ? 1 : lower.length <= 8 ? 2 : 3;
        const d = levenshtein(lower, street);
        if (d <= threshold && d < bestDist) { bestDist = d; bestMatch = street; }
    }
    if (bestMatch && bestDist > 0) {
        return bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
    }
    return name;
}

// ===== OCR-tekst → regels =====
function cleanOCRLine(text) {
    return text
        .replace(/\b(\d{4})\s*%\s*([A-Za-z])\b/g,           '$1 X$2')
        .replace(/\b(\d{4})\s*[%\$\\\/\|]{1,2}\s*([A-Za-z]{1,2})\b/g, '$1 $2')
        .replace(/\b(\d{4})\s*([A-Za-z]{2})\b/g,             '$1 $2');
}

function textToLines(text) {
    return (text || '').split('\n')
        .map((t, i) => ({ text: cleanOCRLine(t), bbox: { y0: i * 40 } }))
        .filter(l => l.text.trim());
}

// ===== Adreslogica =====
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
    if (!place) {
        let c = m[3].trim().replace(/(\s+[A-Za-z0-9]{1,2})+$/, '').trim();
        place = c.length > 2 ? c : '';
    }
    const s = street.replace(/[^A-Za-zÀ-ÿ0-9\s\-]/g, '').replace(/\s+/g, ' ').trim();
    if (s && place) return `${s}, ${pc} ${place}`;
    if (s)          return `${s}, ${pc}`;
    if (place)      return `${pc} ${place}`;
    return pc;
}

function parseStreetLine(text) {
    const tryParse = (raw) => {
        const t = raw.trim().replace(/^[^A-Za-zÀ-ÿ\d]+/, '').replace(/[^A-Za-z0-9]+$/, '').trim();
        if (!/^\d[A-Za-z]?\s+[A-Za-zÀ-ÿ]/.test(t) && !/^[A-Za-zÀ-ÿ]{2,}/.test(t)) return null;
        const m = t.match(
            /^((?:\d[A-Za-z]?\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-\.\']*?)[,;\s]+(\d{1,4}(?:[A-Za-z\-]|\s+[A-Za-z]{1,3})?(?:\s*(?:bis|ter))?)[\s,;]*$/i
        );
        if (!m) return null;
        const name   = m[1].trim();
        const number = m[2].trim().replace(/\s+/g, '');
        if (!name || name.length < 2) return null;
        if (!name.split(/\s+/).some(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3)) return null;
        if (name.replace(/[^A-Za-zÀ-ÿ]/g, '').length > 26) return null;
        return { name, number };
    };
    const r = tryParse(text);
    if (r) return r;
    // "Hyacint8" → "Hyacint 8",  "Linde53" → "Linde 53"
    const spaced = text.replace(/([A-Za-zÀ-ÿ]{2,})(\d)/g, '$1 $2');
    return spaced !== text ? tryParse(spaced) : null;
}

function correctPostcodeInLine(text, expectedPrefix) {
    if (!expectedPrefix) return text;
    const m = text.match(/\b(\d{4})(\s*[A-Za-z]{2})\b/);
    if (!m || m[1].startsWith(expectedPrefix)) return text;
    const pc4  = m[1];
    const subs = [['9','2'],['0','9'],['2','9'],['8','0'],['5','2'],['6','2']];
    for (let len = 1; len <= 3; len++) {
        for (let i = 0; i <= 4 - len; i++) {
            const combos = (function gen(pos, end, cur) {
                if (pos === end) return [cur];
                const r = [];
                for (const [f,t] of subs) if (pc4[pos] === f) r.push(...gen(pos+1, end, cur+t));
                return r;
            })(i, i + len, pc4.slice(0, i));
            for (const prefix of combos) {
                const cand = prefix + pc4.slice(i + len);
                if (cand.startsWith(expectedPrefix)) return text.replace(m[1], cand);
            }
        }
    }
    return text;
}

// Vind het BESTE postcode-fragment in een tekstregel (prefereer verwacht postcodegebied)
function extractBestPcText(text, expectedPrefix) {
    if (!expectedPrefix) return text;
    const re = /\b\d{4}\s*[A-Za-z]{2}\b/g;
    let hit;
    while ((hit = re.exec(text)) !== null) {
        const pc4 = hit[0].match(/\d{4}/)[0];
        if (pc4.startsWith(expectedPrefix)) return text.slice(hit.index);
    }
    return text;
}

function parseRecipientAddress(lines, city, useCorrection = false) {
    if (!city) city = '';
    const pcRe = /\b\d{4}\s*[A-Za-z]{2}\b/;
    const kw   = city.toLowerCase().split(/\s+/)[0] || '';
    const kw2  = city.toLowerCase().split(/\s+/).pop() || ''; // laatste woord: "ijssel"
    const verwachtGebied = kw ? (POSTCODE_GEBIED[kw] || null) : null;

    const retourRe = /\b(afz\.?|afzender|retouradres|retour|van:|return|sender|from:)\b/i;
    const isRetour = (idx) => {
        const ctx = lines.slice(Math.max(0, idx-1), idx+2).map(l => l.text).join(' ');
        return retourRe.test(ctx);
    };

    const fixLine = (t) => useCorrection ? correctPostcodeInLine(t, verwachtGebied) : t;

    // Controleer of de tekst een postcode in het verwachte gebied bevat (doorzoek alle postcodes)
    const pcOk = (text) => {
        if (!verwachtGebied) return true;
        const fixed = fixLine(text);
        const re2 = /\b(\d{4})\s*[A-Za-z]{2}\b/g;
        let m2;
        while ((m2 = re2.exec(fixed)) !== null) {
            if (m2[1].startsWith(verwachtGebied)) return true;
        }
        return false;
    };

    const mkFixed = (line) => ({
        text: extractBestPcText(fixLine(line.text), verwachtGebied),
        bbox: line.bbox
    });

    let recipientLine = null, maxY = -1;

    // Hoofdloop: postcoderegel met stadscontext
    for (const line of lines) {
        if (!pcRe.test(line.text)) continue;
        if (!pcOk(line.text))     continue;
        const idx = lines.indexOf(line);
        if (isRetour(idx))        continue;
        const ctx = lines.slice(Math.max(0, idx-2), idx+3).map(l => l.text.toLowerCase()).join(' ');
        if ((!kw || ctx.includes(kw) || ctx.includes(kw2)) && line.bbox.y0 > maxY) {
            maxY = line.bbox.y0; recipientLine = mkFixed(line);
        }
    }

    // Fallback 1: laagste postcoderegel zonder stadscontext
    if (!recipientLine) {
        for (const line of lines) {
            const idx = lines.indexOf(line);
            if (pcRe.test(line.text) && pcOk(line.text) && !isRetour(idx) && line.bbox.y0 > maxY) {
                maxY = line.bbox.y0; recipientLine = mkFixed(line);
            }
        }
    }

    // Fallback 2: postcode op eigen regel (bv. internationale indeling)
    if (!recipientLine) {
        for (const line of lines) {
            if (/^\d{4}\s*[A-Za-z]{2}$/.test(line.text.trim()) && line.bbox.y0 > maxY) {
                const idx = lines.indexOf(line);
                const ctx = lines.slice(Math.max(0, idx-3), idx+2).map(l => l.text.toLowerCase()).join(' ');
                if (!kw || ctx.includes(kw)) { maxY = line.bbox.y0; recipientLine = line; }
            }
        }
    }

    // Fallback 2b: stadscheck met tweede sleutelwoord (kw2 = "ijssel")
    if (!recipientLine && kw2 && kw2 !== kw) {
        for (const line of lines) {
            if (!pcRe.test(line.text)) continue;
            if (!pcOk(line.text))     continue;
            const idx = lines.indexOf(line);
            if (isRetour(idx))        continue;
            const ctx = lines.slice(Math.max(0, idx-2), idx+3).map(l => l.text.toLowerCase()).join(' ');
            if (ctx.includes(kw2) && line.bbox.y0 > maxY) {
                maxY = line.bbox.y0; recipientLine = mkFixed(line);
            }
        }
    }

    // Fallback 3: alleen postcodeachtervoegsel zichtbaar ("DL KRIMPEN AD IJSSEL")
    if (!recipientLine && kw) {
        const pcPrefixMap = { krimpen: '2925' };
        const prefix = pcPrefixMap[kw];
        if (prefix) {
            const suffixRe = new RegExp(`\\b([A-Z]{2})\\s+${kw}`, 'i');
            for (const line of lines) {
                const sm = line.text.match(suffixRe);
                if (sm && line.bbox.y0 > maxY) {
                    maxY = line.bbox.y0;
                    recipientLine = { text: `${prefix} ${sm[1].toUpperCase()} ${line.text}`, bbox: line.bbox };
                }
            }
        }
    }

    if (!recipientLine) return null;

    const above  = lines.filter(l => l.bbox.y0 < recipientLine.bbox.y0).sort((a,b) => b.bbox.y0 - a.bbox.y0);
    let parsed   = above.slice(0, 5).reduce((f, l) => f || parseStreetLine(l.text), null);
    if (!parsed) {
        const bp = recipientLine.text.replace(/\d{4}\s*[A-Za-z]{2}.*$/, '').trim();
        if (bp) parsed = parseStreetLine(bp);
    }
    const street = parsed ? `${correctStreetName(parsed.name)} ${parsed.number}` : '';
    const pcText = recipientLine.text.trim().replace(/^[^A-Za-z0-9]+/, '');
    const addr   = normalizeAddress(street, pcText, city);
    return isRealisticAddress(addr) ? addr : null;
}

// ===== Beeldverwerking =====
async function preprocess(filePath, opts = {}) {
    const { cropFrac, inv, scale = 1200, norm = true, doSharpen = false, thr = 0, sigma = 1.5 } = opts;
    const meta = await sharpLib(filePath).rotate().metadata();
    const W = meta.width, H = meta.height;

    let img = sharpLib(filePath).rotate()
        .resize(scale, scale, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true });

    if (cropFrac) {
        const sc = Math.min(scale / W, scale / H, 1);
        const sW = Math.round(W * sc), sH = Math.round(H * sc);
        const cW = Math.round(cropFrac.w * sW), cH = Math.round(cropFrac.h * sH);
        if (cW < 80 || cH < 80) return null;
        img = img.extract({
            left:   Math.round(cropFrac.x * sW),
            top:    Math.round(cropFrac.y * sH),
            width:  cW,
            height: cH,
        });
    }

    img = img.greyscale();
    if (norm)      img = img.normalise();
    if (doSharpen) img = img.sharpen({ sigma });
    if (thr)       img = img.threshold(thr);
    if (inv)       img = img.negate();
    return img.png().toBuffer();
}

// ===== Strategieën =====
const STRATEGIES = [
    // Standaard: greyscale + normalise
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: null },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: { x:0, y:0.25, w:1, h:0.75 } },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: { x:0, y:0.4,  w:1, h:0.6  } },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: { x:0, y:0.5,  w:1, h:0.5  } },
    // Hogere resolutie
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 2000, crop: null },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 2000, crop: { x:0, y:0.3,  w:1, h:0.7  } },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 2000, crop: { x:0, y:0.5,  w:1, h:0.5  } },
    // Met verscherping
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 1600, crop: null },
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 1600, crop: { x:0, y:0.25, w:1, h:0.75 } },
    // Zonder normalise + drempelwaarde (voor beige/crème labels)
    { psm:  6, norm: false, doSharpen: false, thr: 180, scale: 1200, crop: null },
    { psm:  6, norm: false, doSharpen: true,  thr: 180, scale: 1600, crop: null },
    { psm:  6, norm: false, doSharpen: true,  thr: 200, scale: 2000, crop: null },
    { psm:  6, norm: false, doSharpen: true,  thr: 160, scale: 2000, crop: null },
    // PSM 4
    { psm:  4, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: null },
    // PSM 11 (sparse tekst — verspreide labels)
    { psm: 11, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: null },
    { psm: 11, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: { x:0, y:0.25, w:1, h:0.75 } },
    { psm: 11, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: null },
    // Omgekeerde kleuren
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 1200, crop: null, inv: true },
    // Laatste kans: strakke crops van elk kwadrant (voor moeilijke transparante plastic zakken)
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: { x:0.05, y:0.35, w:0.9,  h:0.55 } },
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: { x:0.05, y:0.45, w:0.9,  h:0.5  } },
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: { x:0.1,  y:0.3,  w:0.8,  h:0.6  } },
    { psm:  6, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: { x:0.0,  y:0.55, w:1.0,  h:0.45 } },
    { psm: 11, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: { x:0.05, y:0.3,  w:0.9,  h:0.65 } },
    { psm:  6, norm: false, doSharpen: true,  thr: 160, scale: 2000, crop: { x:0.05, y:0.4,  w:0.9,  h:0.55 } },
    // Transparante zakken: extreem scherp + hoge drempel
    { psm:  6, norm: true,  doSharpen: true,  thr: 190, scale: 2000, crop: { x:0.0,  y:0.3,  w:1.0,  h:0.7  }, sigma: 3.0 },
    { psm:  6, norm: true,  doSharpen: true,  thr: 170, scale: 2000, crop: { x:0.0,  y:0.4,  w:1.0,  h:0.6  }, sigma: 3.0 },
    { psm:  6, norm: false, doSharpen: true,  thr: 140, scale: 2000, crop: { x:0.0,  y:0.3,  w:1.0,  h:0.7  }, sigma: 4.0 },
    { psm: 11, norm: false, doSharpen: true,  thr: 150, scale: 2000, crop: { x:0.0,  y:0.35, w:1.0,  h:0.6  }, sigma: 3.0 },
    { psm:  6, norm: true,  doSharpen: true,  thr: 200, scale: 2000, crop: null,                               sigma: 2.5 },
    { psm:  6, norm: true,  doSharpen: false, thr: 0,   scale: 2000, crop: null, inv: true },
    { psm: 11, norm: true,  doSharpen: true,  thr: 0,   scale: 2000, crop: null, inv: true },
];

async function scanFile(filePath, worker) {
    const tryScan = async (useCorrection) => {
        let lastPsm = null;
        for (const s of STRATEGIES) {
            if (s.psm !== lastPsm) {
                await worker.setParameters({ tessedit_pageseg_mode: s.psm });
                lastPsm = s.psm;
            }
            try {
                const buf = await preprocess(filePath, {
                    cropFrac: s.crop, inv: s.inv,
                    scale: s.scale, norm: s.norm,
                    doSharpen: s.doSharpen, thr: s.thr,
                    sigma: s.sigma,
                });
                if (!buf) continue;
                const { data } = await worker.recognize(buf);
                if (VERBOSE) {
                    const preview = data.text.replace(/\n+/g, ' | ').replace(/\s+/g, ' ').trim().slice(0, 120);
                    process.stderr.write(`    [psm${s.psm} scale${s.scale} norm${s.norm?1:0} thr${s.thr} sh${s.doSharpen?1:0} crop${s.crop?`y${s.crop.y}`:'no'}] "${preview}"\n`);
                }
                const lines = textToLines(data.text);
                const addr  = parseRecipientAddress(lines, STAD, useCorrection);
                if (addr) return addr;
            } catch (_) {}
        }
        return null;
    };

    let addr = await tryScan(false);
    if (!addr) addr = await tryScan(true);
    return addr ? { address: addr, ok: true } : { address: 'Geen adres gevonden', ok: false };
}

// ===== Bestanden verzamelen =====
function collectFiles() {
    const files = [], seen = new Set();
    const addDir = (dir, onlyMin) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir)
            .filter(f => /\.(jpe?g|png)$/i.test(f) && !f.toLowerCase().includes('kopie'))
            .filter(f => !onlyMin || f.includes('-min'))
            .sort()
            .forEach(f => {
                const key = f.replace(/-min/g, '').toLowerCase();
                if (!seen.has(key)) { seen.add(key); files.push({ bestand: f, pad: path.join(dir, f) }); }
            });
    };
    addDir(FOTO_MAP,  false);
    addDir(EXTRA_MAP, true);
    return files;
}

// ===== Hoofd =====
async function main() {
    const files = collectFiles();
    console.log(`\nScan ${files.length} foto's — stad: ${STAD}\n`);

    const worker = await createWorker('nld+eng', 1, { langPath: LANG_PATH, cacheMethod: 'none' });
    const resultaten = [];

    for (let i = 0; i < files.length; i++) {
        const { bestand, pad } = files[i];
        process.stdout.write(`[${String(i+1).padStart(2)}/${files.length}] ${bestand.padEnd(28)} `);
        if (VERBOSE) process.stderr.write(`\n--- ${bestand} ---\n`);
        const { address, ok } = await scanFile(pad, worker);
        console.log((ok ? 'OK ' : 'ERR') + '  ' + address);
        resultaten.push({ bestand, address, ok });
    }

    await worker.terminate();

    const gevonden = resultaten.filter(r => r.ok);
    const mislukt  = resultaten.filter(r => !r.ok);

    // Duplicaten samenvoegen met teller
    const telling = {};
    gevonden.forEach(r => {
        const sleutel = r.address.trim().toLowerCase();
        if (!telling[sleutel]) telling[sleutel] = { address: r.address, n: 0 };
        telling[sleutel].n++;
    });
    const uniek = Object.values(telling).sort((a, b) => a.address.localeCompare(b.address));

    console.log('\n========= EINDUITSLAG =========');
    console.log(`\nGevonden adressen (${gevonden.length}/${files.length}):`);
    uniek.forEach((e, i) =>
        console.log(`  ${String(i+1).padStart(2)}. ${e.address}${e.n > 1 ? `  (x${e.n})` : ''}`)
    );
    if (mislukt.length) {
        console.log(`\nNiet herkend (${mislukt.length}):`);
        mislukt.forEach(r => console.log(`  - ${r.bestand}`));
    }
    console.log(`\nResultaat: ${gevonden.length} van ${files.length} adressen herkend.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
