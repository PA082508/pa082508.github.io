# forms/3-library — canonical static library assets

**Canonical folder for static library documents (PDF / docx / doc).** The Library
reorg's document cards resolve their `Open / download ↗` link + QR from here via
`enroll-registry.json`. (Fillable form-kit forms stay in `../1-data-sources/`,
reports in `../2-reports/`.)

Each document is a `kind:"document"` record in `enroll-registry.json` whose
`versions.v1` points at the file below (spaces URL-encoded). All 11 are **LIVE**
(`current:"v1"`) as of 2026-07-10.

## Current files

### `ohio-dcy/` (Library § Ohio DCY)
| Document | File |
|---|---|
| DCY 01218 — Basic Infant (Rev. 7/2025)          | `Basic Infant 2026 DCY-01218.PDF` |
| DCY 01225 — Routine Trip (Rev. 6/2025)          | `DCY-01225 Routine Trip.PDF` |
| DCY 01226 — Field Trip (Rev. 6/2025)            | `DCY-01226 field trip.PDF` |
| Center Parent Information (Appendix 5101:2-12-07)| `Center Parent Information.docx` |
| Family Needs Survey (SUTQ)                      | `Family_Needs_Survey.pdf` |

### `our-documents/` (Library § Our documents)
| Document | File | Future form-kit |
|---|---|---|
| Child Release Authorization (+ media consent) | `Child Release Authorization.docx` | ✅ planned |
| Parent Responsibilities                       | `Parent Responsibilities.docx` | — |
| Topical Product Consent 2025                   | `Topical Product Consent Form 2025.docx` | ✅ planned |
| Transition into the Program                    | `Transition into the program.docx` | ✅ planned |
| Building For the Future                        | `Building For the Future.docx` | — |
| What To Bring (Infant)                         | `WhatToBringInfant.doc` | — |

## Updating a document
Drop the new file here, then point that record's `versions.v1` at it in **both**
registry copies (`menumaker-app/public/enroll-registry.json` = canonical → `cp`
to the Pages `enroll-registry.json`). URL-encode spaces (` ` → `%20`).

**Future form-kit wave:** Child Release Authorization, Topical Product Consent,
Transition into the Program are signature forms — later re-framed as online
form-kit forms (like Parent Consent). Flagged `futureFormKit:true` in the registry.
