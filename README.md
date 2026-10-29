# AICTE-TrustNet — SIH26263

APAAR ID-based admissions, sanctioned-intake enforcement, national concurrency
guard, and offline-verifiable Ed25519 credentials for AICTE-approved institutions.

A registrar uploads a CSV/XLSX roster. Every APAAR ID is checksum-verified
(Verhoeff Mod-10), the batch is checked against the national seat ledger, quota
and double-enrollment violations are rejected with machine-readable errors, and
each admitted student receives a signed QR credential that any verifier can
validate offline in the browser.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │  React 18 + Vite + Tailwind  (127.0.0.1:5173) │
                    │  Registrar · Oversight · Public Verifier      │
                    └───────────────┬──────────────────────────────┘
                                    │ axios (JSON / multipart)
                    ┌───────────────▼──────────────────────────────┐
                    │  FastAPI + async SQLAlchemy 2.0 (:8000)      │
                    │  ┌─────────────┐  ┌──────────────────────┐   │
                    │  │ Quota guard │  │ Concurrency guard    │   │
                    │  │ (intake)    │  │ (unique active seat) │   │
                    │  └──────┬──────┘  └──────────┬───────────┘   │
                    │         └────── atomic ─────┘               │
                    │  Verhoeff Mod-10 · Ed25519 signer · QR PNG   │
                    └───────────────┬──────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────────┐
                    │  SQLite (aiosqlite, WAL)                     │
                    │  institutions · student_enrollments · audit  │
                    └──────────────────────────────────────────────┘
```

## Layout

```
aicte-trustnet/
├── backend/
│   ├── app/
│   │   ├── api/          admissions, auth, analytics, mocks
│   │   ├── core/         verhoeff.py, crypto.py
│   │   ├── db/           models.py, session.py, seed.py
│   │   ├── schemas/      Pydantic v2 contracts
│   │   └── main.py       app factory, lifespan seed, CORS
│   ├── seed.py           CLI database reset / reseed
│   ├── test_suite.py     74-check end-to-end verification suite
│   ├── run_backend.py    uvicorn entry point
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/   Sidebar, Topbar, StatCard, CapacityProgress, QRModal,
│       │                 NotificationsDrawer, CommandPalette
│       ├── lib/          api.ts, credential.ts, certificate.ts (jsPDF),
│       │                 auth.tsx + session.ts, official-record.ts,
│       │                 institution.tsx (academic-year + college context)
│       └── pages/        LoginPage, RegistrarPortal, OversightDashboard,
│                         PublicVerifier
├── test_rosters/
│   ├── 01_valid_roster.csv           2 valid students
│   ├── 02_quota_overflow.csv         5 students vs. 2 open seats
│   └── 03_concurrency_collision.csv  1 student already holding a Pune seat
├── setup.bat             one-time install (venv + pip + npm)
├── start_all.bat         starts backend and frontend, opens the browser
├── start_backend.bat
├── start_frontend.bat
└── README.md
```

## Quick start (Windows)

One-time setup, then one command to launch everything:

```bat
setup.bat
start_all.bat
```

| Service | URL |
| --- | --- |
| Sign in | http://localhost:5173/login |
| Registrar portal | http://localhost:5173/registrar |
| Oversight dashboard | http://localhost:5173/oversight |
| Public verifier | http://localhost:5173/verifier |
| Backend API | http://localhost:8000 |
| OpenAPI / Swagger | http://localhost:8000/docs |
| Health + key fingerprint | http://localhost:8000/api/v1/health |

### Demo accounts

| Role | Identifier | Password |
| --- | --- | --- |
| College Registrar (St. Joseph's, TN-1042) | `registrar@sjit.edu.in` | `trustnet` |
| AICTE Apex Regulatory Officer | `apex@aicte.gov.in` | `trustnet` |

The login page exposes both accounts as one-click quick-fill buttons. Registrar
sessions are pinned to their own college; `/registrar`, `/oversight` and
`/verifier` redirect unauthenticated visitors to `/login` and return them to the
requested page after sign-in. Sessions last 12 hours and are stored in
`localStorage`.

### Manual start (any OS)

```bash
# terminal 1
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt    # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
python run_backend.py

