# ADR-070 — Content Intelligence and the Intelligence-to-Content Contract (Phase 3.5A)

Status: **ACCEPTED — architecture frozen, no implementation**
Date: 2026-08-17
Extends ADR-066/067 (memory governance, authority), ADR-069 (Market Intelligence),
and the Phase 3.3C grounding contract. Supersedes nothing.

Scope: **trace, measurement and contract freeze only.** No production content
code, no migration, no publishing, no execution.

---

## 1. The measurement that decides this phase

40 realistic pieces of marketing copy (34 carrying implied factual claims,
6 genuinely creative controls) were run through the **existing production**
grounding primitives — `extractQuantities`, `isMeasuredHistoricalClaim`,
`hasQuantity`, `groundClaims`, `ownerTextBoundary`.

```
DETECTED       0 / 34   (0.0%)
MISSED        34 / 34   (100.0%)
FALSE POSITIVES 0 / 6   (0.0%)
```

Every category was missed completely: numeric 0/4, customer-count 0/3,
social-proof 0/3, superlative 0/3, comparative 0/3, exclusivity 0/2,
security 0/2, compliance 0/2, guarantee 0/2, scarcity 0/2, competitor 0/2,
capability 0/2, pricing 0/2, geography 0/1, first-party 0/1.

**It is a classification failure, not an extraction failure.** Extraction works:
`"LaunchMind increases conversion by 31%"` yields `["pct:31","num:31"]`, and
`"Used by more than 500 SMBs"` yields `["num:500"]`. The claim is then dismissed
because `isMeasuredHistoricalClaim` requires a PAST-TENSE marker from
`HISTORICAL_WORDS`. Recommendation prose says *"conversion increased 31% last
week"*; marketing copy says *"increases conversion by 31%"*. The tense is the
whole difference, and the entire guard hangs off it.

Worse, and specific to copy: because nothing classifies the claim as measured, it
falls to the qualitative branch, where any resolvable handle satisfies it. So
*"The best AI CMO for small teams"* would be published as an **OBSERVATION
supported by "Your primary goal"** — the exact package-wide grounding defect
that Phase 3.3C was created to eliminate, reappearing in a new syntactic shape.

For the non-numeric categories the situation is simpler: **no detector exists at
all.** Superlatives, exclusivity, certifications, guarantees, social proof,
capability, pricing and geography claims carry no quantity, so no current code
path even looks at them.

**Consequence:** 3.5B is `BUILD_COPY_SHAPED_CLAIM_CLASSIFIER`, not
`EXTEND_EXISTING_CLAIM_EXTRACTOR`, and 3.5B ships in **SHADOW**.

## 2. Source of truth — reuse, do not invent

The trace found real, governed tables. They are extended, not replaced:

| Concept | Existing object | Verdict |
|---|---|---|
| Content artifact | `content_assets` (026, 050) | **REUSE**, add workspace scope |
| Content version | `content_versions` (047) — append-only, `REVOKE UPDATE, DELETE` | **REUSE as-is** |
| Owner approval | `asset_approvals` (048) — append-only audit | **REUSE as-is** |
| Publishing record | `publishing_targets` (049) | **QUARANTINE** — see §6 |
| Content strategy | — | **NEW**, minimal (§4) |
| Content brief | — | **NEW**, minimal (§4) |

No `ContentArtifactV1`, no `CreativeGraph`, no `ContentMemory`, no Content
Intelligence database. The discipline of Phases 3.2–3.4 holds.

## 3. Lineage and identity

```
Product → Growth Brain recommendation (REFERENCE, by id)
        → Owner creation intent
        → Content Strategy (VERSIONED)
        → Content Brief    (IMMUTABLE SNAPSHOT per generation)
        → Artifact         (STABLE IDENTITY)
        → Version(s)       (IMMUTABLE)
        → Owner approval   (binds ONE version)
```

