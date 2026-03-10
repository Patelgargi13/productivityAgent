// aiProvider.js — Gemini first, Groq fallback
// Place in: src/agents/aiProvider.js

const https = require('https');

// ─── PASTE YOUR KEYS HERE ──────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;   // aistudio.google.com
const GROQ_API_KEY   =  process.env.GROQ_API_KEY;     // console.groq.com
// ──────────────────────────────────────────────────────

async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
    });
    const urlObj = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`);
    const req = https.request({
      hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error('No text from Gemini'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function callGroq(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500, temperature: 0.7
    });
    const req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const text = json.choices?.[0]?.message?.content;
          if (!text) return reject(new Error('No text from Groq'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function callAI(prompt, localFallback = null) {
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_KEY_HERE') {
    try {
      const text = await callGemini(prompt);
      console.log('[AI] Gemini ✓');
      return { text, provider: 'gemini' };
    } catch (e) { console.warn('[AI] Gemini failed:', e.message); }
  }

  if (GROQ_API_KEY && GROQ_API_KEY !== 'YOUR_GROQ_KEY_HERE') {
    try {
      const text = await callGroq(prompt);
      console.log('[AI] Groq ✓');
      return { text, provider: 'groq' };
    } catch (e) { console.warn('[AI] Groq failed:', e.message); }
  }

  if (localFallback) return { text: localFallback(), provider: 'local' };
  throw new Error('All AI providers failed');
}

module.exports = { callAI, callGemini, callGroq };