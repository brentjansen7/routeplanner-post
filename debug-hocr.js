const { createWorker } = require('tesseract.js');
const LANG_PATH = __dirname;
(async () => {
    const w = await createWorker('nld+eng', 1, { langPath: LANG_PATH, cacheMethod: 'none' });
    await w.setParameters({ tessedit_pageseg_mode: 6 });
    const { data } = await w.recognize('C:/Users/Naam Leerling/Downloads/debug_simple.png');
    console.log('TEKST:', data.text);
    console.log('\nHOCR (eerste 2000 tekens):');
    console.log(data.hocr ? data.hocr.substring(0, 2000) : '(leeg)');
    console.log('\nTSV (eerste 500 tekens):');
    console.log(data.tsv ? data.tsv.substring(0, 500) : '(leeg)');
    await w.terminate();
})().catch(e => console.error('FOUT:', e.message));
