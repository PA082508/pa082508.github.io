# forms/3-library — canonical static library assets

**This is the canonical folder for static library documents (PDF / docx)** — the
Library reorg's document cards resolve their `Open ↗ / download` link + QR from
here via `enroll-registry.json`. (Fillable form-kit forms stay in
`../1-data-sources/`; generated reports in `../2-reports/`.)

## How it works
Each document is registered in `enroll-registry.json` as a `kind:"document"`
record **DARK** (`current:null`) pointing at its file below. A card shows in the
Library with an `○ dark` badge until the file is dropped here and the record is
**flipped** (`current: "v1"`) — same DARK → smoke → flip flow as the forms.

## Drop the files with EXACTLY these names

### `ohio-dcy/` (Library § Ohio DCY)
| Document | Filename |
|---|---|
| DCY 01218 — Basic Infant (Rev. 7/2025)          | `DCY-01218_Basic_Infant_Rev-2025-07.pdf` |
| DCY 01225 — Routine Trip (Rev. 6/2025)          | `DCY-01225_Routine_Trip_Rev-2025-06.pdf` |
| DCY 01226 — Field Trip (Rev. 6/2025)            | `DCY-01226_Field_Trip_Rev-2025-06.pdf` |
| Center Parent Information (Appendix 5101:2-12-07)| `Center_Parent_Information_Appendix_5101-2-12-07.pdf` |
| Family Needs Survey (SUTQ)                      | `Family_Needs_Survey_SUTQ.pdf` |

### `our-documents/` (Library § Our documents)
| Document | Filename | Future form-kit |
|---|---|---|
| Child Release Authorization (+ media consent) | `Child_Release_Authorization.pdf` | ✅ planned |
| Parent Responsibilities                       | `Parent_Responsibilities.pdf` | — |
| Topical Product Consent 2025                   | `Topical_Product_Consent_2025.pdf` | ✅ planned |
| Transition into the Program                    | `Transition_Into_The_Program.pdf` | ✅ planned |
| Building For the Future                        | `Building_For_The_Future.pdf` | — |
| What To Bring (Infant)                         | `What_To_Bring_Infant.pdf` | — |

`docx` is fine too — if a doc is `.docx`, drop it and tell me; I'll point the
record at the `.docx` (browsers download it) or a rendered PDF.

**Future form-kit wave:** Child Release Authorization, Topical Product Consent,
Transition into the Program are signature forms — later re-framed as online
form-kit forms (like the Parent Consent). Flagged `futureFormKit:true` in the
registry so we can find them when that wave starts.
