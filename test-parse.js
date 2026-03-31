// Test de address-parsing logica van scan.js (Node.js)

function isRealisticAddress(text) {
    if (!text || text.length < 6) return false;
    const postcodeRe = /\b\d{4}\s*[A-Za-z]{2}\b/;
    if (!postcodeRe.test(text)) return false;
    const hasWord = /[A-Za-zÀ-ÿ]{3,}/.test(text);
    if (!hasWord) return false;
    const specialChars = (text.match(/[^A-Za-z0-9À-ÿ\s,.\-]/g) || []).length;
    if (specialChars / text.length > 0.4) return false;
    const withoutPostcode = text.replace(/\b\d{4}\s*[A-Za-z]{2}\b/, '');
    const houseNr = withoutPostcode.match(/\b\d+/g) || [];
    const hasRealisticNr = houseNr.some(n => parseInt(n) >= 1 && parseInt(n) <= 9999);
    if (!hasRealisticNr) return false;
    return true;
}

function normalizeAddress(street, postcodeText, city) {
    const pcMatch = postcodeText.match(/(\d{4})\s*([A-Za-z]{2})(.*)/);
    if (!pcMatch) return street || postcodeText;
    const postcode = `${pcMatch[1]} ${pcMatch[2].toUpperCase()}`;
    let place = city.trim();
    if (!place) {
        let cityInPc = pcMatch[3].trim();
        cityInPc = cityInPc.replace(/(\s+[A-Za-z0-9]{1,2})+$/, '').trim();
        place = cityInPc.length > 2 ? cityInPc : '';
    }
    const cleanStreet = street.replace(/[^A-Za-zÀ-ÿ0-9\s\-]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanStreet && place) return `${cleanStreet}, ${postcode} ${place}`;
    if (cleanStreet) return `${cleanStreet}, ${postcode}`;
    if (place) return `${postcode} ${place}`;
    return postcode;
}

