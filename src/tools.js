// Tool definitions + handlers for Voxtr Rad.
//
// Hybrid model:
//   Free-form Claude for scan-prep and appointment questions (still callable via tools).
//   TOOL-BACKED for clinician-facing scenarios: priors, labs, contrast safety, clinic ops.
//
// The critical demo behaviours these tools support:
//   1. Doctor asks for priors → get_patient_priors returns imaging + LABS + clinical pathway
//   2. Doctor orders contrast → check_contrast_safety runs, returns block/OK + alternatives
//   3. Cross-domain flag → get_patient_priors returns lab-correlated pathway (e.g. TB workup)
//   4. Clinic manager asks throughput → get_clinic_dashboard returns ops-only metrics (no pricing)

const {
  SCAN_PREPS,
  CLINICAL_PATHWAYS,
  PATIENTS,
  CLINICS,
  APPOINTMENTS,
} = require("./demoData");

// ─── Tool schemas exposed to Claude ───
const TOOLS = [
  {
    name: "get_scan_prep",
    description:
      "Look up patient prep for a specific scan type. Call when a patient asks how to prepare or what to bring. Returns fasting rules, clothing, bladder requirements, duration.",
    input_schema: {
      type: "object",
      properties: {
        scan_type: {
          type: "string",
          description:
            "Scan identifier. Valid: ultrasound_lower_abdomen, ultrasound_upper_abdomen, visa_medical_chest_xray, mri_knee, mri_lumbar, mri_brain, ct_chest_contrast, ct_chest_no_contrast, mammogram_screening, dexa_scan.",
        },
      },
      required: ["scan_type"],
    },
  },
  {
    name: "get_appointment_details",
    description:
      "Look up an appointment: centre, address, time, documents to bring, fasting, transport. Call whenever a worker or patient asks where to go or what to bring. Demo keys: 'demo_visa_medical' or 'demo_ultrasound'.",
    input_schema: {
      type: "object",
      properties: {
        appointment_key: { type: "string", description: "One of: demo_visa_medical, demo_ultrasound" },
      },
      required: ["appointment_key"],
    },
  },
  {
    name: "get_patient_priors",
    description:
      "Look up a patient's prior imaging, notes, medications, AND recent laboratory results — plus the CLINICAL PATHWAY that each finding triggers. Use whenever a clinician asks for priors, history, labs, or 'what's next' on a patient. Demo MRNs: 84421 (Ahmed Al Blooshi — MSK), 77208 (Fatima Al Hosani — OB), 10241 (Rafiq Khan — visa medical), 10298 (Divya Menon — fatty liver), 10342 (Mohammed Al Shamsi — CONTRAST CONTRAINDICATION), 10391 (Yousef Nasser — spine), 10501 (Hassan Al Nuaimi — TB workup), 10488 (Ines Da Silva — DEXA).",
    input_schema: {
      type: "object",
      properties: {
        mrn: { type: "string", description: "Medical record number." },
        body_part: {
          type: "string",
          description:
            "Optional filter — if provided, only return priors involving this body part (e.g. 'right knee').",
        },
      },
      required: ["mrn"],
    },
  },
  {
    name: "get_patient_labs",
    description:
      "Return a patient's most recent laboratory panel with reference ranges and out-of-range flags. Use when a clinician asks specifically for labs, or before ordering contrast (creatinine check), or when correlating lab values with an imaging finding.",
    input_schema: {
      type: "object",
      properties: {
        mrn: { type: "string", description: "Medical record number." },
      },
      required: ["mrn"],
    },
  },
  {
    name: "check_contrast_safety",
    description:
      "Review a patient's most recent renal labs (creatinine, eGFR) and medication list before iodinated contrast is administered. Returns a decision object: {block: bool, reason, alternatives, also}. Call this WHENEVER contrast is being ordered, mentioned, or discussed for a specific patient. This is the safety gate before an infusion — surface any block prominently to the ordering clinician.",
    input_schema: {
      type: "object",
      properties: {
        mrn: { type: "string", description: "Medical record number." },
      },
      required: ["mrn"],
    },
  },
  {
    name: "get_clinic_dashboard",
    description:
      "Return clinic throughput and workflow metrics: total studies, cleared vs flagged, first-pass AI agreement, TAT, modality mix, priority review queue. No pricing — clinical-ops only. Use when a clinic manager or coordinator asks about throughput, quality metrics, or the review queue.",
    input_schema: {
      type: "object",
      properties: {
        clinic_key: { type: "string", description: "Clinic key. Demo: 'main_clinic'." },
      },
      required: ["clinic_key"],
    },
  },
  {
    name: "get_clinical_pathway",
    description:
      "Look up the clinical follow-up pathway for a specific finding — what happens next clinically. No pricing. Use when a doctor or coordinator asks 'what's next' after a finding.",
    input_schema: {
      type: "object",
      properties: {
        pathway_key: {
          type: "string",
          description:
            "Pathway identifier. Valid: medial_meniscal_tear_conservative, first_trimester_obstetric_normal, visa_medical_cleared, tb_workup_flagged, fatty_liver_metabolic, ct_contrast_contraindicated, lumbar_disc_bulge, dexa_osteoporosis.",
        },
      },
      required: ["pathway_key"],
    },
  },
];

