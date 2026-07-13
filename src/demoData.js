// Synthetic data for the Boom Health demo.
//
// Design intent: every finding here carries an *insurance-mandated follow-up cascade*
// so the demo shows the downstream revenue capture — not just a single read. This is
// how Boom Health monetizes an anchor scan into a 6-12 month care journey.

// ─────────────────────────────────────────────────────────────
// Scan-prep protocols (Demo 1, free-form context — Claude uses these directly)
// ─────────────────────────────────────────────────────────────
const SCAN_PREPS = {
  ultrasound_lower_abdomen: {
    prep: "Full bladder required. Drink 1 litre of water starting 1 hour before your appointment. Do NOT empty your bladder before the scan.",
    clothing: "Loose, comfortable clothing. Avoid one-piece dresses.",
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
    prep: "Bring: passport, Emirates ID application, 2 recent passport photos. No fasting required for chest X-ray. If a blood test is bundled, fast for 4 hours (water only).",
    clothing: "Remove metal jewellery, watches, and upper-body clothing with metal fasteners.",
    duration: "45-60 minutes total including registration",
    fasting: true,
  },
  mri_knee: {
    prep: "No fasting. Remove all metal (jewellery, hair pins, coins). Inform staff of any implants, pacemakers, or metal fragments in the body.",
    clothing: "Change into a gown. Loose clothing recommended for arrival.",
    duration: "30-45 minutes",
    fasting: false,
  },
  ct_contrast: {
    prep: "Fasting 4 hours prior (water allowed). Notify staff if you are diabetic and on metformin, or have kidney problems.",
    clothing: "Loose clothing. Remove metal.",
    duration: "20 minutes",
    fasting: true,
  },
};

// ─────────────────────────────────────────────────────────────
// Insurance-mandated care pathways (the revenue cascade)
// ─────────────────────────────────────────────────────────────
// Each pathway represents what a UAE-market insurer typically pre-authorises
// once a specific finding is documented. Pricing is UAE mid-market, private
// sector, in USD for the demo.
//
// Keying by finding_slug so both patient priors and worker flags can reference them.

