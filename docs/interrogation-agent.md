# Interviewer agent (door interview)

Per answer: **evidence → hear + record → risk + safety precedence → choose, word, vet → authority gate**.

| Module (`lib/ai/interrogation/`) | Job |
|---|---|
| `llm.ts` | The two model calls: `analyse` (audio/text → case-file entry + proposed move + draft line), `speak` (writes one line for a chosen move) |
| `engine.ts` | `analyseTurn` grounds every claim in the transcript, checks it against evidence silently. `composeQuestion` validates the move, words it, vets it, regenerates or hands over |
| `casefile.ts` | Event-sourced case file from stored turns: commitments ledger, strategy trail, belief state, phase |
| `playbook.ts` | Tactics and the rules for when each is allowed (withhold→commit→check; never press a decline; neutral challenge only for a real central inconsistency) |
| `evidence.ts` | EFM (LS/WS … HS/SS). Household facts are never disclosed or sent to a model. Only visitor-side camera facts may be stated, one at a time |
| `guardrails.ts` | Structural check (exact, data-driven) → independent LLM judge → banned-phrase backstop. Two failed regenerations hand over to a carer |
| `respond.ts` | Deterministic safety precedence (unchanged in spirit). A safety event pre-empts the next question |
| `plan.ts` | Helper-facing coverage checklist only. No question bank, no priority order |

Deliberately not implemented: Scharff's "illusion of knowing everything", false-evidence ploys, minimisation/maximisation, pressing a declined question.
Non-verbal cues (accent, nervousness, hesitation) are never used.
