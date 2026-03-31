// Snelle foto-test via Cloudflare Worker
// Geen delays, gebruikt je Worker proxy (gemini-1.5-flash)

const fs = require('fs');
const path = require('path');

const PROXY_URL = 'https://gemini-proxy.brent-jansen2009.workers.dev';
const FOTO_MAP = 'C:\\Users\\Naam Leerling\\Downloads\\compressed_images';

async function imageToBase64(filePath) {
    const buf = await require('sharp')(filePath)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    return buf.toString('base64');
}

async function scanViaWorker(bestand, b64) {
    const prompt = `Dit is een foto van een pakket of tijdschrift dat bezorgd moet worden.
Lees het BEZORGADRES (het adres van de ontvanger, NIET het retouradres/afzender).
Het bezorgadres staat in Krimpen aan den IJssel.

Geef het adres in dit formaat: Straatnaam Huisnummer, POSTCODE Stad
Voorbeeld: Zonnebloem 64, 2925 AB Krimpen aan den IJssel

Als het onleesbaar is, schrijf dan alleen: ONLEESBAAR
Geef ALLEEN het adres, geen uitleg of extra tekst.`;

    const resp = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: prompt }] }
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        })
    });

    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { address: text.trim(), ok: text.trim() && !/^onleesbaar$/i.test(text.trim()) };
}

async function main() {
    const files = fs.readdirSync(FOTO_MAP)
        .filter(f => /\.(jpe?g|png)$/i.test(f) && !f.toLowerCase().includes('kopie'))
        .sort();

    console.log(`\nTest via Worker — ${files.length} fotos\n`);

    const resultaten = [];
    for (let i = 0; i < files.length; i++) {
        const bestand = files[i];
        const pad = path.join(FOTO_MAP, bestand);
        process.stdout.write(`[${String(i + 1).padStart(2)}/${files.length}] ${bestand.padEnd(30)} `);

        try {
            const b64 = await imageToBase64(pad);
            const { address, ok } = await scanViaWorker(bestand, b64);
            console.log((ok ? 'OK' : 'ERR') + '  ' + (address.slice(0, 50) || '(leeg)'));
            resultaten.push({ bestand, address, ok });
        } catch (err) {
            console.log('ERR  ' + err.message);
            resultaten.push({ bestand, address: err.message, ok: false });
        }
    }

    const gevonden = resultaten.filter(r => r.ok);
    const mislukt = resultaten.filter(r => !r.ok);

    console.log('\n========= EINDUITSLAG =========');
    console.log(`Gevonden: ${gevonden.length}/${files.length}`);
    if (mislukt.length) {
        console.log(`\nNiet herkend (${mislukt.length}):`);
        mislukt.forEach(r => console.log(`  - ${r.bestand}`));
    }
    console.log();
}

main().catch(err => { console.error(err); process.exit(1); });
