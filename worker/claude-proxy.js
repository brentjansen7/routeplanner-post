// Claude Vision Proxy — Cloudflare Worker
// Model: claude-3-5-haiku (veel quota, goedkoop voor vision)
// Rate limit: 50 scans per IP per dag (opgeslagen in Cloudflare KV)
//
// Deploy instructies:
// 1. Ga naar dash.cloudflare.com → Workers & Pages → claude-proxy (of maak aan)
// 2. Vervang de code door deze file
// 3. Ga naar Settings → Variables → voeg toe: CLAUDE_API_KEY = jouw key (van console.anthropic.com)
// 4. Ga naar KV → maak namespace aan: RATE_LIMIT_KV → bind als "RATE_LIMIT"
// 5. Klik Deploy

const CLAUDE_MODEL   = 'claude-3-haiku-20240307';  // snelste, goedkoopste
const MAX_PER_DAY    = 50;                            // max scans per IP per dag
const CORS_ORIGIN    = '*';                           // sta alle origins toe

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
        const today   = new Date().toISOString().slice(0, 10);
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

        // ── Request body parsen ────────────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return new Response('Invalid JSON', { status: 400 });
        }

        // ── Gemini format → Claude format ──────────────────────────────────
        // Gemini: { contents: [{ parts: [{ text }, { inline_data: { mime_type, data } }] }] }
        // Claude: { model, messages: [{ role, content: [{ type: "text"/"image" }] }] }

        let messages = [];
        try {
            if (body.contents && Array.isArray(body.contents)) {
                const content = body.contents[0]?.parts || [];
                let textContent = '';
                let imageBase64 = null;
                let imageMimeType = null;

                for (const part of content) {
                    if (part.text) {
                        textContent += part.text + '\n';
                    } else if (part.inline_data) {
                        imageBase64 = part.inline_data.data;
                        imageMimeType = part.inline_data.mime_type;
                    }
                }

                const msgContent = [];
                if (imageBase64) {
                    // Zet MIME type naar Claude formaat (jpeg, png, gif, webp)
                    let claudeMimeType = imageMimeType;
                    if (imageMimeType === 'image/jpeg') claudeMimeType = 'image/jpeg';
                    if (imageMimeType === 'image/png') claudeMimeType = 'image/png';

                    msgContent.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: claudeMimeType,
                            data: imageBase64,
                        },
                    });
                }

                if (textContent.trim()) {
                    msgContent.push({
                        type: 'text',
                        text: textContent.trim(),
                    });
                }

                messages.push({
                    role: 'user',
                    content: msgContent,
                });
            }
        } catch (e) {
            return new Response(
                JSON.stringify({ error: { message: 'Kon request niet omzetten: ' + e.message } }),
                { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN } }
            );
        }

        // ── Doorsturen naar Claude API ─────────────────────────────────────
        let claudeResp;
        try {
            claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': env.CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: CLAUDE_MODEL,
                    max_tokens: body.generationConfig?.maxOutputTokens || 200,
                    temperature: body.generationConfig?.temperature || 0.1,
                    messages: messages,
                }),
            });
        } catch (e) {
            return new Response(
                JSON.stringify({ error: { message: 'Proxy fout: ' + e.message } }),
                { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN } }
            );
        }

        // ── Teller ophogen na succesvolle scan ───────────────────────────
        if (claudeResp.ok) {
            try {
                await env.RATE_LIMIT.put(kvKey, String(gebruikt + 1), {
                    expirationTtl: 86400,
                });
            } catch (e) { /* KV schrijffout — negeren */ }
        }

        let claudeData = await claudeResp.json();

        // ── Claude antwoord → Gemini formaat omzetten ──────────────────────
        // Claude: { content: [{ type: "text", text: "..." }], ... }
        // Gemini: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
        if (claudeResp.ok) {
            const text = claudeData.content?.[0]?.text || '';
            claudeData = {
                candidates: [
                    {
                        content: {
                            parts: [{ text: text }],
                        },
                    },
                ],
            };
        }

        return new Response(JSON.stringify(claudeData), {
            status: claudeResp.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': CORS_ORIGIN,
                'X-RateLimit-Limit':     String(MAX_PER_DAY),
                'X-RateLimit-Remaining': String(Math.max(0, MAX_PER_DAY - gebruikt - 1)),
            },
        });
    },
};
