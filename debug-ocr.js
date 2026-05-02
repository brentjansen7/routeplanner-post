// Debug: toon ruwe OCR-output van één foto
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');

const FILE = process.argv[2] || 'C:\\Users\\Naam Leerling\\Downloads\\compressed_images\\IMG_1593-min.jpeg';

async function main() {
    const worker = await createWorker('nld+eng');

    // Preprocessen: grijswaarden + auto-contrast
    const buf = await sharp(FILE).rotate().greyscale().normalise().png().toBuffer();

    await worker.setParameters({ tessedit_pageseg_mode: 6 });
    const { data } = await worker.recognize(buf);

    console.log('\n=== VOLLEDIGE TEKST ===');
    console.log(data.text);

    console.log('\n=== REGELS MET Y-POSITIE ===');
    for (const line of data.lines) {
        console.log(`y=${Math.round(line.bbox.y0).toString().padStart(4)}  "${line.text.trim()}"`);
    }

    await worker.terminate();
}

main().catch(console.error);
