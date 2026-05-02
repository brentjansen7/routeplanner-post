// Gemini Vision Proxy — Cloudflare Worker
// Model: gemini-1.5-flash (1500 verzoeken/dag gratis, vs 20/dag voor 2.5-flash)
// Rate limit: 50 scans per IP per dag (opgeslagen in Cloudflare KV)
//
// Deploy instructies:
// 1. Ga naar dash.cloudflare.com → Workers & Pages → gemini-proxy
// 2. Vervang de code door deze file
// 3. Ga naar Settings → Variables → voeg toe: GEMINI_API_KEY = jouw key
// 4. Ga naar KV → maak namespace aan: RATE_LIMIT_KV → bind als "RATE_LIMIT"
// 5. Klik Deploy

const GEMINI_MODEL   = 'gemini-2.0-flash';   // veel quota, meer nauwkeurig
const MAX_PER_DAY    = 50;                    // max scans per IP per dag
const CORS_ORIGIN    = '*';                   // sta alle origins toe (alleen jouw site: 'https://brentjansen7.github.io')

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': CORS_ORIGIN,
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // ── Rate limiting per IP ──────────────────────────────────────────
        const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
        const today   = new Date().toISOString().slice(0, 10); // "2025-03-28"
        const kvKey   = `rl:${ip}:${today}`;

        let gebruikt = 0;
        try {
            const val = await env.RATE_LIMIT.get(kvKey);
            gebruikt = val ? parseInt(val) : 0;
        } catch (e) {
            // KV niet beschikbaar — doorgaan zonder rate limit
        }

        if (gebruikt >= MAX_PER_DAY) {
            return new Response(
                JSON.stringify({ error: { message: `Daglimiet bereikt (${MAX_PER_DAY} scans/dag). Probeer morgen opnieuw.` } }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': CORS_ORIGIN,
                        'X-RateLimit-Limit': String(MAX_PER_DAY),
                        'X-RateLimit-Remaining': '0',
                    },
                }
            );
        }

        // ── Doorsturen naar Gemini API ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return new Response('Invalid JSON', { status: 400 });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

        let geminiResp;
        try {
            geminiResp = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents:         body.contents,
                    generationConfig: body.generationConfig || { temperature: 0.1, maxOutputTokens: 200 },
                }),
            });
        } catch (e) {
            return new Response(
                JSON.stringify({ error: { message: 'Proxy fout: ' + e.message } }),
                { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN } }
            );
        }

        // ── Teller ophogen na succesvolle scan ───────────────────────────
        if (geminiResp.ok) {
            try {
                await env.RATE_LIMIT.put(kvKey, String(gebruikt + 1), {
                    expirationTtl: 86400, // vervalt na 24 uur
                });
            } catch (e) { /* KV schrijffout — negeren */ }
        }

        const data = await geminiResp.json();

        return new Response(JSON.stringify(data), {
            status: geminiResp.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': CORS_ORIGIN,
                'X-RateLimit-Limit':     String(MAX_PER_DAY),
                'X-RateLimit-Remaining': String(Math.max(0, MAX_PER_DAY - gebruikt - 1)),
            },
        });
    },
};