const CARE_PATHWAYS = {
  medial_meniscal_tear_conservative: {
    finding: "Small horizontal tear, posterior horn medial meniscus (right knee)",
    insurance_rule:
      "Standard UAE outpatient plans (DHIC, Daman Enhanced, Neuron, Nextcare) authorise a defined conservative pathway for horizontal / degenerative meniscal tears before surgery is considered. Failure to document this pathway invalidates surgical pre-auth.",
    mandated_followups: [
      { step: "Orthopaedic follow-up consult", cadence: "at 6 weeks", price_usd: 90 },
      { step: "Physiotherapy sessions (structured knee protocol)", cadence: "2 sessions/week × 6 weeks = 12 sessions", price_usd: 45, unit: "per session", subtotal_usd: 540 },
      { step: "NSAID + activity-modification review", cadence: "at 4 weeks", price_usd: 0, note: "Bundled into ortho follow-up" },
      { step: "Follow-up MRI (right knee, without contrast)", cadence: "at 3 months if symptoms persist", price_usd: 320 },
      { step: "Second ortho review — surgical decision", cadence: "at 3 months", price_usd: 110 },
    ],
    if_conservative_fails_pathway: [
      { step: "Pre-op MRI (already done above)", price_usd: 0 },
      { step: "Pre-anaesthetic workup (CBC, ECG, chest X-ray, PT/PTT)", price_usd: 180 },
      { step: "Arthroscopic partial meniscectomy (day surgery)", price_usd: 6800, note: "Surgeon + anaesthetist + facility." },
      { step: "Post-op MRI at 6 months (per insurer)", price_usd: 320 },
      { step: "Post-op physiotherapy", cadence: "3 sessions/week × 8 weeks = 24 sessions", price_usd: 45, unit: "per session", subtotal_usd: 1080 },
    ],
    revenue_summary_usd: {
      conservative_pathway_total: 1060,
      surgical_pathway_total: 9440,
      time_horizon_months: 9,
    },
  },

  degenerative_medial_compartment_early_oa: {
    finding: "Mild degenerative changes, medial compartment (right knee X-ray)",
    insurance_rule:
      "Early osteoarthritis findings on X-ray trigger a preventive-care pathway under UAE 'quality of care' insurer riders (Daman, Aetna GCC). Reimbursement conditional on documented lifestyle + physio intervention.",
    mandated_followups: [
      { step: "Baseline knee MRI (rule out concurrent soft-tissue injury)", cadence: "within 8 weeks of X-ray", price_usd: 320 },
      { step: "Rheumatology / ortho screen", cadence: "within 12 weeks", price_usd: 90 },
      { step: "Physiotherapy — quads/glutes strengthening", cadence: "1 session/week × 8 weeks", price_usd: 45, subtotal_usd: 360 },
      { step: "DEXA scan (bone density baseline for patients >45)", cadence: "one-time", price_usd: 150 },
    ],
    revenue_summary_usd: { pathway_total: 920, time_horizon_months: 4 },
  },

  first_trimester_obstetric_normal: {
    finding: "First trimester obstetric ultrasound — single intrauterine pregnancy, viable, no anomalies",
    insurance_rule:
      "UAE mandatory maternity coverage (Dubai maternity essential benefit + Abu Dhabi Thiqa/Enhanced) mandates a defined antenatal schedule: 5 obstetric ultrasounds + labs across trimesters. Non-compliance loses coverage.",
    mandated_followups: [
      { step: "Nuchal translucency + first-trimester screen (already covered here — 11-13 weeks)", price_usd: 0 },
      { step: "Anomaly scan (20-22 weeks)", price_usd: 130 },
      { step: "Growth scan (28 weeks)", price_usd: 90 },
      { step: "Third-trimester scan (32-34 weeks)", price_usd: 90 },
      { step: "Term / positioning scan (37+ weeks)", price_usd: 90 },
      { step: "OGTT (gestational diabetes screen, 24-28 weeks)", price_usd: 60 },
      { step: "Antenatal OB visits", cadence: "monthly × 9 total", price_usd: 55, subtotal_usd: 495 },
      { step: "Third-trimester CBC + iron studies", price_usd: 45 },
    ],
    revenue_summary_usd: { pathway_total: 1000, time_horizon_months: 7 },
  },

  tb_screening_flagged: {
    finding: "Chest X-ray suggestive of latent/active TB (flagged on visa medical)",
    insurance_rule:
      "UAE MoH visa-medical protocol: any TB-suggestive chest finding mandates confirmatory workup within 14 days. Visa is provisionally held. Employer bears cost until cleared.",
    mandated_followups: [
      { step: "GeneXpert MTB/RIF PCR test", cadence: "within 7 days", price_usd: 65 },
      { step: "Sputum smear × 3 (AFB microscopy)", cadence: "consecutive days", price_usd: 30, subtotal_usd: 90 },
      { step: "Interferon-gamma release assay (IGRA / QuantiFERON-TB Gold)", price_usd: 90 },
      { step: "High-resolution CT chest (if active TB suspected)", cadence: "within 14 days", price_usd: 240 },
      { step: "Pulmonology consult", price_usd: 110 },
      { step: "Directly-observed therapy (DOT) initiation if active — 6-month course", price_usd: 350, note: "Public sector subsidises, but private-pathway employers cover programme mgmt fees." },
    ],
    revenue_summary_usd: { pathway_total: 945, time_horizon_months: 6 },
  },

  elevated_random_glucose_visa: {
    finding: "Elevated random blood glucose on visa medical (>= 200 mg/dL)",
    insurance_rule:
      "UAE employer-sponsored health plans (Neuron, Nextcare, Al Buhaira) mandate diabetes workup + 12-month care plan whenever a screening glucose is flagged. Non-compliance loses annual renewal eligibility.",
    mandated_followups: [
      { step: "HbA1c", cadence: "within 14 days", price_usd: 30 },
      { step: "Fasting blood glucose + lipid panel", cadence: "within 14 days", price_usd: 45 },
      { step: "Endocrinology consult", cadence: "within 30 days", price_usd: 110 },
      { step: "Dietician referral + 4-session plan", cadence: "within 90 days", price_usd: 55, subtotal_usd: 220 },
      { step: "Annual retinal screen (diabetic retinopathy)", price_usd: 80 },
      { step: "Annual foot check (diabetic neuropathy)", price_usd: 45 },
      { step: "Quarterly HbA1c monitoring", cadence: "× 4 per year", price_usd: 30, subtotal_usd: 120 },
    ],
    revenue_summary_usd: { pathway_total: 650, time_horizon_months: 12 },
  },
};

