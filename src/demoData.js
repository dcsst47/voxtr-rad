// Synthetic radiology + laboratory data for the Voxtr Rad demo.
//
// Design principles:
//   1. No pricing. Only clinical decisions and workflow steps.
//   2. Every patient has BOTH imaging priors AND recent laboratory results.
//   3. Two "wow" cases baked in:
//        - Contrast contraindication (elevated creatinine → block iodinated contrast)
//        - Cross-domain flag (chest X-ray + inflammatory labs → TB workup pathway)
//   4. Realistic UAE clinic mix: MSK, OB, workforce medicals, oncology screening,
//      metabolic disease. Real modalities, plausible protocols, no PHI.
//
// Nothing here should be interpreted as clinical guidance for real care.

// ─────────────────────────────────────────────────────────────
// Scan-prep protocols (free-form context for Voxtr replies)
// ─────────────────────────────────────────────────────────────
const SCAN_PREPS = {
  ultrasound_lower_abdomen: {
    prep: "Full bladder required. Drink 1 litre of water starting 1 hour before your appointment. Do NOT empty your bladder before the scan.",
    clothing: "Loose, comfortable clothing.",
    duration: "20-30 minutes",
    fasting: false,
  },
  ultrasound_upper_abdomen: {
    prep: "Fasting for 6 hours before the scan. Water is allowed.",
    clothing: "Loose clothing.",
    duration: "20 minutes",
    fasting: true,
  },
  visa_medical_chest_xray: {
    prep: "Bring: passport, Emirates ID application, 2 passport photos. If a blood test is bundled, fast for 4 hours (water only).",
    clothing: "Remove metal jewellery, watches, upper-body clothing with metal fasteners.",
    duration: "45-60 minutes total including registration",
    fasting: true,
  },
  mri_knee: {
    prep: "No fasting. Remove ALL metal. Inform staff of any implants, pacemakers, or metal fragments.",
    clothing: "Change into a gown.",
    duration: "30-45 minutes",
    fasting: false,
  },
  mri_lumbar: {
    prep: "No fasting. Remove all metal. Inform staff of any implants.",
    clothing: "Change into a gown.",
    duration: "30-40 minutes",
    fasting: false,
  },
  mri_brain: {
    prep: "No fasting for non-contrast. If contrast: check renal function first.",
    clothing: "Change into a gown. Remove all metal.",
    duration: "30-45 minutes",
    fasting: false,
  },
  ct_chest_contrast: {
    prep: "Fasting 4 hours prior (water allowed). MUST have recent creatinine + eGFR. Hold metformin at scan and 48 hours after if diabetic. Notify staff of contrast allergy history.",
    clothing: "Loose clothing. Remove metal.",
    duration: "20 minutes",
    fasting: true,
  },
  ct_chest_no_contrast: {
    prep: "No fasting required. Remove metal from chest area.",
    clothing: "Loose clothing.",
    duration: "10 minutes",
    fasting: false,
  },
  mammogram_screening: {
    prep: "Avoid deodorant, powder, or lotion on chest and underarms on the day of the exam. Wear a two-piece outfit.",
    clothing: "Change into a gown.",
    duration: "20-30 minutes",
    fasting: false,
  },
  dexa_scan: {
    prep: "Do NOT take calcium supplements for 24 hours before. No barium studies within the past 7 days.",
    clothing: "Loose clothing without zips or metal.",
    duration: "10-15 minutes",
    fasting: false,
  },
};

// ─────────────────────────────────────────────────────────────
// Reference ranges for lab tests (UAE / international standards)
// ─────────────────────────────────────────────────────────────
const LAB_REFERENCE = {
  Creatinine:      { low: 0.7, high: 1.3, unit: "mg/dL" },
  eGFR:            { low: 60,  high: null, unit: "mL/min/1.73m²" },
  Urea:            { low: 15,  high: 40,   unit: "mg/dL" },
  Sodium:          { low: 136, high: 145,  unit: "mmol/L" },
  Potassium:       { low: 3.5, high: 5.0,  unit: "mmol/L" },
  Glucose_fasting: { low: 70,  high: 99,   unit: "mg/dL" },
  Glucose_random:  { low: null, high: 140, unit: "mg/dL" },
  HbA1c:           { low: 4.0, high: 5.6,  unit: "%" },
  ALT:             { low: 7,   high: 55,   unit: "U/L" },
  AST:             { low: 8,   high: 48,   unit: "U/L" },
  ALP:             { low: 45,  high: 115,  unit: "U/L" },
  Bilirubin_total: { low: 0.1, high: 1.2,  unit: "mg/dL" },
  Hemoglobin:      { low: 12,  high: 16,   unit: "g/dL" },
  WBC:             { low: 4,   high: 11,   unit: "×10³/µL" },
  Platelets:       { low: 150, high: 450,  unit: "×10³/µL" },
  ESR:             { low: 0,   high: 20,   unit: "mm/hr" },
  CRP:             { low: 0,   high: 5,    unit: "mg/L" },
  Vitamin_D:       { low: 30,  high: 100,  unit: "ng/mL" },
  Calcium:         { low: 8.5, high: 10.5, unit: "mg/dL" },
  TSH:             { low: 0.4, high: 4.0,  unit: "mIU/L" },
  Beta_hCG:        { low: null, high: null, unit: "mIU/mL" },
};