# terminal 2
cd frontend
npm install
npm run dev
```

The database and demo ledger are created automatically on first boot. The seed
is idempotent; use **Reset demo** in the UI (or `python backend/seed.py`) to
restore the pristine ledger at any time.

## Demo walkthrough

The seeded ledger: **TN-1042** (St. Joseph's, 60 sanctioned / 58 enrolled) and
**MH-4011** (Pune Engineering, 120 sanctioned / 100 enrolled). APAAR
`234567890124` already holds an active Pune seat — it is the collision target.

1. **Registrar → Valid roster** (`01_valid_roster.csv`)
   HTTP 200. Two students admitted, TN-1042 moves 58 → 60, every row returns
   `qr_code_url` (a standalone base64 PNG) and `payload_summary`. **View badge**
   renders the scannable QR image with a **Download Pass** link; the raw signed
   envelope lives behind an "Inspect signed payload & signature" accordion.
2. **Registrar → Quota overflow** (`02_quota_overflow.csv`)
   HTTP 422 with
   `Sanctioned Intake Exceeded: Upload contains 5 students, but only 2 seats remain for this approved intake.`
   The seat ledger does not move; the rejection is written to the audit stream.
3. **Registrar → Concurrency collision** (`03_concurrency_collision.csv`)
   HTTP 409 with
   `Concurrency Conflict: Active seat collision detected` plus the offending
   APAAR, student name, conflicting institution and reason. The roster is
   rejected atomically — no partial writes.
4. **Oversight** shows prevented-violation counters, seat utilisation, the apex
   public key, and a live audit stream (polled every 6 s).
5. **Verifier** uses a standard data-entry form (APAAR ID, student name,
   institution code, academic year). A signed QR pass, camera scan, QR image
   upload and the apex sample credential also work. Any valid credential renders
   the government-style **Academic Verification Record** with the green
   *"Cryptographically Verified via Ed25519"* badge, an AICTE watermark, the
   student's details, enrolled course and issuance timestamp. **Download Official
   Verification Certificate** produces a formatted A4 PDF with the key
   fingerprint, detached signature, verification statement and QR. A tampered
   payload renders the red *"Tamper / Fraud Detected"* card.

### Workspace interactions

- **Academic year selector** in the header opens a timeline popover with
  2024-2025, 2025-2026 and 2026-2027; every KPI, chart, roster and audit query is
  re-scoped to the chosen cycle.
- **Notification bell** opens a left off-canvas drawer with live ledger alerts:
  intake ≥ 95 %, seat-conflict blocks, quota guards, approved batches and seed
  snapshots. It refreshes every 30 s and immediately after an upload or demo
  reset; dismiss with the X, Escape or an outside click.
- **Search** (`/` or the header search box) opens a centred command palette that
  filters students, APAAR IDs and college codes live, with arrow-key/Enter
  navigation into the registrar roster.
- **Sidebar** collapses to an 84 px icon rail with hover titles and expands back
  to 260 px; the content area follows the transition. Registrar data is strictly
  limited to the signed-in college on both the UI and API layers.

## Guard semantics

| Guard | Trigger | Response | Enforcement |
| --- | --- | --- | --- |
| Verhoeff Mod-10 | Any APAAR fails the dihedral D5 checksum | 422 | Pydantic row validator — one bad row rejects the whole batch |
| Concurrency | APAAR already has an `ACTIVE` seat in the same academic year | 409 | `UNIQUE(apaar_id, academic_year, status)` + pre-flight query |
| Quota | Batch would push `current_enrolled > sanctioned_intake` | 422 | Conditional `UPDATE … WHERE current_enrolled + N <= sanctioned_intake` + DB `CHECK` |

**Order matters:** the concurrency guard runs *before* the quota guard. Identities
are checked first, so a roster containing a student who already holds a seat
elsewhere always reports the more serious 409 conflict — even when the receiving
college is already full. The demo relies on this: after roster 01 fills TN-1042,
roster 03 must still return 409.

All writes in a batch are one transaction. Quota and conflict rejections roll
back the entire upload, and every rejection is persisted to `audit_logs` with
`severity = WARNING` (do not log expected guard rejections as `ERROR`).

## Cryptography

- **APAAR identifiers** are 12 digits; the 12th is a Verhoeff Mod-10 check digit
  generated at seed time (`generate_verhoeff`). Runtime validation message:
  `Invalid APAAR ID checksum (Mod-10 Verhoeff failure)`.
- **Signing payload** is exactly
  `{"apaar": "...", "inst": "...", "yr": "...", "status": "VERIFIED_ACTIVE"}`.
- **Canonical JSON** is `json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
  on the server and a byte-identical recursive `canonicalStringify` in
  `frontend/src/lib/credential.ts`.