function parseStreetLine(text) {
    const t = text.trim().replace(/^[^A-Za-zÀ-ÿ\d]+/, '').replace(/[^A-Za-z0-9]+$/, '').trim();
    const startsWithNum = /^\d[A-Za-z]?\s+[A-Za-zÀ-ÿ]/.test(t);
    if (!startsWithNum && !/^[A-Za-zÀ-ÿ]{2,}/.test(t)) return null;
    const match = t.match(
        /^((?:\d[A-Za-z]?\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-\.\']*?)[,;\s]+(\d{1,4}[A-Za-z\-]?(?:\s*(?:bis|ter))?)[\s,;]*$/i
    );
    if (!match) return null;
    const name = match[1].trim();
    const number = match[2].trim();
    if (!name || name.length < 2) return null;
    const words = name.split(/\s+/);
    const longWords = words.filter(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3);
    if (longWords.length === 0) return null;
    const nameLetters = name.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (nameLetters.length > 26) return null;
    return { name, number };
}

function makeLines(textLines) {
    return textLines.map((text, i) => ({
        text,
        bbox: { y0: i * 30 }
    }));
}

function parseRecipientAddress(data, city) {
    if (city === undefined) city = '';
    const postcodeRe = /\b(\d{4})\s*([A-Za-z]{2})\b/;
    const lines = data.lines || [];
    const cityLower = city.toLowerCase();

    let recipientLine = null;
    let maxY = -1;

    for (const line of lines) {
        const text = line.text.trim();
        if (!postcodeRe.test(text)) continue;
        if (cityLower) {
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

    if (!recipientLine && cityLower) {
        for (const line of lines) {
            const text = line.text.trim();
            if (postcodeRe.test(text) && line.bbox.y0 > maxY) {
                maxY = line.bbox.y0;
                recipientLine = line;
            }
        }
    }

    if (!recipientLine) return ['Geen adres gevonden'];

    const above = lines
        .filter(l => l.bbox.y0 < recipientLine.bbox.y0)
        .sort((a, b) => b.bbox.y0 - a.bbox.y0);

    let parsed = above.slice(0, 5).reduce((found, l) => found || parseStreetLine(l.text), null);

    if (!parsed) {
        const beforePostcode = recipientLine.text.replace(/\d{4}\s*[A-Za-z]{2}.*$/, '').trim();
        if (beforePostcode) parsed = parseStreetLine(beforePostcode);
    }

    const street = parsed ? `${parsed.name} ${parsed.number}` : '';
    const pcText = recipientLine.text.trim().replace(/^[^A-Za-z0-9]+/, '');
    const finalAddress = normalizeAddress(street, pcText, city);

    if (!isRealisticAddress(finalAddress)) return ['Geen adres gevonden'];
    return [finalAddress];
}

// ========= TESTS =========
const STAD = 'Krimpen aan den IJssel';
let pass = 0, fail = 0;

function test(name, ocrLines, city, expected) {
    const data = { lines: makeLines(ocrLines) };
    const result = parseRecipientAddress(data, city);
    const got = result[0];
    const ok = isRealisticAddress(got) && (expected === null || got === expected);
    if (ok) {
        console.log('OK  ' + name + '\n    -> ' + got);
        pass++;
    } else {
        console.log('ERR ' + name + '\n    verwacht: ' + expected + '\n    gekregen: ' + got);
        fail++;
    }
}

function testFail(name, ocrLines, city) {
    const data = { lines: makeLines(ocrLines) };
    const result = parseRecipientAddress(data, city);
    const got = result[0];
    const rejected = !isRealisticAddress(got);
    if (rejected) {
        console.log('OK  ' + name + ' -> TERECHT afgewezen');
        pass++;
    } else {
        console.log('ERR ' + name + ' -> ten onrechte GOEDGEKEURD: ' + got);
        fail++;
    }
}

console.log('\n=== Basisgevallen (Krimpen aan den IJssel) ===');
test('Simpele straat + postcode',
    ['Mozartlaan 12', '2925 CN Krimpen aan den IJssel'],
    STAD, 'Mozartlaan 12, 2925 CN Krimpen aan den IJssel');

test('Postcode zonder spatie',
    ['Mozartlaan 12', '2925CN Krimpen aan den IJssel'],
    STAD, 'Mozartlaan 12, 2925 CN Krimpen aan den IJssel');

test('Met naam erboven',
    ['J. de Boer', 'Populierenlaan 45', '2922 AB Krimpen aan den IJssel'],
    STAD, 'Populierenlaan 45, 2922 AB Krimpen aan den IJssel');

test('HOOFDLETTERS straatnaam',
    ['MOZARTLAAN 8', '2925 CN Krimpen aan den IJssel'],
    STAD, 'MOZARTLAAN 8, 2925 CN Krimpen aan den IJssel');

console.log('\n=== OCR-rommel ===');
test('Puntkomma na huisnummer',
    ['Nieuwe Tiendweg 7 ;', '2922 AK Krimpen aan den IJssel'],
    STAD, 'Nieuwe Tiendweg 7, 2922 AK Krimpen aan den IJssel');

test('Pipe voor postcode',
    ['IJsseldijk 22', '| 2921BK Krimpen aan den IJssel'],
    STAD, 'IJsseldijk 22, 2921 BK Krimpen aan den IJssel');

test('Rommel als eerste regel',
    ['ccc bbb', 'Algerastraat 33', '2922 GH Krimpen aan den IJssel'],
    STAD, 'Algerastraat 33, 2922 GH Krimpen aan den IJssel');

console.log('\n=== Bedrijfsnamen overslaan ===');
test('Bedrijfsnaam boven straat',
    ['JUMBO KRIMPEN BV', 'Computerweg 12', '2922 AK Krimpen aan den IJssel'],
    STAD, 'Computerweg 12, 2922 AK Krimpen aan den IJssel');

test('3 lagen (bedrijf + naam + straat)',
    ['PostNL Pakket', 'Familie De Vries', 'Stormpolderdijk 99', '2927 LK Krimpen aan den IJssel'],
    STAD, 'Stormpolderdijk 99, 2927 LK Krimpen aan den IJssel');

console.log('\n=== Speciale straatformaten ===');
test('2e straat met cijfer vooraan',
    ['2e Tochtweg 8', '2922 AB Krimpen aan den IJssel'],
    STAD, '2e Tochtweg 8, 2922 AB Krimpen aan den IJssel');

test('Straat met koppelteken',
    ['Pluim-es 104', '2923 XY Krimpen aan den IJssel'],
    STAD, 'Pluim-es 104, 2923 XY Krimpen aan den IJssel');

test('Komma tussen naam en nummer',
    ['Langeland, 14', '2923 SJ Krimpen aan den IJssel'],
    STAD, 'Langeland 14, 2923 SJ Krimpen aan den IJssel');

test('Huisnummer met letter (12A)',
    ['Rijnstraat 12A', '2921 AA Krimpen aan den IJssel'],
    STAD, 'Rijnstraat 12A, 2921 AA Krimpen aan den IJssel');

testFail('Straatnaam te kort (Op 15)',
    ['Op 15', '2922 AB Krimpen aan den IJssel'],
    STAD);

console.log('\n=== Stad-filter ===');
test('Juiste postcode kiezen bij stad-filter',
    ['Bakstraat 1', '1111 AA Utrecht', 'Rijnstraat 5', '2921 BB Krimpen aan den IJssel'],
    STAD, 'Rijnstraat 5, 2921 BB Krimpen aan den IJssel');

test('Zonder stad: laatste postcode wint',
    ['Rijnstraat 1', '2921 AA Krimpen aan den IJssel', 'Mozartlaan 5', '2925 BB Krimpen aan den IJssel'],
    '', 'Mozartlaan 5, 2925 BB Krimpen aan den IJssel');

console.log('\n=== Moeten AFGEWEZEN worden ===');
testFail('Geen postcode', ['Rijnstraat 5', 'Krimpen aan den IJssel']);
testFail('Alleen postcode', ['2922 AK']);
testFail('Straat zonder huisnummer', ['Mozartlaan', '2925 CN Krimpen aan den IJssel']);
testFail('Rommel', ['%%% ###', '!@# bbb']);

console.log('\n=== Typische OCR-fouten op plastic zakken ===');
test('OCR plakt lijnen samen (straat+pc op 1 regel)',
    ['Rijnstraat 5 2921 CD Krimpen aan den IJssel'],
    STAD, null);

test('Extra spaties in OCR',
    ['  Mozartlaan   23  ', '  2925 CN   Krimpen aan den IJssel  '],
    STAD, 'Mozartlaan 23, 2925 CN Krimpen aan den IJssel');

test('Lage kwaliteit: gemengde case',
    ['RiJnStRaAt 7', '2921 ab krimpen aan den ijssel'],
    '', null);

console.log('\n=== Extra straatformaten ===');
test('Toevoeging bis',
    ['Nieuwe Tiendweg 14 bis', '2922 AK Krimpen aan den IJssel'],
    STAD, 'Nieuwe Tiendweg 14 bis, 2922 AK Krimpen aan den IJssel');

test('Toevoeging met letter (3B)',
    ['Langeland 3B', '2923 SJ Krimpen aan den IJssel'],
    STAD, 'Langeland 3B, 2923 SJ Krimpen aan den IJssel');

test('3e straat met getal in naam',
    ['3e Tochtweg 45', '2922 AK Krimpen aan den IJssel'],
    STAD, '3e Tochtweg 45, 2922 AK Krimpen aan den IJssel');

test('Naam boven adres',
    ['Fam. Pietersen', 'Algerastraat 7', '2922 GH Krimpen aan den IJssel'],
    STAD, 'Algerastraat 7, 2922 GH Krimpen aan den IJssel');

test('Lange bedrijfsnaam + adres',
    ['KRIMPEN DISTRIBUTIECENTRUM NEDERLAND BV', 'Stormpolderdijk 100', '2927 LK Krimpen aan den IJssel'],
    STAD, 'Stormpolderdijk 100, 2927 LK Krimpen aan den IJssel');

testFail('Straat te lang (> 26 letters)',
    ['VerylongstreetnamewithwaytoomanycharsX 1', '2922 AK Krimpen aan den IJssel'],
    STAD);

console.log('\n=== Resultaat: ' + pass + ' geslaagd, ' + fail + ' mislukt ===\n');
