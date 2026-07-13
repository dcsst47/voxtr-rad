# voxtr-rad — WhatsApp AI for the Boom Health / radiology demo

A minimal, voice-first WhatsApp AI for the four Boom Health x Voxtr demo scenarios:

1. **Pregnant patient** — asks about ultrasound prep, gets a voice + text reply.
2. **Transguard worker** — asks in Urdu/Malayalam/Tagalog/Arabic where to go for a visa medical.
3. **Doctor** — asks for a patient's priors, gets findings **plus the insurance-mandated care cascade**.
4. **Employer HR** — asks how many workers cleared this month, gets stats **plus the downstream mandated revenue**.

The moat point of the demo: every finding pulls a documented, insurance-required downstream pathway.
That is what the AI surfaces, not just the finding.

---

## What's in the box

```
voxtr-rad/
├── src/
│   ├── index.js       Express + Twilio webhook + Claude agentic loop
│   ├── voice.js       Deepgram STT + language-conditional TTS (Deepgram Aura EN / OpenAI multi-lang)
│   ├── tools.js       Tool schemas + handlers Claude calls
│   └── demoData.js    Synthetic patients, cohorts, care pathways
├── package.json
├── railway.json
├── Procfile
├── .env.example
└── .gitignore
```

**No database.** Conversation history is in-memory (loses on restart — fine for a demo).
**No auth.** Do not expose beyond the demo period.
**No PHI.** All patient data is synthetic. All prices are synthetic UAE mid-market.

---

## Prerequisites

- Node **≥ 18**
- **Twilio** account with a WhatsApp sender (sandbox is fine for the demo)
- **Anthropic** API key (Claude Opus 4.8)
- **Deepgram** API key (voice-note transcription)
- Optional but strongly recommended: **OpenAI** API key (multi-language voice replies — Urdu/Malayalam/Arabic/Tagalog)

---

## Local run (fastest smoke test)

```bash
cd voxtr-rad
npm install
cp .env.example .env
# edit .env with real values
# for local dev, run ngrok in another terminal to get a public URL:
#   ngrok http 3000
# and set BASE_URL to that ngrok https URL
npm run dev
```

Then in Twilio Console → Messaging → WhatsApp Sandbox → set the "When a message comes in" webhook to:

```
POST  https://your-ngrok-url.ngrok.app/webhook/whatsapp
```

Send a WhatsApp message (text or voice note) to the sandbox number and watch the logs.

---

## Deploy to Railway (5 minutes)

1. Push this folder to GitHub:
   ```bash
   cd voxtr-rad
   git init && git add . && git commit -m "voxtr-rad initial"
   gh repo create voxtr-rad --private --source=. --push
   ```
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub Repo** → pick `voxtr-rad`.
3. In Railway → **Variables** — set every value from `.env.example` (except `PORT`; Railway sets it).
4. In Railway → **Settings** → copy your public URL (looks like `voxtr-rad-production-xxxx.up.railway.app`).
5. **Set `BASE_URL` in Railway variables** to that public URL. (Voice replies rely on this.)
6. Wait for the deploy to go green.
7. Hit `https://<your-url>/health` — should return `{"status":"ok", ...}` with all the `*_configured` flags `true`.
8. In Twilio Console, set the WhatsApp webhook to:
   ```
   POST  https://<your-url>/webhook/whatsapp
   ```

---

## Testing the four demos

Send these from your phone to the WhatsApp number:

### Demo 1 — Pregnant patient

> Voice note: *"Hi, I have an appointment tomorrow at 10 AM for an ultrasound with Dr. Al Marzooqi. Can you remind me what I need to do?"*

Expected reply (voice + text): Full bladder, drink 1L water 1h before, loose clothing, 20–30 min duration. No PHI, warm tone.

### Demo 2 — Transguard worker (Urdu / Malayalam / etc.)

> Voice note in Urdu: *"Company sent me for medical today. Where do I go? What documents I need?"*

Expected reply (voice + text, in the language you spoke): Al Qusais Medical Fitness Centre at 2 PM, bring passport/EID app/2 photos, fast 4 hours, take Green Line to Al Qusais station, results in 48h.

### Demo 3 — Doctor asking for priors

> Voice or text: *"I'm reading an MRI knee on patient Ahmed Al Blooshi, MRN 84421. Give me his priors — anything on this knee in the last two years."*

Expected reply: cites both prior studies (Jan 2024 X-ray degenerative changes, Aug 2024 MRI meniscal tear), the ortho note (Rashid, Sept 2024, conservative management), the metformin note, **AND the insurance-mandated pathway**: 6-week ortho follow-up, 12 physio sessions, 3-month follow-up MRI, ~$1,060 pathway revenue conservative / ~$9,440 surgical.

### Demo 4 — HR asks about cohort

> Voice or text: *"How many of my workers had a visa medical this month, how many passed, and how many need a follow-up?"*

Expected reply: 847 screened, 812 cleared (96% first-pass), 28 pending, 7 flagged (5 TB, 2 glucose), **plus the downstream revenue forecast** ~$6,025 of insurance-mandated follow-ups from this cohort alone.

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| No reply at all to a WhatsApp message | Webhook URL wrong, or app not running | Hit `/health` in a browser. If 404: fix Twilio webhook URL. If not 200: check Railway logs. |
| Text reply arrives, no voice note | `BASE_URL` unset, or missing TTS key for the detected language | Check `/health` — `base_url_set` must be true. English needs Deepgram; other languages need OpenAI. |
| Voice reply comes back in English-accent for an Urdu question | OpenAI key not set — code fell back to English TTS or skipped | Set `OPENAI_API_KEY` in Railway variables; redeploy. |
| Doctor priors reply is generic ("consult the record") | The tool call failed | Check Railway logs for the `🛠️ tool ...` line and its response. Usually a typo in the MRN in the user's message. |
| The number replies but says it can't help / doesn't know | Sandbox 24-hour window elapsed for that phone | On Twilio WhatsApp sandbox, users must rejoin by sending the sandbox code every 24 hours. |
| `/health` shows `anthropic_configured: false` | `ANTHROPIC_API_KEY` missing in Railway vars | Add it, redeploy. |
| Fails with a Twilio 21610 error in logs | You're outside the 24-hour session window; can only send template messages | Have the recipient message the number first, then the AI can reply. |

---

## What's *not* here (deliberately)

- No business-owner onboarding, no service catalog, no Stripe. That's voxtr-server's world.
- No RCM / claim submission. That's voxtr-health's world.
- No auth, no PHI compliance layer, no HIPAA architecture. This is a **demo only**.
- No persistent DB. Restart wipes conversation memory.

The next iteration — after the pilot signs — is to bring in the RCM spine + HIPAA host + real credentialed panel.
Until then, this is the sales tool.