- **Ed25519** detached signatures via PyNaCl server-side and `tweetnacl` in the
  browser. The private key is generated on first run at
  `backend/apex_private.key` (override with `TRUSTNET_KEY_PATH`) and is
  gitignored. `GET /api/v1/auth/apex-public-key` publishes the matching public
  key and a SHA-256 key fingerprint.
- **QR codes** encode the full envelope (`payload`, `signature`, `algorithm`,
  `issuer`) as compact JSON into a standalone PNG rendered by `qrcode` + PIL
  (error correction M, 10 px modules, `#0F172A` on white) and returned as a
  `data:image/png;base64,...` URL in `qr_code_url`.

## API reference

Base path: `/api/v1`. Interactive docs at `/docs`.

All data endpoints accept `academic_year=YYYY-YYYY` (default: the active cycle)
and require `Authorization: Bearer <token>` except the public health, credential
lookup, sample-credential, verifier and docs routes. Registrar tokens are scoped
to their own college; requests for another institution return `403`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | status, issuer, key fingerprint |
| POST | `/auth/login` | role + identifier + password → HMAC bearer token (12 h) |
| GET | `/auth/me` | current profile and institution scope |
| GET | `/admissions/institutions` | institutions with live seat counts |
| GET | `/admissions/institutions/{id}` | single institution |
| GET | `/admissions/institutions/{id}/enrollments` | recent signed seats (QR regenerated) |
| POST | `/admissions/batch-upload` | multipart roster ingestion (guards apply) |
| GET | `/admissions/sample-credential` | signed sample for the verifier |
| GET | `/admissions/credential` | enrolment lookup by APAAR / name / institution / year |
| GET | `/admissions/search` | roster search (student, APAAR, college code) |
| GET | `/admissions/summary` | seat totals |
| GET | `/auth/apex-public-key` | Ed25519 public key |
| POST | `/auth/verify-credential` | server-side verification (offline check is preferred) |
| GET | `/analytics/overview` | national KPIs |
| GET | `/analytics/intake` | per-course sanctioned vs. filled |
| GET | `/analytics/audit-logs` | audit stream (filterable) |
| GET | `/mock/digilocker/identity/{apaar_id}` | simulated DigiLocker demographics |
| POST | `/mock/abc/sync-credits` | simulated Academic Bank of Credits anchor |
| POST | `/admin/reset` | reset + reseed (token-protected) |

Sample roster files are also served at `/samples/` by the backend.

## Testing

Start the backend, then:

```bash
cd backend
.venv/Scripts/python test_suite.py    # Windows
# python test_suite.py                # macOS/Linux
```

The suite resets the ledger, then verifies Verhoeff vectors, Ed25519 signing and
tamper rejection, the 200 success path (60/60, signed QR credentials, offline
verification, audit detail), the 422 quota guard, the 409 concurrency guard,
oversight telemetry, mock integrations, quota arithmetic on a fresh ledger, and
database invariants (unique active-seat index, intake check constraint, no
orphan enrollments). It also asserts that every returned `qr_code_url` decodes to
a real PNG (magic bytes `\\x89PNG`), that `payload_summary.apaar` matches the
student, and that authentication, registrar scoping, per-year intake cycles and
the credential lookup/search endpoints behave as specified. Current result:
**74 passed, 0 failed**.

Frontend:

```bash
cd frontend
npm run typecheck
npm run build
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRUSTNET_DATABASE_URL` | `sqlite+aiosqlite:///backend/trustnet.db` | database URL |
| `TRUSTNET_KEY_PATH` | `backend/apex_private.key` | Ed25519 private key |
| `TRUSTNET_ADMIN_TOKEN` | `trustnet-reset` | `/admin/reset` token |
| `TRUSTNET_BASE_URL` | `http://127.0.0.1:8000` | target for `test_suite.py` |
| `VITE_API_BASE` | `http://localhost:8000` | frontend API base |

CORS allows `localhost` and `127.0.0.1` on any port for local development.

## Notes

This is an SIH prototype. DigiLocker and the Academic Bank of Credits are mocked
with deterministic data; the APAAR registry is simulated by the seeded ledger.
The crypto, checksum and concurrency mechanics are real and exercised by the
verification suite.

The interface is a light SaaS workspace (`#F8FAFC` canvas, white cards, indigo
accents, Inter + Plus Jakarta Sans) with a collapsible sidebar (260 px / 84 px)
and a header carrying search, notifications, the academic-year timeline and the
profile menu. The selected academic year and institution are shared by the
Registrar and Oversight pages and persisted in `localStorage`.
