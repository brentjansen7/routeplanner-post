// Batch scan met Tesseract OCR — GRATIS, geen API quota nodig
// Gebruik: node scan-batch-tesseract.js
// Veel sneller dan Gemini voor pakket-adressen

const Tesseract = require('tesseract.js');
const fs        = require('fs');
const path      = require('path');

const FOTO_MAP  = 'C:\\Users\\Naam Leerling\\Downloads\\compressed_images';
const EXTRA_MAP = 'C:\\Users\\Naam Leerling\\OneDrive - Krimpenerwaard College\\Informatica 4H';
const STAD      = 'Krimpen aan den IJssel';

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

// ===== Tesseract OCR scan =====
async function scanWithTesseract(filePath) {
    try {
        const { data: { text } } = await Tesseract.recognize(filePath, 'nld');
        if (!text || text.trim().length < 6) return null;

        // Parse adres uit tekst — zoek naar "straat huisnummer, postcode plaats"
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);

        // Herken PostcodeStad patroon: "2925 XE Krimpen aan den IJssel" of "2925XE Krimpen..."
        const adres = lines.find(l => /\d{4}\s*[A-Z]{2}/.test(l) && STAD.split(' ')[0] in l);

        if (!adres) return null;

        // Normaliseer postcode: 2925XE → 2925 XE
        const norm = adres.replace(/\b(\d{4})([A-Za-z]{2})\b/g, '$1 $2');
        return norm;
    } catch (e) {
        return null;
    }
}

// ===== Hoofd =====
async function main() {
    const files = collectFiles();
    console.log(`\nTesseract OCR — scan ${files.length} foto's\n`);

    const resultaten = [];
    for (let i = 0; i < files.length; i++) {
        const { bestand, pad } = files[i];
        process.stdout.write(`[${String(i+1).padStart(2)}/${files.length}] ${bestand.padEnd(28)} `);
        try {
            const address = await scanWithTesseract(pad);
            if (address) {
                console.log('OK   ' + address);
                resultaten.push({ bestand, address, ok: true });
            } else {
                console.log('ERR  Geen adres herkend');
                resultaten.push({ bestand, address: 'Geen adres herkend', ok: false });
            }
        } catch (err) {
            console.log('ERR  ' + err.message);
            resultaten.push({ bestand, address: err.message, ok: false });
        }
    }

    const gevonden = resultaten.filter(r => r.ok);
    const mislukt  = resultaten.filter(r => !r.ok);

    // Duplicaten samenvoegen met teller
    const telling = {};
    gevonden.forEach(r => {
        const sleutel = r.address.trim().toLowerCase();
        telling[sleutel] = (telling[sleutel] || { address: r.address, n: 0 });
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
