# Face Data Privacy Policy

This document describes how the doorbell-helper application collects, stores, uses, and deletes biometric face data. **Read this before enabling face recognition.**

---

## 1. What data is collected

When a guardian enrolls a visitor's face (via `POST /api/face` with `action: 'enroll'`, or when a regular-visitor registration is approved), the system:

- Runs face detection on the uploaded photo using an on-device ML model.
- Extracts a **128-dimensional numeric descriptor** (a compact mathematical representation of facial geometry).
- **Discards the original photo** — it is never stored to disk or database.
- Stores only the 128 numbers, AES-256-GCM encrypted with `TOKEN_ENC_KEY`, in the `GuestFace` database table.

For pending regular-visitor registrations, a temporary encrypted thumbnail (`photoEnc`) is kept in the `RegularVisitor` row so the approver can identify the person. This thumbnail is erased immediately when any decision is made (approved, declined, expired, or cancelled).

When the door camera captures a video frame, the system:

- Compares the extracted descriptor against enrolled guests.
- Stores a **sighting record** in `FaceSighting` (timestamp, bounding box, match result — no image, no raw descriptor unless `FACE_STORE_DESCRIPTORS=1`).

---

## 2. Legal basis and consent

Biometric face data is **sensitive personal data** under India's Digital Personal Data Protection Act 2023 (DPDP), the EU General Data Protection Regulation (GDPR), and many other frameworks.

**Before enrolling any face you must:**

1. Obtain the data subject's **explicit, informed, written consent** for this specific purpose.
2. Tell them what data is collected, how it is used, how long it is kept, and how they can withdraw consent and request deletion.
3. Keep a record of when consent was given (the `consentAt` timestamp in `GuestFace` and `RegularVisitor` serves this purpose).

The API enforces `consent: true` in every enrolment call — the server **rejects** any enrolment request that omits this flag. This is a technical safeguard, not a substitute for genuine informed consent from the person whose face is being enrolled.

---

## 3. How data is used

- The 128-number descriptor is compared by Euclidean distance against other enrolled descriptors when the door camera captures a frame.
- A match result is shown to the on-call helper as **supporting evidence only** — it does not open the door, skip the helper step, or bypass any other safety check.
- Sighting records are used to show helpers which known visitors appeared on camera.

---

## 4. Retention and automatic deletion

| Data | Retention | Deletion trigger |
|---|---|---|
| Guest face descriptors (approved regular visitors with `reg:*` ref) | `FACE_RETENTION_DAYS` after the registration ref is closed | Automatic daily purge by `purgeOldEnrollments()` |
| Manually enrolled faces (no `reg:` ref) | Until explicit deletion | Guardian deletes via the app |
| Pending-registration photo thumbnails | Until decision | Erased immediately on approve / decline / expire / cancel |
| Face sighting records | `FACE_RETENTION_DAYS` (default 30 days) | Automatic hourly purge in `purgeOldSightings()` |

The daily timer in `store.ts` calls `purgeOldEnrollments()`, which deletes `GuestFace` rows with a `reg:*` ref that were created more than `FACE_RETENTION_DAYS` days ago. Manually-enrolled faces (direct guardian enrolment without a visitor registration) are **not** auto-deleted and must be removed by the guardian via the app.

---

## 5. Subject rights

Every data subject has the right to:

- **Access**: request to know what biometric data is held about them.
- **Correction**: delete and re-enrol with a better image.
- **Deletion**: request immediate erasure of all data about them.
- **Withdraw consent**: revoke permission at any time; the guardian must then delete the face via the app.

To exercise these rights, the subject should contact the household guardian. The guardian can:

- List enrolled faces: `GET /api/face`
- Delete a specific face: `POST /api/face { action: 'delete', id: '<id>' }`
- Delete all faces for a visitor: `POST /api/face { action: 'delete', ref: 'reg:<regularVisitorId>' }`

---

## 6. Security measures

- Descriptors are encrypted at rest using AES-256-GCM (`TOKEN_ENC_KEY`). Without the key the numbers are unreadable.
- No photo is stored anywhere in the system after processing.
- All face API calls require a valid guardian or helper session and are rate-limited.
- The database is accessible only from within the Docker Compose network (port not published externally).
- Backups should be encrypted and access-controlled at the same level as the live database.

---

## 7. Operator obligations

If you deploy this application you are the **data controller** for the face data it holds. You are responsible for:

- Publishing a privacy notice to all visitors whose faces may be enrolled or captured.
- Maintaining records of consent.
- Responding to data-subject requests within the timeframes required by your jurisdiction.
- Ensuring that the database, backups, and encryption keys are stored securely.
- Registering with your data-protection authority if required by local law (e.g., DPDP consent-manager requirements in India, Article 30 records under GDPR).

**This application provides the technical mechanisms described in this document. Legal compliance obligations rest entirely with the operator.**

---

## 8. Configuration reference

| Variable | Default | Description |
|---|---|---|
| `FACE_ENABLED` | `1` | Set to `0` to disable face recognition entirely. |
| `FACE_RETENTION_DAYS` | `30` | Days after which sightings and closed-registration descriptors are purged. |
| `FACE_STORE_DESCRIPTORS` | `1` | Set to `0` to avoid storing raw descriptors in sighting records. |
| `FACE_AUTO` | `1` | Set to `0` to stop the camera from scanning frames automatically. |
| `FACE_MATCH_THRESHOLD` | `0.5` | Euclidean distance threshold. Lower = stricter matching. |
