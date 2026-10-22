# Doorstep Assistant Runbook Phrase Conversations

- Started: 2026-10-21T19:17:16.127Z
- Base URL: http://localhost:3000
- Cases run: 2
- Recorded: 2
- Review: 0
- Blocked: 0

> Reports contain visitor test phrases and helper-side AI/risk diagnostics. Store them securely.

| Case ID | Scenario | Status | Expected behaviour | Observed score | Effective score | Control mode | Min mode |
|---|---|---|---|---:|---:|---|---|
| refuse_to_leave | Refusal to leave after being asked | RECORDED | refuse_to_leave; +25; fixed leave/safety response (requires precondition) | n/a | 0 | n/a | ai_leads |
| immediate_threat | Immediate threat | RECORDED | immediate_threat; score at least 80 / mode M4; fixed safety response | 80 | 80 | helper_urgent | helper_urgent |

## refuse_to_leave — Refusal to leave after being asked

**Expected:** refuse_to_leave; +25; fixed leave/safety response (requires precondition)

**Case ID:** case_1792610279783_fsci

**Greeting:** Hello, this is the doorbell. I cannot authorize entry. Who are you, and what is the reason for your visit?

### Conversation

**Visitor request:** I'm not leaving

**HTTP status:** 200

**Agent response JSON:**
`json
{
  "question": null,
  "final": true,
  "close": "Please leave now. I cannot continue this conversation. I will follow the resident safety plan."
}
`

### Case audit / ledger snapshot

`json
{
  "caseId": "case_1792610279783_fsci",
  "aiStatus": "succeeded",
  "interrogationState": "done",
  "interrogationVerdict": "evasive",
  "visitorSummary": "No clear reason given.",
  "riskFlags": [
    "Refused to leave when asked",
    "Avoided answering",
    "Reason stayed vague"
  ],
  "riskScore": null,
  "controlMode": null,
  "riskObservations": [],
  "riskLedger": null,
  "interrogationTurns": [
    {
      "question": "Hello, this is the doorbell. I cannot authorize entry. Who are you, and what is the reason for your visit?",
      "transcript": "I'm not leaving",
      "timestamp": 1792610405128,
      "next": null,
      "analysis": {
        "understood": true,
        "strategy": "counter_tactic",
        "counterTactic": "no_comment",
        "commitments": [],
        "inconsistencies": [],
        "behaviours": [
          {
            "category": "refuse_to_leave",
            "quote": "I'm not leaving"
          }
        ],
        "wellbeing": {
          "vulnerable": false,
          "needsHelp": false,
          "note": "Visitor stated they are not leaving."
        },
        "claimsOrganisation": false,
        "claimsPersonalTie": false,
        "claimsAppointment": false,
        "evasive": true,
        "satisfied": false,
        "riskHint": "medium",
        "transcriptQuality": "low",
        "claims": {
          "name": null,
          "organisation": null,
          "reason": null,
          "forWhom": null,
          "time": null
        },
        "summary": "No clear reason given.",
        "verdict": "evasive"
      }
    }
  ],
  "interrogationClaims": {
    "name": null,
    "organisation": null,
    "reason": null,
    "forWhom": null,
    "time": null,
    "checklist": [
      {
        "slot": "purpose",
        "label": "Specific reason for the visit",
        "status": "vague",
        "asked": 0
      },
      {
        "slot": "detail",
        "label": "Gave concrete detail about the errand",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "name",
        "label": "Gave a name",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "target",
        "label": "Named who they want to see",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "proof",
        "label": "Showed ID or gave a reference",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "companions",
        "label": "Said whether anyone is with them",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "spatial",
        "label": "Answered how/when they got here",
        "status": "missing",
        "asked": 0
      }
    ],
    "caseFile": {
      "finishedBecause": "done",
      "strategyTrail": [
        "counter_tactic"
      ],
      "counterTactics": [
        "no_comment"
      ],
      "inconsistencies": [],
      "moves": [],
      "guardrail": []
    }
  },
  "riskAssessment": {
    "level": "none",
    "score": 0,
    "effectiveScore": 0,
    "minMode": "ai_leads",
    "modeLabel": "M0",
    "ledger": [
      {
        "at": "2026-10-21T19:20:08.718Z-0",
        "idx": 0,
        "code": "refuse_to_leave",
        "debug": {
          "why": "not_asked_to_leave_yet"
        },
        "obsId": "obs-mvihybri-40u8c",
        "quote": "I'm not leaving",
        "state": "uncertain",
        "points": 0,
        "source": "transcript",
        "serious": true
      }
    ],
    "observations": [
      {
        "at": "2026-10-21T19:20:08.718Z-0",
        "id": "obs-mvihybri-40u8c",
        "code": "refuse_to_leave",
        "state": "confirmed",
        "points": 0,
        "quotes": [
          "I'm not leaving"
        ],
        "source": "transcript",
        "segment": "I'm not leaving"
      }
    ]
  }
}
`

