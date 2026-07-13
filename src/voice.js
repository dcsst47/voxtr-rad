// Voice pipeline — WhatsApp voice-note in, voice-note + text out.
//   In:  Twilio media  →  Deepgram Nova-2 (auto language detect)  →  transcript
//   Out: LLM reply     →  language-conditional TTS                →  MP3 back to WhatsApp
//
// TTS routing:
//   detected == "en"  and  DEEPGRAM_API_KEY set   →  Deepgram Aura (aura-asteria-en)
//   detected != "en"  and  OPENAI_API_KEY set     →  OpenAI TTS (tts-1, multi-language)
//   otherwise                                     →  skip voice, text only

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ─── Download authenticated media from Twilio ───
function downloadTwilioMedia(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  return new Promise((resolve, reject) => {
    const makeRequest = (url) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
      };
      lib.get(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    };
    makeRequest(mediaUrl);
  });
}

// ─── STT: Deepgram Nova-2 with auto language detection ───
function transcribeAudio(audioBuffer, mimeType) {
  if (!DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY not set — cannot transcribe voice notes");
  }
  const baseMime = (mimeType || "audio/ogg").split(";")[0].trim();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.deepgram.com",
      path: "/v1/listen?model=nova-2&smart_format=true&detect_language=true",
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": baseMime,
        "Content-Length": audioBuffer.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode !== 200) {
          return reject(new Error(`Deepgram STT ${res.statusCode}: ${body}`));
        }
        try {
          const j = JSON.parse(body);
          const transcript = j.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
          const language = j.results?.channels?.[0]?.detected_language || "en";
          resolve({ transcript, language });
        } catch (e) {
          reject(new Error(`Deepgram JSON parse: ${body}`));
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(audioBuffer);
    req.end();
  });
}

// ─── TTS: Deepgram Aura (English) ───
function ttsDeepgram(text) {
  const truncated = text.length > 2000 ? text.substring(0, 2000) + "..." : text;
  const body = JSON.stringify({ text: truncated });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.deepgram.com",
      path: `/v1/speak?model=aura-asteria-en&encoding=mp3`,
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Deepgram TTS ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        }
        resolve(Buffer.concat(chunks));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── TTS: OpenAI tts-1 (multi-language: Urdu, Arabic, Hindi, Tagalog, Malayalam-ish, etc.) ───
function ttsOpenAI(text, voice = "nova") {
  const truncated = text.length > 4000 ? text.substring(0, 4000) + "..." : text;
  const body = JSON.stringify({
    model: "tts-1",
    voice,               // alloy, echo, fable, onyx, nova, shimmer — nova handles multilingual well
    input: truncated,
    response_format: "mp3",
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/audio/speech",
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OpenAI TTS ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        }
        resolve(Buffer.concat(chunks));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Public TTS router — picks provider by language and available keys ───
async function textToSpeech(text, language = "en") {
  if (language === "en" || language.startsWith("en-")) {
    if (DEEPGRAM_API_KEY) return ttsDeepgram(text);
    if (OPENAI_API_KEY) return ttsOpenAI(text);
    throw new Error("No TTS provider configured (need DEEPGRAM_API_KEY or OPENAI_API_KEY)");
  }
  // Non-English: prefer OpenAI (Aura is English-only)
  if (OPENAI_API_KEY) return ttsOpenAI(text);
  // Fallback: Deepgram English will mangle non-English text; refuse so caller sends text only.
  const err = new Error(`No multilingual TTS for language "${language}" (set OPENAI_API_KEY)`);
  err.code = "TTS_LANG_UNSUPPORTED";
  throw err;
}

// ─── In-memory audio cache (10-minute TTL, one-time read) ───
const audioStore = new Map();

function storeAudio(id, buffer) {
  audioStore.set(id, { buffer, createdAt: Date.now() });
  for (const [k, v] of audioStore) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) audioStore.delete(k);
  }
}

function getStoredAudio(id) {
  const e = audioStore.get(id);
  if (!e) return null;
  audioStore.delete(id);
  return e.buffer;
}

// ─── Top-level: download voice note, transcribe, return {transcript, language} ───
async function processVoiceNote(mediaUrl, mediaContentType) {
  const audio = await downloadTwilioMedia(mediaUrl);
  return transcribeAudio(audio, mediaContentType);
}

module.exports = {
  processVoiceNote,
  transcribeAudio,
  textToSpeech,
  storeAudio,
  getStoredAudio,
  downloadTwilioMedia,
};
