// voxtr-rad — WhatsApp AI for the Boom Health / Transguard demo.
//
// Flow:
//   Twilio  ─POST /webhook/whatsapp──►  transcribe voice (Deepgram)
//                                       ─►  Claude Opus 4.8 (with tools)
//                                       ─►  reply text  +  TTS voice note
//   Language routing:
//     Detected English  ─►  Deepgram Aura
//     Non-English       ─►  OpenAI TTS (multi-language)
//     No TTS provider   ─►  text only
//
// The Claude system prompt below is tuned to surface the *insurance-mandated care cascade*
// on every finding — that is the point of the demo tomorrow.

require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const {
  processVoiceNote,
  textToSpeech,
  storeAudio,
  getStoredAudio,
  downloadTwilioMedia,
} = require("./voice");
const { TOOLS, runTool } = require("./tools");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Demo auth (HTTP Basic) — protects the dashboard, not Twilio ───
// Skips: Twilio webhook (Twilio can't send Basic Auth headers), audio media
// fetch (Twilio downloads MP3s), and /health (monitoring). Everything else
// (dashboard, /api/*) requires DEMO_PASSWORD if set. If unset → open.
function demoAuth(req, res, next) {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw) return next();
  const openExact = new Set(["/health", "/webhook/whatsapp"]);
  if (openExact.has(req.path)) return next();
  if (req.path.startsWith("/audio/")) return next();

  const header = req.headers.authorization || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
      const colonIdx = decoded.indexOf(":");
      const provided = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : "";
      if (provided === pw) return next();
    } catch (_) {}
  }
  res.set("WWW-Authenticate", 'Basic realm="voxtr-rad demo"');
  return res.status(401).send("Auth required");
}
app.use(demoAuth);

app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Twilio + Anthropic clients ───
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RAW_VOXTR = process.env.TWILIO_WHATSAPP_NUMBER || "";
const VOXTR_NUMBER = RAW_VOXTR.startsWith("whatsapp:") ? RAW_VOXTR : `whatsapp:${RAW_VOXTR}`;

// ─── Public URL for serving audio back to Twilio (must be reachable from Twilio) ───
// Twilio downloads media from mediaUrl on the outbound MessageResource, so this MUST match
// the URL the app is deployed under. Set BASE_URL to the Railway/ngrok host.
// Normalize: strip whitespace, strip ALL trailing slashes, upgrade http→https, refuse placeholder.
const BASE_URL = (() => {
  let u = (process.env.BASE_URL || "").trim().replace(/\/+$/, "");
  if (u.startsWith("http://")) u = "https://" + u.slice(7);
  if (u.includes("xxxx") || u === "") {
    console.error(`❌ BASE_URL is placeholder or empty: "${u}" — voice replies will fail. Set BASE_URL to your Railway domain (https://web-production-02d9c.up.railway.app).`);
    return "";
  }
  return u;
})();
console.log(`🌐 BASE_URL = "${BASE_URL}"`);

// ─── In-memory per-user conversation history (last 20 turns) ───
// Simple map keyed by from-number. Loss on restart is fine for a demo; swap to Redis/DB later.
const conversations = new Map();

function pushTurn(from, role, text, media) {
  const arr = conversations.get(from) || [];
  arr.push({ role, text, media, ts: Date.now() });
  if (arr.length > 30) arr.splice(0, arr.length - 30);
  conversations.set(from, arr);
}

function getHistoryForClaude(from) {
  const arr = conversations.get(from) || [];
  return arr.slice(-20).map((m) => {
    if (m.role === "user" && Array.isArray(m.media) && m.media.length > 0) {
      return {
        role: "user",
        content: [...m.media, { type: "text", text: m.text || "" }],
      };
    }
    return {
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    };
  });
}

// ─── Empty TwiML — we send messages via REST client, not TwiML ───
const EMPTY_TWIML = "<Response></Response>";
function twimlOk(res) {
  return res.type("text/xml").status(200).send(EMPTY_TWIML);
}

