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

console.log('\n=== Basisgevallen ===');
test('Simpele straat + postcode',
    ['Hyacintstraat 12', '2345 AB Leiden'],
    'Leiden', 'Hyacintstraat 12, 2345 AB Leiden');

test('Postcode zonder spatie',
    ['Hyacintstraat 12', '2345AB Leiden'],
    '', 'Hyacintstraat 12, 2345 AB Leiden');

test('Met naam erboven',
    ['J. de Boer', 'Koninginnelaan 45', '1234 CD Amsterdam'],
    'Amsterdam', 'Koninginnelaan 45, 1234 CD Amsterdam');

test('HOOFDLETTERS straatnaam',
    ['HYACINT 8', '4321 ZX Utrecht'],
    'Utrecht', 'HYACINT 8, 4321 ZX Utrecht');

console.log('\n=== OCR-rommel ===');
test('Puntkomma na huisnummer',
    ['Moderato 7 ;', '2925 CN Krimpen'],
    'Krimpen', 'Moderato 7, 2925 CN Krimpen');

test('Pipe voor postcode',
    ['Atago 12', '| 2925CN Krimpen'],
    'Krimpen', 'Atago 12, 2925 CN Krimpen');

test('Rommel als eerste regel',
    ['ccc bbb', 'Rozenlaan 33', '5678 GH Rotterdam'],
    'Rotterdam', 'Rozenlaan 33, 5678 GH Rotterdam');

console.log('\n=== Bedrijfsnamen overslaan ===');
test('Bedrijfsnaam WISSEL + straat',
    ['WISSEL VOEDINGSINDUSTRIE BV', 'Atago 12', '3456 EF Rotterdam'],
    'Rotterdam', 'Atago 12, 3456 EF Rotterdam');

test('3 lagen (bedrijf + naam + straat)',
    ['PostNL Pakket', 'Familie De Vries', 'Tulpstraat 99', '9999 ZZ Groningen'],
    'Groningen', 'Tulpstraat 99, 9999 ZZ Groningen');

console.log('\n=== Speciale straatformaten ===');
test('2e Hyacintstraat',
    ['2e Hyacintstraat 8', '2345 AB Leiden'],
    'Leiden', '2e Hyacintstraat 8, 2345 AB Leiden');

test('Straat met koppelteken',
    ['Pluim-es 104', '5432 XY Eindhoven'],
    'Eindhoven', 'Pluim-es 104, 5432 XY Eindhoven');

test('Komma tussen naam en nummer',
    ['Pluim-es, 104', '5432 XY Eindhoven'],
    'Eindhoven', 'Pluim-es 104, 5432 XY Eindhoven');

test('Huisnummer met letter (12A)',
    ['Bloemenstraat 12A', '1111 AA Amsterdam'],
    'Amsterdam', 'Bloemenstraat 12A, 1111 AA Amsterdam');

testFail('Korte straatnaam te kort (Op 15)',
    ['Op 15', '1234 AB Leiden'],
    'Leiden');  // "Op" is 2 letters = geen echte straatnaam, terecht afwijzen

console.log('\n=== Stad-filter ===');
test('Juiste postcode kiezen bij stad-filter',
    ['Bakstraat 1', '1111 AA Utrecht', 'Rozenlaan 5', '2222 BB Leiden'],
    'Leiden', 'Rozenlaan 5, 2222 BB Leiden');

test('Zonder stad: laagste postcode',
    ['Bakstraat 1', '1111 AA Utrecht', 'Rozenlaan 5', '2222 BB Leiden'],
    '', 'Rozenlaan 5, 2222 BB Leiden');

console.log('\n=== Moeten AFGEWEZEN worden ===');
testFail('Geen postcode', ['Rozenlaan 5', 'Leiden']);
testFail('Alleen postcode', ['1234 AB']);
testFail('Straat zonder huisnummer', ['Bloemstraat', '1234 AB Leiden']);
testFail('Rommel', ['%%% ###', '!@# bbb']);

console.log('\n=== Typische OCR-fouten op plastic zakken ===');
test('OCR plakt lijnen samen (straat+pc op 1 regel)',
    ['Rozenlaan 5 3456 CD Rotterdam'],
    'Rotterdam', null);  // moet werken of minstens niet crashen

test('Extra spaties in OCR',
    ['  Esdoornlaan   23  ', '  6789 EF   Tilburg  '],
    'Tilburg', 'Esdoornlaan 23, 6789 EF Tilburg');

test('Lage kwaliteit: gemengde case',
    ['RoZenLaAn 7', '1234 ab leiden'],
    '', null);  // minstens een adres teruggeven

console.log('\n=== Resultaat: ' + pass + ' geslaagd, ' + fail + ' mislukt ===\n');
