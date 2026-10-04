# face/ , face recognition

Everything about face recognition lives in this folder. The rest of the app only imports from `@/face`
(or calls `POST /api/face`). `app/api/face/route.ts` is a 3-line file that exposes `route.ts` from here,
because Next.js needs routes under `/app`.

## Use it from code
```ts
import { enrollFace, matchFace, deleteGuest } from '@/face'

await enrollFace(householdId, { name: 'Dr. Shah', image: jpegBufferOrBase64, consent: true, ref: expectedVisitId })

const r = await matchFace(householdId, snapshotJpeg, { ref: expectedVisitId })   // 1:1 check, safest
// r = { faces, matched, reason: 'match'|'no_face'|'no_enrolled'|'too_far'|'ambiguous', guest?, distance?, strength? }

await deleteGuest(householdId, { ref: expectedVisitId })   // when a visit is deleted or the guest asks
```

## Use it over HTTP (guardian or helper session)
| Call | Who | Body |
|---|---|---|
| `GET /api/face` | guardian, helper | , (lists saved guests + status, no biometric data) |
| `POST /api/face` | guardian | `{action:'enroll', name, image, consent:true, ref?}` |
| `POST /api/face` | guardian, helper | `{action:'match', image, ref?, name?}` |
| `POST /api/face` | guardian | `{action:'delete', id}` or `{action:'delete', name?, ref?}` |

`image` = base64 or data URL, JPEG/PNG/WebP, up to `FACE_MAX_IMAGE_BYTES` (4 MB).

## Files
- `index.ts` public functions (enroll, match, list, delete)
- `engine.ts` the only file that touches the ML libraries (lazy-loaded, one image at a time)
- `store.ts` Prisma storage (table `GuestFace`), encrypted with `TOKEN_ENC_KEY`; swap with `setFaceStore()`
- `route.ts` HTTP handlers, auth, rate limits
- `config.ts` thresholds, limits, env names. `math.ts`, `types.ts`

## Models
`@vladmandic/face-api` (MIT) with its bundled models: SSD MobileNet v1 (detect), 68-point landmarks, ResNet
descriptors (128 numbers). They run on the WASM backend, so there is no native build. About 1 s per image on a laptop CPU.
Check the model licences before commercial use.

## Rules built in
- Consent is required to enrol. Only the 128 numbers are stored, never the photo.
- Enrol needs exactly one clear face. Matching uses the largest face in view.
- Distance above `FACE_MATCH_THRESHOLD` (0.5) is no match. Two guests that are almost equally close give `ambiguous`, not a guess.
- Every query is scoped to the household. Rate limited. A short queue, then `busy`.
- **A match is evidence, not permission.** Do not let it open a door on its own: keep the pass-word or helper step.
- Faces can be fooled by a photo of the person and can be wrong in poor light. Tune the threshold on your own photos.

## After pulling this in
`npm install` then `npx prisma db push` (new table `GuestFace`).