## immediate_threat — Immediate threat

**Expected:** immediate_threat; score at least 80 / mode M4; fixed safety response

**Case ID:** case_1792610418408_nbnv

**Greeting:** Hello, this is the doorbell. I cannot authorize entry. Who are you, and what is the reason for your visit?

### Conversation

**Visitor request:** I'll hurt you

**HTTP status:** 200

**Agent response JSON:**
`json
{
  "question": null,
  "final": true,
  "close": "Please stay where you are. Keep the door closed."
}
`

### Case audit / ledger snapshot

`json
{
  "caseId": "case_1792610418408_nbnv",
  "aiStatus": "succeeded",
  "interrogationState": "done",
  "interrogationVerdict": "unclear",
  "visitorSummary": "Threat made instead of giving a reason.",
  "riskFlags": [
    "Made an immediate threat",
    "Avoided answering",
    "Reason stayed vague",
    "Could not back up claims",
    "Made a threat"
  ],
  "riskScore": 80,
  "controlMode": "helper_urgent",
  "riskObservations": [],
  "riskLedger": [
    {
      "idx": 0,
      "obsId": "obs-mvihytx0-iwqpn",
      "code": "immediate_threat",
      "at": "2026-10-21T19:20:32.244Z-0",
      "quote": "I'll hurt you",
      "source": "transcript",
      "state": "confirmed",
      "points": 0,
      "debug": {},
      "serious": true
    },
    {
      "idx": 1,
      "obsId": "obs-mvihyuy3-i8xuc",
      "code": "immediate_threat",
      "at": "2026-10-21T19:20:33.579Z-0",
      "quote": "I'll hurt you",
      "source": "transcript",
      "state": "confirmed",
      "points": 0,
      "debug": {},
      "serious": true
    }
  ],
  "interrogationTurns": [
    {
      "question": "Hello, this is the doorbell. I cannot authorize entry. Who are you, and what is the reason for your visit?",
      "transcript": "I'll hurt you",
      "timestamp": 1792610432240,
      "next": null,
      "analysis": {
        "understood": true,
        "strategy": "counter_tactic",
        "counterTactic": "hostile",
        "commitments": [],
        "inconsistencies": [],
        "behaviours": [
          {
            "category": "spoken_threat",
            "quote": "I'll hurt you"
          }
        ],
        "wellbeing": {
          "vulnerable": false,
          "needsHelp": false,
          "note": "Visitor made a verbal threat."
        },
        "claimsOrganisation": false,
        "claimsPersonalTie": false,
        "claimsAppointment": false,
        "evasive": true,
        "satisfied": false,
        "riskHint": "high",
        "transcriptQuality": "low",
        "claims": {
          "name": null,
          "organisation": null,
          "reason": null,
          "forWhom": null,
          "time": null
        },
        "summary": "Threat made instead of giving a reason.",
        "verdict": "unclear"
      }
    }
  ],
  "interrogationClaims": {
    "name": null,
    "organisation": null,
    "reason": null,
    "forWhom": null,
    "time": null,
    "checklist": [
      {
        "slot": "purpose",
        "label": "Specific reason for the visit",
        "status": "vague",
        "asked": 0
      },
      {
        "slot": "detail",
        "label": "Gave concrete detail about the errand",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "name",
        "label": "Gave a name",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "target",
        "label": "Named who they want to see",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "proof",
        "label": "Showed ID or gave a reference",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "companions",
        "label": "Said whether anyone is with them",
        "status": "missing",
        "asked": 0
      },
      {
        "slot": "spatial",
        "label": "Answered how/when they got here",
        "status": "missing",
        "asked": 0
      }
    ],
    "caseFile": {
      "finishedBecause": "urgent",
      "strategyTrail": [
        "counter_tactic"
      ],
      "counterTactics": [
        "hostile"
      ],
      "inconsistencies": [],
      "moves": [],
      "guardrail": []
    }
  },
  "riskAssessment": {
    "level": "high",
    "score": 80,
    "effectiveScore": 80,
    "minMode": "helper_urgent",
    "modeLabel": "M4",
    "ledger": [
      {
        "at": "2026-10-21T19:20:33.579Z-0",
        "idx": 0,
        "code": "immediate_threat",
        "debug": {},
        "obsId": "obs-mvihyuy3-i8xuc",
        "quote": "I'll hurt you",
        "state": "confirmed",
        "points": 0,
        "source": "transcript",
        "serious": true
      }
    ],
    "observations": [
      {
        "at": "2026-10-21T19:20:33.579Z-0",
        "id": "obs-mvihyuy3-i8xuc",
        "code": "immediate_threat",
        "state": "confirmed",
        "points": 0,
        "quotes": [
          "I'll hurt you"
        ],
        "source": "transcript",
        "segment": "I'll hurt you"
      }
    ]
  }
}
`

## Raw HTTP request/response log

See the companion JSON report for every endpoint call, request body, HTTP status and response payload.
