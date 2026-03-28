// Batch scan met Google Gemini Vision — gratis, nauwkeuriger dan Tesseract
// Gebruik: node scan-batch-claude.js
// Vereiste: GEMINI_API_KEY in .env bestand (gratis via aistudio.google.com)

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharpLib = require('sharp');
const fs       = require('fs');
const path     = require('path');

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

// ===== Afbeelding verkleinen + base64 coderen =====
async function imageToBase64(filePath, maxPx = 1600) {
    const buf = await sharpLib(filePath)
        .rotate()
        .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    return buf.toString('base64');
}

// ===== Gemini Vision aanroepen (met automatische retry bij rate limit) =====
async function scanWithGemini(model, filePath) {
    const b64 = await imageToBase64(filePath);

    const prompt = [
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        `Dit is een foto van een pakket of tijdschrift dat bezorgd moet worden.
Lees het BEZORGADRES (het adres van de ontvanger, NIET het retouradres/afzender).
Het bezorgadres staat in ${STAD}.

Geef het adres in dit formaat: Straatnaam Huisnummer, POSTCODE Stad
Voorbeeld: Zonnebloem 64, 2925 AB Krimpen aan den IJssel

Als het onleesbaar is, schrijf dan alleen: ONLEESBAAR
Geef ALLEEN het adres, geen uitleg of extra tekst.`,
    ];

    // Automatisch opnieuw proberen bij rate limit (429)
    for (let poging = 1; poging <= 5; poging++) {
        try {
            const result = await model.generateContent(prompt);
            const raw = result.response.text().trim();
            if (!raw || raw === 'ONLEESBAAR' || raw.length < 6)
                return { address: 'Geen adres gevonden', ok: false };
            return { address: raw, ok: true };
        } catch (err) {
            const wait = err.message.match(/retry in (\d+(?:\.\d+)?)s/)?.[1];
            if (wait && poging < 5) {
                const sec = Math.ceil(parseFloat(wait)) + 2;
                process.stdout.write(` [wacht ${sec}s]`);
                await new Promise(r => setTimeout(r, sec * 1000));
            } else {
                throw err;
            }
        }
    }
}

// ===== Hoofd =====
async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('\nGEMINI_API_KEY is niet ingesteld.\n');
        console.error('1. Ga naar: aistudio.google.com');
        console.error('2. Klik op "Get API key" → "Create API key"');
        console.error('3. Open het .env bestand in deze map en voeg toe:');
        console.error('   GEMINI_API_KEY=jouw-key-hier\n');
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const files = collectFiles();
    console.log(`\nGemini Vision — scan ${files.length} foto's — stad: ${STAD}\n`);

    const resultaten = [];
    for (let i = 0; i < files.length; i++) {
        const { bestand, pad } = files[i];
        process.stdout.write(`[${String(i+1).padStart(2)}/${files.length}] ${bestand.padEnd(28)} `);
        try {
            const { address, ok } = await scanWithGemini(model, pad);
            console.log((ok ? 'OK ' : 'ERR') + '  ' + address);
            resultaten.push({ bestand, address, ok });
            // 13 seconden wachten tussen verzoeken (max 5/minuut gratis)
            if (i < files.length - 1) await new Promise(r => setTimeout(r, 13000));
        } catch (err) {
            console.log('ERR  ' + err.message);
            resultaten.push({ bestand, address: err.message, ok: false });
        }
    }

    const gevonden = resultaten.filter(r => r.ok);
    const mislukt  = resultaten.filter(r => !r.ok);

    // Normaliseer postcode-opmaak: "2925XE" → "2925 XE"
    gevonden.forEach(r => {
        r.address = r.address.replace(/\b(\d{4})([A-Za-z]{2})\b/g, '$1 $2');
    });

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