// ─────────────────────────────────────────────────────────────
// Patient records with priors (Demo 3, tool-backed)
// ─────────────────────────────────────────────────────────────
const PATIENTS = {
  "84421": {
    mrn: "84421",
    name: "Ahmed Al Blooshi",
    dob: "1978-06-14",
    priors: [
      {
        date: "2024-01-12",
        modality: "X-ray",
        body_part: "Right knee",
        finding:
          "Mild degenerative changes in the medial compartment. Joint space preserved. No acute fracture.",
        reader: "Dr. K. Menon",
        care_pathway_key: "degenerative_medial_compartment_early_oa",
      },
      {
        date: "2024-08-03",
        modality: "MRI",
        body_part: "Right knee",
        finding:
          "Small horizontal tear of the posterior horn of the medial meniscus. No ACL involvement. Mild bone marrow oedema at medial femoral condyle.",
        reader: "Dr. S. Rashid",
        care_pathway_key: "medial_meniscal_tear_conservative",
      },
    ],
    notes: [
      {
        date: "2024-09-15",
        author: "Dr. Rashid, Orthopaedic",
        summary:
          "Recommended conservative management for right medial meniscal tear. Physiotherapy 6 weeks. Review at 3 months. No surgical indication at this time.",
      },
    ],
    medications: [
      { drug: "Metformin", started: "2024-06-10", note: "Type 2 diabetes — relevant for iodinated contrast studies." },
      { drug: "Atorvastatin", started: "2023-02-01" },
    ],
    insurance: {
      payer: "Daman Enhanced",
      pre_auth_notes:
        "Meniscal-tear conservative pathway active — insurer will pre-auth follow-up MRI + ortho review at 3 months. Surgical pre-auth requires documented failure of conservative course.",
    },
  },

  "77208": {
    mrn: "77208",
    name: "Fatima Al Hosani",
    dob: "1995-11-22",
    priors: [
      {
        date: "2025-11-04",
        modality: "Ultrasound",
        body_part: "Lower abdomen (obstetric, 12+2 weeks)",
        finding:
          "Single intrauterine pregnancy, gestational age 12+2 weeks, foetal heartbeat present. No anomalies detected.",
        reader: "Dr. R. Thomas",
        care_pathway_key: "first_trimester_obstetric_normal",
      },
    ],
    notes: [
      {
        date: "2025-11-04",
        author: "Dr. Al Marzooqi, Obstetrician",
        summary: "First trimester scan normal. Booked for 20-week anomaly scan.",
      },
    ],
    medications: [{ drug: "Prenatal vitamins", started: "2025-10-01" }],
    insurance: {
      payer: "Dubai Essential Benefits + Enhanced Rider",
      pre_auth_notes:
        "Maternity mandate — 5 antenatal ultrasounds + labs pre-authorised across pregnancy. Non-compliance forfeits post-natal cover.",
    },
  },
};

// ─────────────────────────────────────────────────────────────
// Employer workforce cohort (Demo 4, tool-backed)
// ─────────────────────────────────────────────────────────────
const WORKER_COHORTS = {
  transguard: {
    employer: "Transguard Group",
    period: "This month",
    total_screened: 847,
    cleared: 812,
    pending_results: 28,
    flagged_followup: 7,
    flag_breakdown: {
      tb_screening: 5,
      elevated_blood_glucose: 2,
    },
    first_pass_rate: 0.96,
    average_tat_hours: 43,
    flagged_workers: [
      { id: "TG-24019", flag: "TB screening", status: "Follow-up booked 2026-07-18", care_pathway_key: "tb_screening_flagged" },
      { id: "TG-24022", flag: "TB screening", status: "Message sent, awaiting confirmation", care_pathway_key: "tb_screening_flagged" },
      { id: "TG-24041", flag: "TB screening", status: "Follow-up booked 2026-07-16", care_pathway_key: "tb_screening_flagged" },
      { id: "TG-24055", flag: "TB screening", status: "Message sent, awaiting confirmation", care_pathway_key: "tb_screening_flagged" },
      { id: "TG-24063", flag: "TB screening", status: "Follow-up booked 2026-07-17", care_pathway_key: "tb_screening_flagged" },
      { id: "TG-24071", flag: "Elevated blood glucose", status: "Endocrine referral sent", care_pathway_key: "elevated_random_glucose_visa" },
      { id: "TG-24088", flag: "Elevated blood glucose", status: "Dietician appointment booked", care_pathway_key: "elevated_random_glucose_visa" },
    ],
    downstream_revenue_forecast_usd: {
      tb_pathway_per_worker: 945,
      glucose_pathway_per_worker: 650,
      cohort_total_this_month: 5 * 945 + 2 * 650,
      note: "Every flagged worker triggers an insurance-mandated pathway. This month's 7 flags = ~USD 6,025 of downstream billable revenue on top of the initial screen fees.",
    },
  },
};

// ─────────────────────────────────────────────────────────────
// Appointments (Demo 2, mixed free-form + tool)
// ─────────────────────────────────────────────────────────────
const APPOINTMENTS = {
  demo_visa_medical: {
    centre: "Al Qusais Medical Fitness Centre",
    address: "Al Qusais Industrial Area 2, near Dubai Municipality",
    time: "Today at 2:00 PM",
    documents: ["Passport", "Emirates ID application", "2 passport-size photos"],
    fasting: "4 hours before the appointment; water is allowed",
    transport: "Take the Green Line metro to Al Qusais station, then a 5-minute taxi.",
    result_eta: "Typically within 48 hours; you will be notified here.",
  },
  demo_ultrasound: {
    centre: "Boom Health Diagnostic Centre — Jumeirah",
    address: "Al Wasl Road, opposite Jumeirah Grand Mosque",
    doctor: "Dr. Al Marzooqi",
    time: "Tomorrow at 10:00 AM",
    scan_type: "ultrasound_lower_abdomen",
    result_eta: "Same day, delivered here.",
  },
};

module.exports = { SCAN_PREPS, CARE_PATHWAYS, PATIENTS, WORKER_COHORTS, APPOINTMENTS };