// ─── Handlers ───
function handleGetScanPrep({ scan_type }) {
  const p = SCAN_PREPS[scan_type];
  if (!p) return { error: `Unknown scan type "${scan_type}". Available: ${Object.keys(SCAN_PREPS).join(", ")}` };
  return p;
}

function handleGetAppointmentDetails({ appointment_key }) {
  const a = APPOINTMENTS[appointment_key];
  if (!a) return { error: `No appointment for key "${appointment_key}".` };
  return a;
}

function handleGetPatientPriors({ mrn, body_part }) {
  const p = PATIENTS[mrn];
  if (!p) return { error: `No patient for MRN "${mrn}".` };
  let priors = p.priors;
  if (body_part) {
    const needle = body_part.toLowerCase();
    priors = priors.filter((x) => (x.body_part || "").toLowerCase().includes(needle));
  }
  const priorsWithPathway = priors.map((pr) => ({
    ...pr,
    clinical_pathway: pr.care_pathway_key ? CLINICAL_PATHWAYS[pr.care_pathway_key] : null,
  }));
  return {
    mrn: p.mrn,
    name: p.name,
    dob: p.dob,
    sex: p.sex,
    priors: priorsWithPathway,
    notes: p.notes,
    medications: p.medications,
    labs: p.labs,
  };
}

function handleGetPatientLabs({ mrn }) {
  const p = PATIENTS[mrn];
  if (!p) return { error: `No patient for MRN "${mrn}".` };
  if (!p.labs) return { error: `No lab panel on file for MRN "${mrn}".` };
  return {
    mrn: p.mrn,
    name: p.name,
    panel_date: p.labs.panel_date,
    results: p.labs.results,
    flagged_results: p.labs.results.filter((r) => r.flag),
  };
}

function handleCheckContrastSafety({ mrn }) {
  const p = PATIENTS[mrn];
  if (!p) return { error: `No patient for MRN "${mrn}".` };
  const labs = p.labs && p.labs.results ? p.labs.results : [];
  const cr = labs.find((r) => r.test.toLowerCase() === "creatinine");
  const egfr = labs.find((r) => r.test.toLowerCase() === "egfr");
  const onMetformin = (p.medications || []).some((m) => m.drug && m.drug.toLowerCase() === "metformin");

  const egfrVal = egfr ? egfr.value : null;
  const crVal = cr ? cr.value : null;
  let block = false;
  let reason = null;
  let alternatives = [];
  let also = [];

  if (egfrVal !== null && egfrVal < 30) {
    block = true;
    reason = `eGFR ${egfrVal} mL/min/1.73m² (severe renal impairment) — iodinated contrast strongly contraindicated per KDIGO / ACR.`;
    alternatives = [
      "Non-contrast CT",
      "MRI without gadolinium",
      "Ultrasound if anatomically feasible",
    ];
  } else if (egfrVal !== null && egfrVal < 45) {
    block = true;
    reason = `eGFR ${egfrVal} mL/min/1.73m² (CKD 3b) — iodinated contrast contraindicated without nephro sign-off.`;
    alternatives = [
      "Non-contrast CT (recommended)",
      "MRI with gadobutrol at reduced dose (macrocyclic, safer at this eGFR)",
      "Pre-hydration protocol + N-acetylcysteine + nephrology clearance if contrast is required",
    ];
  } else if (crVal !== null && crVal > 1.5) {
    block = true;
    reason = `Creatinine ${crVal} mg/dL — order recent eGFR before proceeding.`;
    alternatives = [
      "Repeat renal panel to confirm eGFR",
      "Non-contrast CT while awaiting result",
    ];
  } else {
    block = false;
    reason = `Renal function acceptable (Cr ${crVal ?? "?"} · eGFR ${egfrVal ?? "?"}). Contrast may be administered per standard protocol.`;
  }
  if (onMetformin && !block) {
    also.push("Patient on metformin — hold at scan and for 48 hours after contrast; recheck creatinine before restart.");
  }
  if (onMetformin && block) {
    also.push("Patient on metformin — if contrast is later administered, hold metformin at scan and 48h post-contrast.");
  }

  return {
    mrn: p.mrn,
    name: p.name,
    creatinine: crVal,
    egfr: egfrVal,
    on_metformin: onMetformin,
    block,
    reason,
    alternatives,
    also,
  };
}

function handleGetClinicDashboard({ clinic_key }) {
  const c = CLINICS[clinic_key];
  if (!c) return { error: `No clinic for "${clinic_key}".` };
  return c;
}

function handleGetClinicalPathway({ pathway_key }) {
  const p = CLINICAL_PATHWAYS[pathway_key];
  if (!p) return { error: `Unknown pathway "${pathway_key}". Available: ${Object.keys(CLINICAL_PATHWAYS).join(", ")}` };
  return p;
}

const HANDLERS = {
  get_scan_prep: handleGetScanPrep,
  get_appointment_details: handleGetAppointmentDetails,
  get_patient_priors: handleGetPatientPriors,
  get_patient_labs: handleGetPatientLabs,
  check_contrast_safety: handleCheckContrastSafety,
  get_clinic_dashboard: handleGetClinicDashboard,
  get_clinical_pathway: handleGetClinicalPathway,
};

async function runTool(name, input) {
  const h = HANDLERS[name];
  if (!h) return { error: `Unknown tool "${name}".` };
  try {
    return h(input || {});
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { TOOLS, runTool };
