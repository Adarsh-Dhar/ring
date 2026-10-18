# Section 12 calibration fixtures

Each file in this directory is a JSON object describing one transcript or clip
and its expected behaviour codes.

## Format

```json
{
  "id": "unique-fixture-id",
  "description": "Short description of what this tests",
  "transcript": "Full transcript text as a single string",
  "interviewState": {
    "respondingAt":    "ISO-8601 or null",
    "rulesExplainedAt": "ISO-8601 or null",
    "boundaryStatedAt": "ISO-8601 or null",
    "askedToLeaveAt":  "ISO-8601 or null",
    "entryDeniedAt":   "ISO-8601 or null"
  },
  "expectedCodes": ["credential_request", "refuse_to_leave"],
  "notExpected":   ["pressure_after_rule"],
  "synthetic": true
}
```

`synthetic: true` means the fixture was written by hand, not from real or role-played data.
Real calibration requires labelled transcripts from field or role-play sessions (section 12 of the spec).

## Status

**PILOT** — all fixtures are synthetic. Weights are not yet calibrated.
Supply labelled real transcripts and re-run `npm run calibrate` to update.