// ─────────────────────────────────────────────────────────────
// Clinical pathways — NO PRICING. Just what happens next, clinically.
// ─────────────────────────────────────────────────────────────
const CLINICAL_PATHWAYS = {
  medial_meniscal_tear_conservative: {
    finding: "Small horizontal tear, posterior horn medial meniscus (right knee)",
    clinical_context: "Horizontal / degenerative tears are managed conservatively before surgery is considered. Standard MSK pathway.",
    mandated_followups: [
      { step: "Orthopaedic follow-up consult", cadence: "at 6 weeks" },
      { step: "Physiotherapy — structured knee rehab protocol", cadence: "2 sessions/week × 6 weeks" },
      { step: "NSAID + activity-modification review", cadence: "at 4 weeks" },
      { step: "Follow-up MRI (right knee, no contrast)", cadence: "at 3 months if symptoms persist" },
      { step: "Second ortho review — surgical decision", cadence: "at 3 months" },
    ],
    if_conservative_fails_pathway: [
      { step: "Pre-anaesthetic workup (CBC, ECG, chest X-ray, PT/PTT)", cadence: "pre-op" },
      { step: "Arthroscopic partial meniscectomy (day surgery)" },
      { step: "Post-op MRI", cadence: "at 6 months" },
      { step: "Post-op physiotherapy", cadence: "3 sessions/week × 8 weeks" },
    ],
  },

  first_trimester_obstetric_normal: {
    finding: "First trimester obstetric ultrasound — single intrauterine pregnancy, viable, no anomalies",
    clinical_context: "Antenatal schedule kicks in immediately: nuchal → anomaly → growth → term scans + routine labs.",
    mandated_followups: [
      { step: "Nuchal translucency + first-trimester screen (11–13 weeks)" },
      { step: "Anomaly scan", cadence: "20–22 weeks" },
      { step: "Growth scan", cadence: "28 weeks" },
      { step: "Third-trimester scan", cadence: "32–34 weeks" },
      { step: "Term / positioning scan", cadence: "37+ weeks" },
      { step: "OGTT — gestational diabetes screen", cadence: "24–28 weeks" },
      { step: "CBC + iron studies", cadence: "third trimester" },
    ],
  },

  visa_medical_cleared: {
    finding: "Chest X-ray and labs within normal limits — no evidence of active TB or systemic disease.",
    clinical_context: "Standard visa medical clearance. No further imaging or lab work required.",
    mandated_followups: [
      { step: "Report signed and released to employer/MoH" },
      { step: "Voxtr voice-note to worker: cleared, next steps for EID" },
    ],
  },

  tb_workup_flagged: {
    finding: "Chest X-ray shows reticulonodular pattern in right upper lobe. Inflammatory markers elevated (WBC 12.4, ESR 62, CRP 88). Concern for active pulmonary TB.",
    clinical_context: "UAE MoH visa protocol: any TB-suggestive finding mandates confirmatory workup within 14 days. Visa provisionally held.",
    mandated_followups: [
      { step: "GeneXpert MTB/RIF PCR test", cadence: "within 7 days" },
      { step: "Sputum smear × 3 (AFB microscopy)", cadence: "consecutive days" },
      { step: "Interferon-gamma release assay (IGRA / QuantiFERON-TB Gold)" },
      { step: "High-resolution CT chest", cadence: "within 14 days" },
      { step: "Pulmonology consult" },
      { step: "Directly-observed therapy (DOT) initiation if active" },
    ],
  },

  fatty_liver_metabolic: {
    finding: "Diffusely increased hepatic echogenicity consistent with hepatic steatosis (moderate). No focal lesion. Portal vein patent.",
    clinical_context: "NAFLD in the context of prediabetes (HbA1c 6.1). Metabolic workup and lifestyle intervention indicated.",
    mandated_followups: [
      { step: "Endocrinology referral for prediabetes management" },
      { step: "Dietician referral — Mediterranean / low-carb protocol" },
      { step: "Physical activity plan — 150 min moderate/week" },
      { step: "Repeat LFTs + HbA1c", cadence: "at 3 months" },
      { step: "Repeat US upper abdomen", cadence: "at 6 months if LFTs persist raised" },
      { step: "Hepatology consult if fibrosis progresses" },
    ],
  },

  ct_contrast_contraindicated: {
    finding: "Solitary pulmonary nodule 12mm right upper lobe. Non-contrast CT recommended pending renal clearance.",
    clinical_context: "CONTRAST CONTRAINDICATION: Cr 2.4, eGFR 32 (CKD stage 3b). Iodinated contrast risks acute-on-chronic kidney injury.",
    contrast_safety: {
      block: true,
      reason: "eGFR 32 mL/min/1.73m² — iodinated contrast contraindicated per KDIGO / ACR guidance.",
      alternatives: [
        "Non-contrast CT chest (immediate — recommended)",
        "MRI chest with gadobutrol (safer at this eGFR; check gado approval)",
        "Pre-hydration protocol + N-acetylcysteine if contrast unavoidable — requires nephro sign-off",
      ],
      also: "Hold metformin at scan and for 48 hours post-contrast; recheck Cr before restart.",
    },
    mandated_followups: [
      { step: "Non-contrast CT chest — same visit if patient still available" },
      { step: "Nephrology consult", cadence: "within 7 days" },
      { step: "Pulmonology consult — nodule characterisation", cadence: "within 14 days" },
      { step: "PET-CT if malignancy concern (requires nephro clearance)" },
      { step: "Metformin hold — 48 hours if contrast is later administered" },
    ],
  },

  lumbar_disc_bulge: {
    finding: "L4-L5 posterior disc bulge with mild central canal stenosis. No frank herniation. No nerve root impingement.",
    clinical_context: "Chronic mechanical back pain with mild degenerative changes. Conservative pathway is first-line.",
    mandated_followups: [
      { step: "Physiotherapy — core stabilisation + McKenzie protocol", cadence: "2 sessions/week × 6 weeks" },
      { step: "NSAID + activity guidance" },
      { step: "Neurosurgical review", cadence: "at 6 weeks if no improvement" },
      { step: "Repeat MRI lumbar", cadence: "at 3 months if red flags emerge" },
    ],
  },

  dexa_osteoporosis: {
    finding: "T-score -3.1 (lumbar spine), Z-score -2.4. Osteoporosis with high fracture risk.",
    clinical_context: "Post-menopausal osteoporosis with concurrent Vitamin D deficiency (14 ng/mL). Immediate treatment indicated.",
    mandated_followups: [
      { step: "Bisphosphonate (alendronate) initiation" },
      { step: "Vitamin D repletion (50,000 IU weekly × 8 weeks, then 1,000 IU daily)" },
      { step: "Calcium 1,200 mg/day + adequate dietary intake" },
      { step: "Fall-prevention counselling + home safety review" },
      { step: "DEXA follow-up", cadence: "in 24 months" },
      { step: "Endocrine review if T-score does not improve" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Patient records — 8 patients with priors + labs + pathways
// ─────────────────────────────────────────────────────────────
function mkLab(name, value, note) {
  const ref = LAB_REFERENCE[name] || {};
  let flag = null;
  if (ref.high !== null && ref.high !== undefined && value > ref.high) flag = "HIGH";
  else if (ref.low !== null && ref.low !== undefined && value < ref.low) flag = "LOW";
  return {
    test: name.replace(/_/g, " "),
    value,
    unit: ref.unit || "",
    ref_low: ref.low,
    ref_high: ref.high,
    flag,
    note: note || null,
  };
}

const PATIENTS = {
  "84421": {
    mrn: "84421",
    name: "Ahmed Al Blooshi",
    dob: "1978-06-14",
    sex: "M",
    agent_activity: [
      { time: "07:52", source: "PACS", action: "Pulled prior imaging on right knee (2 studies over 2 years)" },
      { time: "07:52", source: "LIS", action: "Retrieved most recent lab panel (2026-07-10)" },
      { time: "07:53", source: "AI decision", action: "Flagged HbA1c 6.8 (HIGH) alongside MSK finding — cross-domain metabolic context" },
      { time: "07:53", source: "AI decision", action: "Correlated meniscal tear with existing medial-compartment degenerative changes (Jan 2024)" },
      { time: "07:53", source: "AI decision", action: "Assembled conservative pathway per prior Rashid orthopaedic recommendation" },
      { time: "07:54", source: "Portal", action: "Surfaced medication note: metformin — flag for any future contrast study" },
      { time: "07:54", source: "Portal", action: "Notified Dr. Rashid — record ready for review" },
    ],
    priors: [
      {
        date: "2024-01-12",
        modality: "X-ray",
        body_part: "Right knee",
        finding: "Mild degenerative changes in the medial compartment. Joint space preserved. No acute fracture.",
        reader: "Dr. K. Menon",
        care_pathway_key: null,
      },
      {
        date: "2024-08-03",
        modality: "MRI",
        body_part: "Right knee",
        finding: "Small horizontal tear of the posterior horn of the medial meniscus. No ACL involvement. Mild bone marrow oedema at medial femoral condyle.",
        reader: "Dr. S. Rashid",
        care_pathway_key: "medial_meniscal_tear_conservative",
      },
    ],
    notes: [
      { date: "2024-09-15", author: "Dr. Rashid, Orthopaedic",
        summary: "Recommended conservative management for right medial meniscal tear. Physiotherapy 6 weeks. Review at 3 months. No surgical indication at this time." },
    ],
    medications: [
      { drug: "Metformin", started: "2024-06-10", note: "Type 2 diabetes — flag for iodinated contrast studies." },
      { drug: "Atorvastatin", started: "2023-02-01" },
    ],
    labs: {
      panel_date: "2026-07-10",
      results: [
        mkLab("HbA1c", 6.8, "Suboptimal glycaemic control"),
        mkLab("Glucose_fasting", 128),
        mkLab("Creatinine", 1.1),
        mkLab("eGFR", 82),
        mkLab("ALT", 42),
        mkLab("Hemoglobin", 14.2),
        mkLab("WBC", 7.8),
      ],
    },
  },

  "77208": {
    mrn: "77208",
    name: "Fatima Al Hosani",
    dob: "1995-11-22",
    sex: "F",
    agent_activity: [
      { time: "09:12", source: "WhatsApp", action: "Received voice note (EN) — patient asked about ultrasound prep" },
      { time: "09:12", source: "AI decision", action: "Identified scan type: lower abdomen obstetric — full-bladder protocol required" },
      { time: "09:13", source: "WhatsApp", action: "Voice + text reply sent to patient with prep instructions" },
      { time: "09:13", source: "LIS", action: "Retrieved most recent pregnancy panel (2025-11-04)" },
      { time: "09:13", source: "AI decision", action: "Flagged mild anaemia (Hb 11.4) — iron supplementation on record, no additional action" },
      { time: "09:14", source: "Portal", action: "Antenatal schedule auto-populated for Dr. Al Marzooqi's queue" },
    ],
    priors: [
      {
        date: "2025-11-04",
        modality: "Ultrasound",
        body_part: "Lower abdomen (obstetric, 12+2 weeks)",
        finding: "Single intrauterine pregnancy, gestational age 12+2 weeks, foetal heartbeat present. No anomalies detected.",
        reader: "Dr. R. Thomas",
        care_pathway_key: "first_trimester_obstetric_normal",
      },
    ],
    notes: [
      { date: "2025-11-04", author: "Dr. Al Marzooqi, Obstetrician",
        summary: "First trimester scan normal. Booked for 20-week anomaly scan. Prescribed prenatal vitamins + iron." },
    ],
    medications: [
      { drug: "Prenatal vitamins", started: "2025-10-01" },
      { drug: "Ferrous sulphate", started: "2025-11-04", note: "Mild iron-deficiency anaemia" },
    ],
    labs: {
      panel_date: "2025-11-04",
      results: [
        mkLab("Beta_hCG", 68000, "Consistent with 12 weeks gestation"),
        mkLab("Hemoglobin", 11.4, "Mild anaemia — iron supplementation started"),
        mkLab("Glucose_random", 96),
        mkLab("TSH", 1.8),
        mkLab("Creatinine", 0.7),
      ],
    },
  },

  "10241": {
    mrn: "10241",
    name: "Rafiq Khan",
    dob: "1990-03-18",
    sex: "M",
    agent_activity: [
      { time: "13:04", source: "WhatsApp", action: "Voice note (UR) — worker asked for medical centre location" },
      { time: "13:04", source: "AI decision", action: "Matched to visa-medical workflow · Al Qusais centre" },
      { time: "13:05", source: "WhatsApp", action: "Reply sent in Urdu — address, documents, fasting, transport" },
      { time: "13:47", source: "PACS", action: "CXR ingested from Al Qusais centre — routed for AI triage" },
      { time: "13:47", source: "AI decision", action: "AI classification: NORMAL (confidence 0.98)" },
      { time: "13:47", source: "LIS", action: "Retrieved same-visit blood panel — all values within range" },
      { time: "13:48", source: "AI decision", action: "Correlated CXR + labs — no cross-domain concern" },
      { time: "13:48", source: "Portal", action: "Report auto-drafted · reader confirmed in 42 seconds" },
      { time: "13:49", source: "WhatsApp", action: "Voice + text sent (UR) to worker — cleared, next steps for EID" },
      { time: "13:49", source: "Portal", action: "Report released to MoH submission queue" },
    ],
    priors: [
      {
        date: "2026-07-13",
        modality: "X-ray",
        body_part: "Chest PA (visa medical)",
        finding: "Lungs clear. Cardiomediastinal silhouette normal. No pleural effusion. No acute process.",
        reader: "Voxtr AI + Dr. K. Menon (confirmed)",
        care_pathway_key: "visa_medical_cleared",
      },
    ],
    notes: [
      { date: "2026-07-13", author: "Voxtr AI Triage",
        summary: "AI classification: normal. Reader confirmed in <60 seconds. Ready for MoH submission." },
    ],
    medications: [],
    labs: {
      panel_date: "2026-07-13",
      results: [
        mkLab("Hemoglobin", 14.8),
        mkLab("WBC", 6.9),
        mkLab("Glucose_fasting", 88),
        mkLab("HbA1c", 5.2),
        mkLab("ALT", 22),
        mkLab("Creatinine", 0.9),
      ],
    },
  },

  "10298": {
    mrn: "10298",
    name: "Divya Menon",
    dob: "1984-09-11",
    sex: "F",
    agent_activity: [
      { time: "10:32", source: "PACS", action: "US upper abdomen ingested — routed to abdominal sub-specialty queue" },
      { time: "10:33", source: "AI decision", action: "AI-flagged: hepatic steatosis pattern (moderate) — flagged for review" },
      { time: "10:33", source: "LIS", action: "Pulled same-week LFT + metabolic panel" },
      { time: "10:34", source: "AI decision", action: "Cross-domain flag: ALT 68 + HbA1c 6.1 → NAFLD + prediabetes correlation" },
      { time: "10:35", source: "Portal", action: "Endocrinology + dietician referrals auto-queued for Dr. Thomas' sign-off" },
      { time: "10:36", source: "WhatsApp", action: "Voice note (ML) sent to patient with follow-up plan explanation" },
    ],
    priors: [
      {
        date: "2026-06-28",
        modality: "Ultrasound",
        body_part: "Upper abdomen",
        finding: "Diffusely increased hepatic echogenicity consistent with moderate hepatic steatosis. No focal lesion. Gallbladder normal. Portal vein patent.",
        reader: "Dr. R. Thomas",
        care_pathway_key: "fatty_liver_metabolic",
      },
    ],
    notes: [
      { date: "2026-06-28", author: "Dr. A. Bakri, Endocrinology (referred)",
        summary: "Fatty liver + HbA1c 6.1 = prediabetes. Lifestyle intervention. Repeat panel in 3 months." },
    ],
    medications: [],
    labs: {
      panel_date: "2026-06-28",
      results: [
        mkLab("HbA1c", 6.1, "Prediabetes range"),
        mkLab("Glucose_fasting", 108),
        mkLab("ALT", 68, "Mild transaminitis — NAFLD picture"),
        mkLab("AST", 55),
        mkLab("ALP", 118),
        mkLab("Bilirubin_total", 0.9),
        mkLab("Creatinine", 0.8),
        mkLab("Hemoglobin", 12.6),
      ],
    },
  },

  "10342": {
    mrn: "10342",
    name: "Mohammed Al Shamsi",
    dob: "1964-11-04",
    sex: "M",
    agent_activity: [
      { time: "08:14", source: "Order entry", action: "Radiology order received: CT chest with IV contrast (RUL nodule characterisation)" },
      { time: "08:14", source: "PACS", action: "Retrieved 6 months of imaging — prior CXR from Dec 2025 flagged the nodule" },
      { time: "08:14", source: "LIS", action: "Pulled most recent metabolic panel + renal function (2026-07-13)" },
      { time: "08:15", source: "AI decision", action: "SAFETY GATE TRIGGERED — Creatinine 2.4 · eGFR 32 (CKD 3b)" },
      { time: "08:15", source: "AI decision", action: "IODINATED CONTRAST BLOCKED per KDIGO / ACR guidance" },
      { time: "08:15", source: "AI decision", action: "Medication list scanned — metformin, ramipril, empagliflozin (contrast + metformin flag)" },
      { time: "08:16", source: "AI decision", action: "Drafted alternatives: non-contrast CT · MRI + gadobutrol · pre-hydration protocol" },
      { time: "08:16", source: "Portal", action: "Alert pushed to Dr. K. Menon (radiology) — awaiting confirmation" },
      { time: "08:16", source: "Portal", action: "Alert pushed to Dr. Al Rashidi (referring) — awaiting confirmation" },
      { time: "08:17", source: "WhatsApp", action: "Voice note (AR) sent to patient — non-contrast alternative explained" },
      { time: "08:18", source: "Portal", action: "Non-contrast CT auto-booked into same 16:15 slot" },
      { time: "08:19", source: "Portal", action: "Nephrology consult requested — 7-day window · sent to Dr. Al Blooshi" },
      { time: "08:19", source: "AI decision", action: "Metformin hold instruction sent to patient (pre-scan reminder queued for 15:00)" },
    ],
    priors: [
      {
        date: "2025-12-19",
        modality: "X-ray",
        body_part: "Chest PA",
        finding: "Ill-defined 12mm opacity right upper lobe. Recommend cross-sectional imaging.",
        reader: "Dr. K. Menon",
        care_pathway_key: null,
      },
      {
        date: "2026-07-14",
        modality: "CT (order pending)",
        body_part: "Chest — CONTRAST HELD",
        finding: "Order placed for CT chest with IV contrast for RUL nodule characterisation. Voxtr held contrast pending renal review — see safety flag.",
        reader: "Voxtr AI — contrast hold",
        care_pathway_key: "ct_contrast_contraindicated",
      },
    ],
    notes: [
      { date: "2026-07-14", author: "Voxtr AI — Contrast Safety",
        summary: "Cr 2.4 / eGFR 32 (CKD 3b). Contrast contraindicated. Alerted referring physician. Non-contrast alternative offered." },
      { date: "2025-12-19", author: "Dr. K. Menon, Radiology",
        summary: "12mm RUL nodule — recommend CT chest, prefer contrast for characterisation IF renal function permits." },
    ],
    medications: [
      { drug: "Metformin", started: "2019-04-10", note: "MUST hold at scan + 48h post-contrast" },
      { drug: "Ramipril", started: "2021-07-22" },
      { drug: "Empagliflozin", started: "2023-11-15" },
    ],
    labs: {
      panel_date: "2026-07-13",
      results: [
        mkLab("Creatinine", 2.4, "CKD stage 3b — CONTRAST CONTRAINDICATION"),
        mkLab("eGFR", 32, "CKD 3b — hold contrast, nephro consult"),
        mkLab("Urea", 68),
        mkLab("Potassium", 5.3, "Borderline high — recheck"),
        mkLab("Sodium", 138),
        mkLab("HbA1c", 7.4),
        mkLab("Glucose_fasting", 152),
        mkLab("Hemoglobin", 11.8),
      ],
    },
  },

  "10391": {
    mrn: "10391",
    name: "Yousef Nasser",
    dob: "1974-02-08",
    sex: "M",
    agent_activity: [
      { time: "11:20", source: "PACS", action: "MRI lumbar ingested — routed to spine sub-specialty queue" },
      { time: "11:21", source: "AI decision", action: "AI-flagged L4-L5 posterior disc bulge · mild stenosis · no impingement" },
      { time: "11:21", source: "LIS", action: "Retrieved recent inflammatory markers — ESR 18, CRP 3.2 (normal, no infective concern)" },
      { time: "11:22", source: "AI decision", action: "Assembled conservative pathway: physio + NSAID + 6-week neurosurg review" },
      { time: "11:22", source: "Portal", action: "Report drafted · reader queued" },
    ],
    priors: [
      {
        date: "2026-05-22",
        modality: "MRI",
        body_part: "Lumbar spine",
        finding: "L4-L5 posterior disc bulge with mild central canal stenosis. No frank herniation. No nerve root impingement. L5-S1 mild disc dessication.",
        reader: "Dr. S. Rashid",
        care_pathway_key: "lumbar_disc_bulge",
      },
    ],
    notes: [
      { date: "2026-05-22", author: "Dr. Faraj, Neurosurgery",
        summary: "Conservative management. Physio + NSAID. Review at 6 weeks. Not a surgical candidate at this stage." },
    ],
    medications: [
      { drug: "Ibuprofen", started: "2026-05-22", note: "PRN" },
    ],
    labs: {
      panel_date: "2026-05-20",
      results: [
        mkLab("Hemoglobin", 14.6),
        mkLab("WBC", 7.2),
        mkLab("ESR", 18),
        mkLab("CRP", 3.2),
        mkLab("Creatinine", 1.0),
        mkLab("HbA1c", 5.5),
      ],
    },
  },

  "10501": {
    mrn: "10501",
    name: "Hassan Al Nuaimi",
    dob: "1998-08-30",
    sex: "M",
    agent_activity: [
      { time: "14:02", source: "PACS", action: "Visa-medical CXR ingested from Al Qusais centre" },
      { time: "14:02", source: "AI decision", action: "AI-FLAGGED: reticulonodular pattern R upper lobe with volume loss — TB CONCERN" },
      { time: "14:03", source: "LIS", action: "Retrieved same-visit blood panel (2026-07-14)" },
      { time: "14:03", source: "AI decision", action: "CROSS-DOMAIN CORRELATION: WBC 12.4 (H), ESR 62 (H), CRP 88 (H)" },
      { time: "14:03", source: "AI decision", action: "Priority-flag confirmed by two independent signals (imaging + inflammation)" },
      { time: "14:04", source: "Portal", action: "Alert pushed to Dr. K. Menon — awaiting confirmation" },
      { time: "14:04", source: "Portal", action: "GeneXpert MTB/RIF PCR + AFB smear × 3 orders queued" },
      { time: "14:04", source: "Portal", action: "HRCT chest booked · pulmonology consult requested" },
      { time: "14:05", source: "WhatsApp", action: "Voice note (UR) sent to worker — TB workup explanation" },
      { time: "14:05", source: "MoH", action: "Visa provisionally held pending confirmatory results" },
    ],
    priors: [
      {
        date: "2026-07-14",
        modality: "X-ray",
        body_part: "Chest PA (visa medical)",
        finding: "Reticulonodular pattern right upper lobe with volume loss. Findings suspicious for active or old pulmonary TB. Recommend confirmatory workup.",
        reader: "Voxtr AI + Dr. K. Menon (confirmed)",
        care_pathway_key: "tb_workup_flagged",
      },
    ],
    notes: [
      { date: "2026-07-14", author: "Voxtr AI — Cross-domain flag",
        summary: "Inflammatory labs correlate with CXR concern: WBC 12.4 (H), ESR 62 (H), CRP 88 (H). Recommend GeneXpert + IGRA + HRCT chest." },
    ],
    medications: [],
    labs: {
      panel_date: "2026-07-14",
      results: [
        mkLab("WBC", 12.4, "Leukocytosis — infection/inflammation"),
        mkLab("ESR", 62, "Markedly elevated"),
        mkLab("CRP", 88, "Marked acute-phase response"),
        mkLab("Hemoglobin", 13.4),
        mkLab("Platelets", 456, "Reactive thrombocytosis"),
        mkLab("Glucose_fasting", 92),
        mkLab("Creatinine", 0.9),
      ],
    },
  },

  "10488": {
    mrn: "10488",
    name: "Ines Da Silva",
    dob: "1958-04-19",
    sex: "F",
    agent_activity: [
      { time: "09:40", source: "PACS", action: "DEXA scan ingested — lumbar spine + hip" },
      { time: "09:41", source: "AI decision", action: "T-score -3.1 · Z-score -2.4 — osteoporosis, high fracture risk" },
      { time: "09:41", source: "LIS", action: "Retrieved Vit D + calcium + TSH panel" },
      { time: "09:42", source: "AI decision", action: "Cross-domain flag: Vit D 14 (DEFICIENT) — repletion protocol required" },
      { time: "09:42", source: "AI decision", action: "FRAX calculated: 22% major, 11% hip — treatment threshold met" },
      { time: "09:43", source: "Portal", action: "Bisphosphonate + Vit D repletion prescription queued for Dr. Bakri" },
      { time: "09:43", source: "Portal", action: "Fall-prevention counselling booked" },
    ],
    priors: [
      {
        date: "2026-06-10",
        modality: "DEXA",
        body_part: "Lumbar spine + hip",
        finding: "T-score -3.1 (lumbar spine), Z-score -2.4. Femoral neck T-score -2.6. Osteoporosis with high fracture risk (FRAX 22% major, 11% hip).",
        reader: "Dr. R. Thomas",
        care_pathway_key: "dexa_osteoporosis",
      },
    ],
    notes: [
      { date: "2026-06-10", author: "Dr. A. Bakri, Endocrinology",
        summary: "Post-menopausal osteoporosis with Vit D deficiency. Bisphosphonate + Vit D repletion. Follow-up DEXA in 24 months." },
    ],
    medications: [
      { drug: "Alendronate", started: "2026-06-10" },
      { drug: "Vitamin D3", started: "2026-06-10", note: "50,000 IU weekly × 8 weeks then 1,000 IU daily" },
      { drug: "Calcium carbonate", started: "2026-06-10" },
    ],
    labs: {
      panel_date: "2026-06-08",
      results: [
        mkLab("Vitamin_D", 14, "Deficient — repletion started"),
        mkLab("Calcium", 8.9),
        mkLab("TSH", 2.1),
        mkLab("Creatinine", 0.9),
        mkLab("Hemoglobin", 12.1),
        mkLab("HbA1c", 5.4),
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────
// Clinic throughput dashboard (no pricing, clinical-ops metrics only)
// ─────────────────────────────────────────────────────────────
const CLINICS = {
  main_clinic: {
    clinic: "Voxtr Rad Diagnostic Centre",
    period: "This month",
    total_studies: 847,
    routine_cleared: 812,
    pending_read: 28,
    flagged_for_review: 7,
    flag_breakdown: {
      tb_or_infection_concern: 3,
      contrast_safety_hold: 1,
      metabolic_or_cross_domain: 2,
      indeterminate_finding: 1,
    },
    first_pass_ai_agreement: 0.96,
    average_tat_hours: 2.4,
    modality_mix: {
      "Chest X-ray": 512,
      "Ultrasound": 148,
      "MRI": 79,
      "CT": 68,
      "DEXA": 21,
      "Mammogram": 19,
    },
    priority_review_queue: [
      { patient_ref: "10501", flag: "TB workup", status: "GeneXpert + IGRA ordered · pulm consult pending" },
      { patient_ref: "10342", flag: "Contrast contraindication", status: "Non-contrast alt offered · nephro referred" },
      { patient_ref: "10298", flag: "Metabolic cross-flag", status: "Endocrine referred · dietician booked" },
      { patient_ref: "78901", flag: "TB workup", status: "Sputum × 3 collection in progress" },
      { patient_ref: "79012", flag: "TB workup", status: "IGRA positive · HRCT booked" },
      { patient_ref: "79154", flag: "Metabolic cross-flag", status: "New T2DM diagnosis · plan in place" },
      { patient_ref: "79203", flag: "Indeterminate", status: "6-week short-interval CXR" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Appointments (Demo 2, mixed free-form + tool)
// ─────────────────────────────────────────────────────────────
const APPOINTMENTS = {
  demo_visa_medical: {
    centre: "Voxtr Rad Diagnostic Centre — Al Qusais",
    address: "Al Qusais Industrial Area 2",
    time: "Today at 2:00 PM",
    documents: ["Passport", "Emirates ID application", "2 passport photos"],
    fasting: "4 hours before the appointment; water is allowed",
    transport: "Green Line metro to Al Qusais station, then a 5-minute taxi.",
    result_eta: "Typically within 48 hours; you will be notified here.",
  },
  demo_ultrasound: {
    centre: "Voxtr Rad Diagnostic Centre — Jumeirah",
    address: "Al Wasl Road, Jumeirah 1",
    doctor: "Dr. Al Marzooqi",
    time: "Tomorrow at 10:00 AM",
    scan_type: "ultrasound_lower_abdomen",
    result_eta: "Same day, delivered here.",
  },
};

module.exports = {
  SCAN_PREPS,
  LAB_REFERENCE,
  CLINICAL_PATHWAYS,
  PATIENTS,
  CLINICS,
  APPOINTMENTS,
};