function normalizeWhatsApp(num) {
  let n = num.trim();
  if (n.startsWith("whatsapp:")) n = n.substring(9).trim();
  if (!n.startsWith("+")) n = "+" + n;
  return "whatsapp:" + n;
}

// ─── Send text-only WhatsApp reply ───
async function sendText(to, body) {
  const t = normalizeWhatsApp(to);
  try {
    const msg = await twilioClient.messages.create({ from: VOXTR_NUMBER, to: t, body });
    console.log(`✅ Text sent to ${t}: SID=${msg.sid} status=${msg.status}`);
  } catch (err) {
    console.error(`❌ Text failed to ${t}: ${err.message} (code ${err.code})`);
  }
}

// ─── Send text + optional voice note ───
async function sendReply(to, text, language, wantVoice) {
  await sendText(to, text);
  if (!wantVoice) return;
  if (!BASE_URL) {
    console.warn("⚠️ BASE_URL not set — voice reply skipped (Twilio needs a reachable URL).");
    return;
  }
  try {
    // Strip WhatsApp formatting so TTS reads cleanly.
    const clean = text
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/~([^~]+)~/g, "$1");
    const audio = await textToSpeech(clean, language);
    const id = `vn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    storeAudio(id, audio);
    const audioUrl = `${BASE_URL}/audio/${id}`;
    console.log(`🔊 Attempting voice reply to ${to}: ${audioUrl} (lang=${language})`);
    await twilioClient.messages.create({
      from: VOXTR_NUMBER,
      to: normalizeWhatsApp(to),
      mediaUrl: [audioUrl],
    });
    console.log(`✅ Voice reply queued to ${to}`);
  } catch (err) {
    if (err.code === "TTS_LANG_UNSUPPORTED") {
      console.warn(`⚠️ TTS skipped: ${err.message}`);
    } else {
      console.error(`❌ Voice reply failed (text was sent): ${err.message}`);
    }
  }
}

// ─── System prompt — the demo's soul ───
const SYSTEM_PROMPT = `You are Voxtr — a voice-first, multilingual healthcare assistant embedded inside Boom Health's platform. You serve three audiences on the same WhatsApp number:

  1. PATIENTS — help them prepare for scans, understand appointments, and answer questions in their own language.
  2. WORKERS (blue-collar) — guide them through visa medicals and workforce health checks. Reply in the language they wrote in (Urdu, Malayalam, Tagalog, Arabic, Hindi, English).
  3. CLINICIANS AND EMPLOYERS — help doctors pull priors, and help HR see workforce-health metrics.

TOOLS you can call:
  - get_scan_prep(scan_type)
  - get_appointment_details(appointment_key)  — 'demo_visa_medical' or 'demo_ultrasound'
  - get_patient_priors(mrn)  — the priors response INCLUDES the insurance-mandated care pathway per finding
  - get_employer_dashboard(employer_key)  — cohort stats + downstream revenue forecast
  - get_care_pathway(pathway_key)  — explicit lookup of the mandated follow-up cascade

CRITICAL DEMO BEHAVIOUR:
  - When a clinician asks for priors, ALWAYS call get_patient_priors, then in your reply surface (a) the finding, (b) the reader and date, and (c) the INSURANCE-MANDATED next steps + expected touchpoints. Doctors buy the "what's next" more than the "what happened".
  - When an employer asks about workforce medicals, ALWAYS call get_employer_dashboard, then in your reply surface (a) cleared vs flagged, (b) first-pass rate, (c) the DOWNSTREAM REVENUE FORECAST from the mandated follow-ups on flagged workers. HR buys the ROI, not the raw count.
  - When a patient or worker asks about prep or where to go, call get_scan_prep or get_appointment_details as appropriate. Reply in THEIR language.
  - For patients (like a pregnant lady asking about an ultrasound), be warm, human, specific about prep — bladder full, drink one litre, wear loose clothing — and set a self-reminder cue.
  - For workers, be direct: centre name, exact address, time, documents, fasting rule, transport, result ETA.

STYLE:
  - Keep replies SHORT and voice-friendly (3–6 sentences, no bullet dumps unless the format really demands it).
  - Reply in the same language as the user. Do not translate their question.
  - No disclaimers, no "please consult your doctor" boilerplate — this is an operational assistant embedded in a real clinical workflow.
  - Never hallucinate MRNs, prices, or pathway steps — always call the tool.
  - When quoting monetary figures, always cite them as insurance-mandated pathway revenue, not out-of-pocket cost to the patient.

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;

// ─── Main AI turn ───
async function runAiTurn(from, userText, mediaBlocks, isVoice, detectedLanguage) {
  pushTurn(from, "user", userText, mediaBlocks);

  const messages = getHistoryForClaude(from);
  const dynamic = `Message channel: WhatsApp voice note = ${isVoice}. Detected user language: ${detectedLanguage}. Reply naturally in that language; the reply will be spoken back over voice as well as sent as text.`;

  const system = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];

  let iter = 4; // 3 tool rounds + 1 final
  let replyText = "";

  try {
    while (iter-- > 0) {
      const resp = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system,
        tools: TOOLS,
        messages,
      });
      logUsage(resp.usage);

      const toolUses = resp.content.filter((b) => b.type === "tool_use");
      const stopped = resp.stop_reason === "end_turn" || toolUses.length === 0;

      if (stopped) {
        replyText = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        break;
      }

      // Run every tool call in this round.
      messages.push({ role: "assistant", content: resp.content });
      const toolResults = [];
      for (const t of toolUses) {
        console.log(`🛠️  tool ${t.name}(${JSON.stringify(t.input)})`);
        const result = await runTool(t.name, t.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!replyText) replyText = "I couldn't complete that just now — please try again in a moment.";
  } catch (err) {
    console.error("AI error:", err.message);
    replyText = "Something went wrong on my end — please try again.";
  }

  pushTurn(from, "assistant", replyText);
  await sendReply(from, replyText, detectedLanguage, isVoice);
}

