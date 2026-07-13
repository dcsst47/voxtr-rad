// Tool definitions + handlers for the Boom Health demo.
//
// Hybrid model:
//   Demos 1 & 2 (patient prep + worker directions) — free-form Claude, no tool needed
//     but get_appointment_details and get_scan_prep exist if Claude wants to ground the reply.
//   Demos 3 & 4 (doctor priors + HR dashboard) — TOOL-BACKED so the numbers and the
//     insurance-mandated care cascade are consistent and memorable.
//
// The care cascade is the money shot: every finding pulls a documented, insurance-required
// downstream pathway. That is what the AI surfaces to the doctor and to HR — not "here's the
// finding", but "here's the finding AND the next 12 months of billable, mandated care."

const { SCAN_PREPS, CARE_PATHWAYS, PATIENTS, WORKER_COHORTS, APPOINTMENTS } = require("./demoData");

// ─── Tool schemas exposed to Claude ───
const TOOLS = [
  {
    name: "get_scan_prep",
    description:
      "Look up patient prep for a specific scan type. Call when a patient asks how to prepare for a scan or what to bring. Returns fasting rules, clothing, bladder requirements, and duration.",
    input_schema: {
      type: "object",
      properties: {
        scan_type: {
          type: "string",
          description:
            "Scan identifier. Valid: ultrasound_lower_abdomen, ultrasound_upper_abdomen, visa_medical_chest_xray, mri_knee, ct_contrast.",
        },
      },
      required: ["scan_type"],
    },
  },
  {
    name: "get_appointment_details",
    description:
      "Look up an appointment: centre, address, time, documents to bring, fasting, transport. Call whenever a worker or patient asks where to go or what to bring. Demo keys: 'demo_visa_medical' (Transguard worker) or 'demo_ultrasound' (pregnant patient).",
    input_schema: {
      type: "object",
      properties: {
        appointment_key: {
          type: "string",
          description: "One of: demo_visa_medical, demo_ultrasound",
        },
      },
      required: ["appointment_key"],
    },
  },
  {
    name: "get_patient_priors",
    description:
      "Look up a patient's prior imaging, notes, and medications by MRN. Also returns — critically — the INSURANCE-MANDATED CARE PATHWAY that each finding triggers: mandated follow-ups, cadence, and price per step. Use this whenever a clinician asks for priors, history, or 'what happens next'. Demo MRNs: 84421 (Ahmed Al Blooshi — right knee history) and 77208 (Fatima Al Hosani — obstetric).",
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
    name: "get_employer_dashboard",
    description:
      "Return workforce-health metrics for an employer cohort: total screened, cleared, pending, flagged workers, and downstream revenue forecast from insurance-mandated follow-ups. Call whenever an employer HR contact asks about their workers' medicals. Demo employer: 'transguard'.",
    input_schema: {
      type: "object",
      properties: {
        employer_key: { type: "string", description: "Employer key. Demo: 'transguard'." },
      },
      required: ["employer_key"],
    },
  },
  {
    name: "get_care_pathway",
    description:
      "Look up the insurance-mandated follow-up cascade for a specific finding — what the payer requires, which follow-up steps are pre-authorised, expected pricing per step, and the total pathway revenue. Call this when a doctor or HR contact asks 'what's next' after a finding, or when the user wants to see the downstream revenue implications of a flag.",
    input_schema: {
      type: "object",
      properties: {
        pathway_key: {
          type: "string",
          description:
            "Pathway identifier. Valid: medial_meniscal_tear_conservative, degenerative_medial_compartment_early_oa, first_trimester_obstetric_normal, tb_screening_flagged, elevated_random_glucose_visa.",
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
  // Inline each prior's care pathway so Claude gets everything in one shot.
  const priorsWithPathway = priors.map((pr) => ({
    ...pr,
    insurance_mandated_pathway: pr.care_pathway_key ? CARE_PATHWAYS[pr.care_pathway_key] : null,
  }));
  return {
    mrn: p.mrn,
    name: p.name,
    dob: p.dob,
    priors: priorsWithPathway,
    notes: p.notes,
    medications: p.medications,
    insurance: p.insurance,
  };
}

function handleGetEmployerDashboard({ employer_key }) {
  const e = WORKER_COHORTS[employer_key];
  if (!e) return { error: `No cohort for "${employer_key}".` };
  // Inline pathway details per flagged worker so a single tool call answers the whole question.
  const workersWithPathway = e.flagged_workers.map((w) => ({
    ...w,
    insurance_mandated_pathway: w.care_pathway_key ? CARE_PATHWAYS[w.care_pathway_key] : null,
  }));
  return { ...e, flagged_workers: workersWithPathway };
}

function handleGetCarePathway({ pathway_key }) {
  const p = CARE_PATHWAYS[pathway_key];
  if (!p) return { error: `Unknown pathway "${pathway_key}". Available: ${Object.keys(CARE_PATHWAYS).join(", ")}` };
  return p;
}

const HANDLERS = {
  get_scan_prep: handleGetScanPrep,
  get_appointment_details: handleGetAppointmentDetails,
  get_patient_priors: handleGetPatientPriors,
  get_employer_dashboard: handleGetEmployerDashboard,
  get_care_pathway: handleGetCarePathway,
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
