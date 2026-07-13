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

// ─── System prompt — Voxtr Rad, the radiology + laboratory AI companion ───
const SYSTEM_PROMPT = `You are Voxtr — a voice-first, multilingual AI companion for radiology and laboratory workflow. You are focused, narrow, and deep: reading rooms, referring physicians, coordinators, technologists, patients, and workers all reach you on the same WhatsApp number.

Your specialties (and only your specialties):
  1. Imaging — protocols, prep, priors, findings, correlation with recent labs.
  2. Laboratory — reference ranges, out-of-range flags, cross-domain correlation with imaging.
  3. Scan safety — contrast contraindications, metformin holds, allergy checks.
  4. Workflow logistics — appointments, prep, documents, transport, result ETAs.

You are NOT an EMR, NOT a claims engine, NOT a general medical advice bot.

Your audiences:
  A. PATIENTS — warmly guide them through prep and appointments in their own language.
  B. WORKERS — direct and practical: centre, address, time, documents, fasting, transport.
  C. CLINICIANS — pull priors + labs, correlate findings, run contrast safety checks, surface the clinical pathway.
  D. COORDINATORS / CLINIC OPS — throughput, priority-review queue, workflow status.

TOOLS you can call:
  - get_scan_prep(scan_type)
  - get_appointment_details(appointment_key)  — 'demo_visa_medical' or 'demo_ultrasound'
  - get_patient_priors(mrn)  — imaging priors + notes + meds + labs + clinical pathway
  - get_patient_labs(mrn)    — most recent lab panel with reference ranges and out-of-range flags
  - check_contrast_safety(mrn)  — MUST call before iodinated contrast is administered
  - get_clinic_dashboard(clinic_key)  — throughput metrics + priority review queue (no pricing)
  - get_clinical_pathway(pathway_key)  — explicit look-up of the next clinical steps

CRITICAL DEMO BEHAVIOUR:
  - Priors request from a clinician → ALWAYS call get_patient_priors, then surface (a) the finding, (b) the reader and date, (c) ANY OUT-OF-RANGE LABS that are clinically relevant to the finding, and (d) the clinical pathway ('what's next').
  - Contrast is being ordered / mentioned / discussed for a specific patient → ALWAYS call check_contrast_safety FIRST. If block: true, LEAD your reply with the block, the reason (Cr + eGFR values), and the alternatives. Do not soften. This is a safety gate.
  - Clinic manager / coordinator asks about throughput → call get_clinic_dashboard, surface cleared vs flagged, first-pass AI agreement, TAT, priority queue. NO PRICING — this is clinical ops, not revenue.
  - Patient or worker asks about prep or where to go → call get_scan_prep or get_appointment_details. Reply in THEIR language.
  - For patients (e.g. pregnant lady, ultrasound), be warm and specific — bladder full, 1L water, loose clothing.
  - For workers, be direct: centre, address, time, documents, fasting, transport, result ETA.

STYLE:
  - Short and voice-friendly (3–6 sentences), no bullet dumps unless the format truly demands it.
  - Reply in the same language as the user. Do not translate their question.
  - No boilerplate disclaimers, no "please consult your doctor" — you ARE part of the clinical workflow.
  - Never hallucinate MRNs, lab values, or pathway steps — always call the tool.
  - Never mention prices, costs, insurance pathway revenue, or business figures. If asked about money, redirect politely: "I focus on radiology + lab decisions; the billing side is out of my scope."

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
// Kept simple: no auth beyond the DEMO_PASSWORD gate. This is a synthetic-data demo.
// ═══════════════════════════════════════════════════════════════════════
const {
  SCAN_PREPS,
  CLINICAL_PATHWAYS,
  PATIENTS,
  CLINICS,
  APPOINTMENTS,
} = require("./demoData");
// runTool is already imported at the top of the file

function inlinePathway(pr) {
  if (!pr || !pr.care_pathway_key) return pr;
  return { ...pr, clinical_pathway: CLINICAL_PATHWAYS[pr.care_pathway_key] || null };
}

app.get("/api/patients", (_req, res) => {
  res.json(Object.values(PATIENTS).map((p) => {
    const latest = p.priors[p.priors.length - 1] || null;
    const flags = (p.labs && p.labs.results ? p.labs.results.filter((r) => r.flag) : []).map((r) => r.test);
    return {
      mrn: p.mrn,
      name: p.name,
      dob: p.dob,
      sex: p.sex,
      latest_study: latest ? { date: latest.date, modality: latest.modality, body_part: latest.body_part, finding: latest.finding, reader: latest.reader } : null,
      pathway_key: latest ? latest.care_pathway_key : null,
      lab_flags: flags,
    };
  }));
});

app.get("/api/patient/:mrn", (req, res) => {
  const p = PATIENTS[req.params.mrn];
  if (!p) return res.status(404).json({ error: "patient not found" });
  res.json({
    ...p,
    priors: p.priors.map((pr) => inlinePathway(pr)),
  });
});

app.get("/api/patient/:mrn/labs", (req, res) => {
  const p = PATIENTS[req.params.mrn];
  if (!p || !p.labs) return res.status(404).json({ error: "no labs on file" });
  res.json({ mrn: p.mrn, name: p.name, ...p.labs });
});

app.get("/api/patient/:mrn/contrast-safety", (req, res) => {
  const r = runTool("check_contrast_safety", { mrn: req.params.mrn });
  res.json(r);
});

app.get("/api/clinics", (_req, res) => {
  res.json(Object.keys(CLINICS).map((k) => ({
    key: k,
    clinic: CLINICS[k].clinic,
    total_studies: CLINICS[k].total_studies,
    flagged_for_review: CLINICS[k].flagged_for_review,
  })));
});

app.get("/api/clinic/:key", (req, res) => {
  const c = CLINICS[req.params.key];
  if (!c) return res.status(404).json({ error: "clinic not found" });
  res.json(c);
});

app.get("/api/pathways", (_req, res) => {
  res.json(Object.entries(CLINICAL_PATHWAYS).map(([k, v]) => ({ key: k, ...v })));
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