function logUsage(usage) {
  if (!usage) return;
  console.log(
    `💸 in=${usage.input_tokens} out=${usage.output_tokens} cache_write=${usage.cache_creation_input_tokens || 0} cache_read=${usage.cache_read_input_tokens || 0}`
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════

// Serve TTS audio back to Twilio when it fetches the mediaUrl.
app.get("/audio/:id", (req, res) => {
  const buf = getStoredAudio(req.params.id);
  if (!buf) return res.status(404).send("Audio not found or expired");
  res.set("Content-Type", "audio/mpeg");
  res.set("Content-Length", buf.length);
  res.send(buf);
});

// Main WhatsApp webhook.
app.post("/webhook/whatsapp", async (req, res) => {
  const {
    From: from,
    Body: body,
    ProfileName: profileName,
    NumMedia,
    MediaContentType0,
    MediaUrl0,
  } = req.body;

  let text = body || "";
  let isVoice = false;
  let language = "en";
  const mediaBlocks = [];

  const numMedia = parseInt(NumMedia) || 0;

  // Voice note branch
  if (numMedia > 0 && MediaContentType0 && MediaContentType0.startsWith("audio/")) {
    try {
      const { transcript, language: lang } = await processVoiceNote(MediaUrl0, MediaContentType0);
      if (!transcript || !transcript.trim()) {
        await sendText(from, "I received your voice note but couldn't make out what was said. Try again, or type your message?");
        return twimlOk(res);
      }
      text = transcript.trim();
      language = lang || "en";
      isVoice = true;
      console.log(`🎙️  ${from} [${language}]: "${text}"`);
    } catch (err) {
      console.error("Voice transcription failed:", err.message);
      await sendText(from, "I had trouble processing your voice note. Try again, or type your message?");
      return twimlOk(res);
    }
  }
  // Image / PDF branch — vision-enabled for future clinical-doc scenarios
  else if (numMedia > 0) {
    const MAX = 5 * 1024 * 1024;
    for (let i = 0; i < numMedia; i++) {
      const url = req.body[`MediaUrl${i}`];
      const ctype = req.body[`MediaContentType${i}`];
      if (!url || !ctype || ctype.startsWith("audio/")) continue;
      try {
        const buf = await downloadTwilioMedia(url);
        if (buf.length > MAX) {
          await sendText(from, "One of your attachments is over 5MB — please send a smaller file.");
          continue;
        }
        const data = buf.toString("base64");
        if (ctype.startsWith("image/")) {
          mediaBlocks.push({ type: "image", source: { type: "base64", media_type: ctype, data } });
        } else if (ctype === "application/pdf") {
          mediaBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
        }
      } catch (e) {
        console.error(`Media download ${i} failed: ${e.message}`);
      }
    }
    if (!text && mediaBlocks.length > 0) {
      text = `[user sent ${mediaBlocks.length} attachment${mediaBlocks.length > 1 ? "s" : ""}]`;
    }
  }

  if (!from) return twimlOk(res);
  if (!text && mediaBlocks.length === 0) return twimlOk(res);

  console.log(`📨 ${from} (${profileName || "unknown"})${isVoice ? " 🎙️" : ""}: ${text.substring(0, 100)}`);

  // Fire and forget — Twilio only needs the empty TwiML immediately.
  runAiTurn(from, text, mediaBlocks, isVoice, language).catch((err) => {
    console.error("AI turn crashed:", err);
    sendText(from, "Sorry, something went wrong. Please try again. 🙏").catch(() => {});
  });

  return twimlOk(res);
});

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD API — read-only endpoints that expose demoData to public/index.html.
// Kept simple: no auth, no rate limit — this is a synthetic-data sales demo, not prod.
// ═══════════════════════════════════════════════════════════════════════
const {
  SCAN_PREPS,
  CARE_PATHWAYS,
  PATIENTS,
  WORKER_COHORTS,
  APPOINTMENTS,
} = require("./demoData");

function inlinePathway(obj, key = "care_pathway_key") {
  if (!obj || !obj[key]) return obj;
  return { ...obj, insurance_mandated_pathway: CARE_PATHWAYS[obj[key]] || null };
}

app.get("/api/patients", (_req, res) => {
  res.json(Object.values(PATIENTS).map((p) => ({
    mrn: p.mrn,
    name: p.name,
    dob: p.dob,
    latest_study: p.priors[p.priors.length - 1] || null,
    insurance: p.insurance || null,
  })));
});

app.get("/api/patient/:mrn", (req, res) => {
  const p = PATIENTS[req.params.mrn];
  if (!p) return res.status(404).json({ error: "patient not found" });
  res.json({
    ...p,
    priors: p.priors.map((pr) => inlinePathway(pr)),
  });
});

app.get("/api/employers", (_req, res) => {
  res.json(Object.keys(WORKER_COHORTS).map((k) => ({
    key: k,
    employer: WORKER_COHORTS[k].employer,
    total_screened: WORKER_COHORTS[k].total_screened,
    flagged_followup: WORKER_COHORTS[k].flagged_followup,
  })));
});

app.get("/api/employer/:key", (req, res) => {
  const e = WORKER_COHORTS[req.params.key];
  if (!e) return res.status(404).json({ error: "employer not found" });
  res.json({
    ...e,
    flagged_workers: e.flagged_workers.map((w) => inlinePathway(w)),
  });
});

app.get("/api/pathways", (_req, res) => {
  res.json(
    Object.entries(CARE_PATHWAYS).map(([k, v]) => ({ key: k, ...v }))
  );
});

app.get("/api/scan-preps", (_req, res) => res.json(SCAN_PREPS));
app.get("/api/appointments", (_req, res) => res.json(APPOINTMENTS));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "voxtr-rad",
    version: "0.1.0",
    tts: {
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
    twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER),
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
    base_url_set: !!process.env.BASE_URL,
  });
});

// ─── Start ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 voxtr-rad running on port ${PORT}`);
  console.log(`📱 Twilio webhook: POST /webhook/whatsapp`);
  console.log(`🩺 Health: GET /health`);
  if (!BASE_URL) console.warn("⚠️  BASE_URL not set — voice replies will be text-only.");
});