**Artifact identity must not depend on mutable evidence.** The evidence a draft
used is recorded in the version snapshot; the evidence's *current* lifecycle is
resolved at read time and rendered as an owner-safe notice — the same two-timeline
split proved in 3.4C. An evidence retraction changes what the owner is told, never
what the artifact is.

## 4. Content Strategy — the thing that stops this being a copywriter

Recommendation → copy is a governed copywriter. The strategy layer is what makes
it an AI CMO. Minimum persisted contract, derived from what the repository can
actually substantiate:

`objective` · `audience` · `angle` · `message_hierarchy[]` · `proof_available[]`
· **`proof_unavailable[]`** · `cta_intent` · `constraints[]`

`proof_unavailable` is the load-bearing field. A strategy that cannot name what it
*cannot* prove will invent it downstream.

Persisted · versioned · owner-visible · owner-editable. Editing strategy starts a
new brief lineage; it never rewrites an existing artifact. Strategy may reference
a Growth Brain recommendation or stand alone (owner-initiated), and **may not
contain unsupported factual assertions** — angle and message are creative;
`proof_available` entries must each resolve to eligible evidence.

## 5. Claim classes

**REQUIRES_EVIDENCE** — quantified performance, customer counts, social proof,
comparative, competitor superiority, capability, pricing, geography, first-party
performance.
**REQUIRES_OWNER_CONFIRMATION** — security posture, compliance/certification,
guarantees, endorsements. LaunchMind cannot verify a SOC 2 report; the owner
asserts it and owns it.
**PROHIBITED_IN_3_5** — scarcity/urgency invented by the model, regulated-vertical
claims (health, finance, employment/income), and any claim of legal approval.

## 6. Approval boundary — the one structural change 3.5B must make

Traced: `content_assets.approved_at` is a **single** field that both records owner
content approval **and** gates `POST /studio/assets/:id/publish`.

That endpoint performs **no external execution** — it inserts a `publishing_targets`
row from client-supplied `platformUrl`/`externalId` and stamps `published_at`. It
is bookkeeping for a publish the owner did elsewhere. Campaign launch, spend and
provider actions gate on `campaigns.approved_at`, which is a **separate** column,
so content approval confers no campaign authority today.

It is nonetheless one field carrying two meanings. **3.5B must split it:**
`content_approved_at` (owner approves this version) and a separate execution
authorization that lives only in 3.6, with a DB constraint and no derived
interpretation between them.

## 7. Frozen boundaries

- **Zero external execution.** No publish, send, launch, spend or provider action
  in 3.5. `publishing_targets` writes are quarantined behind the split above.
- **No learning.** Owner edits and approved content are **not** Marketing Memory
  and not business truth. Edit deltas are retained for 3.7 to learn from *under
  governance* — never automatically.
- **External evidence is reasoning input, never copy source.** Store descriptions,
  competitor taglines and publisher prose in ContextPackageV2 may inform an angle
  and may not be reproduced verbatim. Competitor names permitted only in
  evidence-backed comparative claims.
- **Isolation.** `content_assets` has `founder_id` + `product_id` and **no
  `workspace_id`** — below the 3.3D/E standard. 3.5B adds workspace scope and a
  composite FK, as migration 109 did for recommendations.
- **Injection.** Owner-entered brief fields (`objective`, `message`, `offer`,
  `tone`, `constraints`) are user-controlled prompt input and get the same
  treatment as external evidence: data, never instruction.
- **Structural validity ≠ factual safety ≠ creative quality.** Channel limits are
  deterministic validators. Grounding establishes support. Neither proves the copy
  is persuasive, and no model will be asked to grade its own output.

## 8. Consequences

Accepted: 3.5B ships in SHADOW until copy-shaped claim grounding is measured;
three content types only (Google Ads, Meta Ads, landing page); a new classifier
must be built rather than extended.

Rejected: treating the 0/34 baseline as a tuning problem; a parallel content
grounding stack; content approval implying any execution authority.
