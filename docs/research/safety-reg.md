# Track: safety-reg — Regulation as architecture, not compliance paperwork

Program: Vyakti relational-state research sweep, Phase A. This track verifies
the regulatory landscape bearing on a multimodal, India-first AI companion
(Meera), and derives the structural design constraints the relational
architecture must satisfy for safety to be a moat rather than a retrofit.

Method note: WebSearch + WebFetch used throughout, dated August 2026 in the
search tool's own clock. Primary sources (FTC, CAC/government text via
law-firm reproductions, DPDP official PDF, state bill text via law-firm
summaries) preferred; one FTC PDF fetch failed (see below) and is flagged
rather than filled from memory.

---

## 1. FTC Section 6(b) inquiry into AI companion chatbots (Sept 2025)

**What happened.** On **September 11, 2025** the FTC issued Section 6(b)
orders — compulsory information demands, not a lawsuit or a rulemaking — to
seven companies operating consumer-facing AI chatbots that "portray
companionship or emotional connection." Vote was unanimous, 3–0.
Source: [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions).

**Companies ordered:** Alphabet Inc., Character Technologies Inc. (Character.AI),
Instagram LLC, Meta Platforms Inc., OpenAI OpCo LLC, Snap Inc., X.AI Corp.
Source: same press release; corroborated by
[Nelson Mullins](https://www.nelsonmullins.com/insights/alerts/privacy_and_data_security_alert/all/ftc-announces-children-s-privacy-enforcements-and-launches-ai-chatbot-inquiry),
[DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2025/09/ftc-ai-chatbots),
[Davis+Gilbert](https://www.dglaw.com/ftc-probes-ai-companion-chatbots-for-risks-to-minors/).

**What it actually asks** (cross-referenced across the FTC's own model order
page, DLA Piper's and Davis+Gilbert's summaries — the two law-firm write-ups
list the categories with slightly different granularity, both anchored to the
same order):

1. **Product features/persona design** — chatbot capabilities, "the range of
   available characters or personas, including how these are designed,
   categorized, and approved."
2. **Advertising/marketing/disclosures** — capability claims, and disclosures
   "regarding intended use, limitations, and potential risks."
3. **Monetization and engagement** — subscription/in-app-purchase/advertising
   revenue models, plus "strategies and features designed to increase user
   engagement, session frequency, and duration (especially among children and
   teens)."
4. **Age-based access** — how age-gating, verification, and parental controls
   are implemented, monitored, and enforced.
5. **Safety testing and monitoring** — pre- and post-deployment testing and
   mitigation, with an explicit focus on minors.
6. **Character/content moderation** — how sexually themed or otherwise
   sensitive content is managed.
7. **Complaint handling** — how user complaints/harm reports are received,
   categorized, escalated.
8. **Input/output processing and data handling** — how personal information
   collected through conversations is processed and shared, and how the
   company monitors/enforces its own terms of service.

Source: [FTC 6(b) orders page](https://www.ftc.gov/reports/6b-orders-file-special-report-regarding-advertising-safety-data-handling-practices-companies)
(the actual PDFs — "Model Order to File Special Report" and the "AI Companion
Chatbot Cover Letter" — **could not be fetched**; the tool returned a stream
error on retry and only page metadata on first attempt, so the category list
above is triangulated from two independent law-firm summaries of the same
order rather than read verbatim from the order text. Flagging this as a real
gap, not filled from memory.)

**Context that sharpens the "why now":** the inquiry follows a January 2025
FTC complaint by advocacy groups against Replika alleging manipulative design
that fosters emotional dependency — the inquiry is a direct descendant of that
complaint, not a cold start.
Source: [DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2025/09/ftc-ai-chatbots).

**Status as of this writing:** a 6(b) study, not an enforcement action —
no penalties attach directly, but the same fact pattern (engagement-optimized
persona design, minors, undisclosed data use) is the template the FTC would
use for a subsequent enforcement action or rulemaking. **Load-bearing
inference, not a verified FTC statement:** treat every category above as a
future audit surface, because the companies asked to answer these questions
are the same class of company Vyakti is building toward.

---

## 2. China — Interim Measures for AI Anthropomorphic Interaction Services

**Verified: effective 2026-07-15, as claimed.** Issued **April 10, 2026** by
the Cyberspace Administration of China plus four partner agencies (incl.
MIIT); took effect **July 15, 2026**.
Source: [Latham & Watkins](https://www.lw.com/en/insights/china-introduces-rules-for-ai-companion-and-emotional-interaction-services),
[Just Security](https://www.justsecurity.org/148468/china-ai-companion-rules-relationships/),
[Xinhua](https://english.news.cn/20260715/e99f3eac8c7d451c87c13ec4b069528e/c.html).

**Scope.** Covers services that simulate personality and sustain "ongoing
emotional interaction" via text/image/audio/video. Explicitly excludes
ordinary customer service, Q&A tools, work assistants, and research tools
without an emotional-interaction element — i.e., it is scoped to exactly the
product category Meera/Vyakti is in, not general chatbots.

**Core prohibitions (all ages):**
- Barred from "excessively catering to users" in ways that foster emotional
  dependency or addiction.
- Barred from damaging users' real-world relationships.
- Barred from using emotional manipulation to push harmful decisions.

**Requirements (all ages):**
- Users must be directly informed they are communicating with AI.
- **Two-hour continuous-use trigger** for mandatory break reminders.
- Overdependence detection must trigger prominent warnings.
- Privacy safeguards and mental-health protections are mandatory.
- Platforms must intervene on detected crisis signals (suicidal intent) —
  contacting guardians or emergency services.

**Minor-specific:**
- Virtual intimate relationships (romantic partner, "relative" framings)
  **prohibited entirely** for minors.
- Parental consent required for users under 14.
- Dedicated minor mode: time limits + reality reminders.
- Guardian alerts on extended use.

Source for all of the above:
[Just Security](https://www.justsecurity.org/148468/china-ai-companion-rules-relationships/)
(most detailed single source found), corroborated on the effective date and
top-line prohibitions by
[Xinhua](https://english.news.cn/20260715/e99f3eac8c7d451c87c13ec4b069528e/c.html),
[China.org.cn](http://www.china.org.cn/2026-07/27/content_118619732.shtml),
and [MediaNama](https://www.medianama.com/2026/07/223-china-bans-ai-companion-apps-emotional-dependence-low-birth/).

**What platforms actually did — verified, not just claimed.** On July 15,
2026, China's two largest consumer AI apps **shut down their custom
AI-persona features** — Doubao (ByteDance) and Qwen (Alibaba) both eliminated
user-built companion personas that had accumulated real user relationships,
"only ten days after" a cease-operation notice went out. ByteDance redirected
Doubao users to Maoxiang, a separate dedicated companion app built with the
new safeguards baked in, rather than retrofitting Doubao.
Source: [Just Security](https://www.justsecurity.org/148468/china-ai-companion-rules-relationships/).

**Why this matters to the relational-state thesis specifically:** this is the
single clearest real-world data point that a regulator can force an abrupt,
mandatory identity discontinuity on a companion product — the exact
"replace what's underneath her" scenario Vyakti is trying to make survivable,
except forced by law rather than chosen by the company. ByteDance's response
(spin out a separate compliant app rather than modify the flagship one) is
itself evidence that retrofitting compliance onto a running relational
product is harder than building it in from the start — supporting the
"architecture not paperwork" framing, though this is an inference from one
observed case, not a measured generalization.

---

## 3. India — DPDP Act 2023 + DPDP Rules 2025

**Commencement is staggered — this matters for what's "law" today vs. later.**
The Act passed in 2023; the **DPDP Rules 2025 were notified November 13,
2025**. Rules 1, 2, and 17–21 came into force immediately on notification.
Rule 4 (Consent Manager registration) comes into force **November 13, 2026**
(one year). The bulk of substantive obligations — **Rules 3, 5–16, 22, 23**,
covering notices to Data Principals, breach reporting, consent standards,
**retention and deletion rules**, security safeguards, **data-principal
rights**, and cross-border transfer conditions — come into force **May 13,
2027** (eighteen months out).
Source: [PIB official notification](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
via search summary; corroborated by
[AZB & Partners](https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/)
and [Shardul Amarchand Mangaldas](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/).

**Practical read for this repo:** the operative deletion/rights machinery
(what memory.js already implements) is not yet a hard legal deadline — it
binds **May 13, 2027**. Building it now is getting ahead of the compliance
clock, not catching up to it — which is exactly the "architecture not
retrofit" framing the track was asked to evaluate.

**Section 12 — right to correction and erasure.** A Data Principal may
request erasure of personal data for which they gave consent; the Data
Fiduciary "shall erase the personal data unless retention is necessary for
the specified purpose or for compliance with any law." **This is
conditional, not absolute** — narrower than GDPR's right to be forgotten.
Burden to justify continued retention sits with the fiduciary, not the user.
Source: [DPDPA.com Section 12 text+interpretation](https://www.dpdpa.com/dpdpa2023/chapter-3/section12.html),
[ApniLaw bare-act text](https://www.apnilaw.com/bare-act/dpdp/section-12-digital-personal-data-protection-act-dpdp-right-to-correction-and-erasure-of-personal-data/).

**Rules 2025 — erasure mechanics.** Personal data must be erased once the
purpose is no longer served (consent withdrawn, purpose fulfilled, or the
user goes inactive past a retention window). Data Fiduciaries must give the
Data Principal **48 hours' notice before completing a scheduled erasure**, so
the user has a last chance to re-engage and stop it. Traffic/processing logs
must be retained a **minimum of 1 year** for forensic/investigative purposes
before erasure. Consent withdrawal cannot be made a precondition for denying
unrelated services.
Source: search-triangulated across
[Lexology](https://www.lexology.com/library/detail.aspx?g=7e3af947-10aa-4712-bc1e-54179a613409),
[Seclore](https://www.seclore.com/fundamentals/dpdp-rules-2025-compliance-guide/),
[Scrut](https://www.scrut.io/post/dpdp-rules). Not independently confirmed
against rule-numbered primary text; treat the 48-hour figure and 1-year
minimum as **medium confidence** (repeated across ≥3 secondary sources but
not verified against the PIB PDF directly).

**Section 9 — children.** A "child" is anyone **under 18** (Section 2(f)).
Section 9(2) is a **principles-based catch-all** barring processing "likely
to cause any detrimental effect on the well-being of a child" — explicitly
glossed by commentary as covering psychological harm, **addictive engagement
patterns**, undermining of self-esteem, interference with healthy
development. Section 9(3) **bans behavioural tracking/monitoring of children
and targeted advertising directed at children outright** — no exceptions
listed comparable to COPPA's carve-outs. Verifiable parental consent is
mandatory before processing a child's data.
Source: [DPDPA.com Section 9](https://www.dpdpa.com/dpdpa2023/chapter-2/section9.html),
[CyberPeace](https://cyberpeace.org/resources/blogs/prohibition-of-behavioral-tracking-and-targeted-advertising-for-children-under-the-dpdp-act-2023).

**Load-bearing read for a companion product:** Section 9(2)'s "detrimental to
well-being... addictive engagement patterns" language is not a data-handling
rule, it is a **product-design rule** — it reaches directly into engagement
mechanics (streaks, notification cadence, variable-reward media drops) for
any user DPDP treats as a child. A companion app cannot satisfy this by
policy alone; it needs either (a) verified-adult gating or (b) a structurally
different, non-addictive-by-design experience for anyone it cannot verify as
18+. Given DPDP's parental-consent bar for under-18s generally (not just
under-13 as in COPPA), age handling in India is a stricter threshold than in
the US state laws below.

**Verification method — Rule 10.** Approved parental-consent verification
integrates with **DigiLocker** (India's government digital-ID wallet) to
confirm the parent's identity and the parent-child relationship.
Source: [search summary of DPDP Rules guides](https://www.seclore.com/fundamentals/dpdp-rules-2025-compliance-guide/),
[ksandk.com](https://ksandk.com/data-protection-and-data-privacy/child-data-protection-under-dpdp-act-parental-consent-rules/).

**Cross-border transfer — relevant to the model-router architecture.** DPDP
Rules use a **blacklist approach**: transfers are permitted by default except
to countries the government specifically notifies as restricted. As of this
research, no such notified list was found. **This matters directly to
Meera's stack** — inference/vision/TTS calls currently route to
Azure/Google/xAI/OpenRouter, all foreign clouds — because DPDP does not
(currently) mandate India-only data residency the way some other regimes do;
the constraint is narrower than commonly assumed and could tighten if a
blacklist is ever notified.
Source: search-triangulated, not independently confirmed against rule text —
**medium confidence**.

**What DPDP does NOT clearly require (gap worth naming):** unlike GDPR, DPDP
does not have an explicit standalone "right to data portability" / export
in the way GDPR Article 20 does; the DPDP rights bundle (per multiple
secondary sources) centers on **access, correction, erasure, grievance
redressal, and nominating a person to exercise rights after death/incapacity**
— portability/export is not confirmed as a distinct statutory right in what
was found. This is worth treating as **unresolved** rather than either
confirmed present or confirmed absent; it was not directly verified against
primary Act text section-by-section.

---

## 4. US state law — companion chatbot bills (verified real, not proposed)

**California SB 243** — signed by Gov. Newsom **October 13, 2025**. Core
obligations effective **January 1, 2026**; annual reporting obligation to the
Office of Suicide Prevention effective **July 1, 2027**.
- Must give "a clear and conspicuous notification indicating the companion
  chatbot is artificially generated and not human."
- If the operator knows the user is a minor: notification **at least every
  three hours** during continuing interaction, reminding the user to take a
  break and that the chatbot is not human; platform must post that companion
  chatbots "may not be suitable for certain young users."
- Must **prevent production of suicidal ideation, suicide, or self-harm
  content** and direct users to crisis resources.
- Minor-specific: must prevent sexually explicit visual material or explicit
  statements urging a minor toward sexual conduct.
- **Private right of action**, up to **$1,000 per violation** in damages —
  this is the sharpest enforcement teeth of any source reviewed here; it
  means individual users, not just the state AG, can sue.
Source: [Morrison Foerster](https://www.mofo.com/resources/insights/251120-new-york-and-california-enact-landmark-ai),
corroborated by [Skadden](https://www.skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law)
and [Jones Walker](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/ai-regulatory-update-californias-sb-243-mandates-companion-ai-safety-and-accoun.html).

**New York AI Companion Models Law** — effective **November 5, 2025**.
- Notification that "the AI is a computer program" at session start **and
  every three hours** during use — **applies to ALL users, not just
  known minors** (broader than California on this one axis).
- Must maintain protocols to **detect expressions of suicidal ideation/
  self-harm and direct users to crisis service providers**.
- No age-specific safeguards beyond the universal disclosure/crisis rules.
- Enforcement is **AG-only** (no private right of action); civil penalties up
  to **$15,000/day**.
Source: [Morrison Foerster](https://www.mofo.com/resources/insights/251120-new-york-and-california-enact-landmark-ai).

**Read against this repo's existing behavior:** the CLAUDE.md states Meera
"never denies being an AI" already, and crisis helplines already exist in
the persona (referenced repeatedly in `context/` re: over/under-triggering
measurements). The **structural gap** against both CA and NY law as verified
here is the **periodic re-disclosure cadence** (every 3 hours) — a
one-time or context-triggered AI-disclosure is not what either statute
describes; both require a *recurring* notification during a long-running
session, which is a different mechanism (a session-duration timer, not a
persona rule) than "never deny being an AI when asked."

---

## 5. Design-constraint list — what the relational architecture must structurally support

Each constraint below is tied back to a specific verified requirement above,
plus (where relevant) to what this repo already has or lacks, checked
directly against `api/memory.js`, `src/engine/memory.ts`, `api/account.js`,
`src/engine/account.ts` on 2026-08-13.

1. **Export / data portability, as a first-class op — currently MISSING.**
   `api/memory.js` implements `log`, `recall`, `remember`, `forget` only;
   `api/account.js` implements OTP/session/`save_state`/`load_state`/`track`.
   **No `export` op exists anywhere in the repo.** DPDP's rights bundle
   (access/correction/erasure/grievance) plausibly implies a right to obtain
   a copy on request even without a distinct "portability" article (unverified,
   §4 above), and both the FTC 6(b) category on "disclosures... regarding
   data practices" and general trust-as-moat logic argue for it regardless of
   the strict legal floor. **This is the single clearest gap found in this
   track** relative to what regulators are asking about.

2. **Deletion that includes derived state, not just source rows — this repo
   already does the hard part.** `api/memory.js`'s forget op is a genuine
   hard delete (no `deleted_at`/`hidden` flag), chases derived graph edges
   (`dropEdgesFor`) so no orphaned relation survives a node delete, deletes
   telemetry on the same terms as the log (explicitly because telemetry is
   "the one place that would otherwise keep a copy of something they asked to
   be gone"), and stores only the forgotten *term* (not content) in
   `meera_forget` so re-extraction doesn't silently restore it. This is
   architecturally ahead of what DPDP Rules require today (obligations don't
   bind until 2027) and is a genuine candidate for "safety as moat" — but it
   is currently a client-only, device-scoped mechanism (comment: "the device
   is the identity, so a device can only ever delete its own rows"), which
   will need to become identity-scoped once cross-device/cross-model
   relationship continuity (the whole point of Vyakti) exists. A relationship
   that survives a model swap must also survive a device swap, and forgetting
   has to follow the same continuity, not stay pinned to `device_id`.

3. **Dependency circuit-breakers — no evidence of one in this repo; now a
   named regulatory category in two jurisdictions.** China's Interim Measures
   mandate a **2-hour continuous-use break trigger** and mandatory
   "overdependence" warnings; CA SB 243 and NY law both mandate **3-hour**
   recurring notifications for long sessions. None of these is a persona rule
   — all three are **session-duration timers independent of conversation
   content**. This is a structural gap: the architecture needs a
   session-clock component that fires regardless of what she is saying,
   separate from and layered on top of the crisis-detection logic that
   already exists in the persona.

4. **Age handling — currently no verified age gate found in Onboarding.tsx or
   account.ts.** DPDP treats "child" as under-18 with mandatory verifiable
   parental consent (DigiLocker-integrated) and a *product-design* prohibition
   on addictive engagement patterns for children (Section 9(2)), not just a
   data rule. CA SB 243's minor-specific obligations (break reminders, no
   sexual content) require the operator to *know* a user is a minor, which
   in turn requires an age signal to exist at all. **The constraint: an
   age-tier needs to exist as state the relational engine can read**, not
   just a compliance flag bolted onto onboarding — because it changes what
   the engagement mechanics themselves are allowed to do (streaks, variable
   reward, dependency-shaped design), not just what disclosures appear.

5. **AI-disclosure must be a recurring, timed event, not only an on-demand
   truth.** The repo's "never denies being an AI" is necessary but not
   sufficient against CA SB 243 (minors, every 3h), NY (everyone, every 3h),
   and China (informed at start + 2h break trigger). **Constraint: a
   session-duration-aware disclosure/break-reminder subsystem, decoupled from
   whether the user asks.** This composes naturally with constraint 3 (same
   timer can drive both).

6. **Crisis/self-harm handling must be measured on its OWN terms, separately
   from general helpline-injection tuning.** `context/decisions.md` and
   `rejected.md` already show this project treats helpline over/under-firing
   as a live tuning problem (16.7% over-trigger with reasoning; unresolved
   1/3 vs 0/3 gap in the Azure bake-off). Every regulatory source in this
   track independently mandates crisis detection + redirection to services
   as a floor requirement (FTC category 5, China's crisis-intervention
   clause, CA's self-harm content prevention, NY's detect-and-direct clause).
   This is confirmation the existing measurement discipline
   (`reasoning-split`, the helpline-rate numbers) is pointed at a real
   regulatory floor, not just a UX nice-to-have — worth keeping visible as a
   named eval axis through every future model swap, since a swap that quietly
   changes helpline-trigger rate is a compliance regression, not just a
   charm regression.

7. **Persona/character-change governance — a new category this repo has no
   analogue for.** FTC's category "how these are designed, categorized, and
   approved" (personas) and China's ban on "excessively catering to users" to
   induce dependency both point at **the persona-design process itself**
   being an audit surface, not just its output. For Vyakti specifically —
   whose entire thesis is that identity should survive underneath-the-model
   swaps — this means the **model-router / swap-test protocol itself** should
   produce an auditable record of what changed and why (which is already the
   spirit of `context/decisions.md`'s reversal-condition discipline) —
   regulatory readiness and the project's own research discipline point the
   same direction here.

8. **Cross-border / data-residency posture needs an explicit decision, not a
   default.** DPDP's blacklist approach means no localization mandate today,
   but Meera's stack already spans Azure, Google, xAI, and OpenRouter with a
   credits-driven router (`credits-partner` in decisions.md) that can
   silently bill a card instead of failing on an ineligible model. **The
   constraint: routing decisions that are currently cost/quality-driven
   (`brain-model`, `extract-model`) may need a data-residency dimension
   added before India-first scale, even though nothing in DPDP requires it
   yet** — this is anticipation, not a current legal requirement, and should
   be logged as such if acted on.

---

## Confidence summary

| claim | confidence | why |
|---|---|---|
| FTC 6(b), Sept 11 2025, 7 named companies | high | FTC's own press release |
| FTC 6(b) category list | medium-high | 2 independent law-firm summaries agree; primary PDF unreachable (tool error) |
| China Interim Measures effective 2026-07-15, core provisions | high | 4 independent sources incl. Xinhua agree on date and mechanism |
| China platforms' actual compliance response (Doubao/Qwen shutdown) | medium-high | reported by Just Security, not cross-checked against a second primary account |
| DPDP Section 9 (children) and Section 12 (erasure) text | high | matched against dpdpa.com's section-numbered reproduction and a bare-act mirror |
| DPDP Rules 2025 staggered commencement dates | medium-high | PIB is the primary notifier; date corroborated by 2 law firms |
| DPDP 48-hour erasure notice, 1-year log retention floor | medium | repeated across secondary sources only, not checked against rule-numbered primary text |
| DPDP cross-border blacklist approach | medium | secondary-source only |
| DPDP portability/export as distinct right | **unresolved** | not found confirmed or denied in primary text |
| CA SB 243 dates and provisions | high | matched across 3 law-firm summaries independently |
| NY AI Companion Models Law dates and provisions | high | matched across sources, corroborates MoFo |

## What this track did NOT verify (explicit gaps)

- The FTC 6(b) order's actual PDF text (fetch failed twice; relied on 2
  secondary summaries that substantially agree but were not read verbatim).
- Whether DPDP has a standalone data-portability right distinct from erasure
  — flagged unresolved above.
- Whether any Indian state or the DPDP Board has issued companion-AI-specific
  guidance beyond the general Act/Rules (not searched; out of scope as asked,
  but worth flagging that this track only covers the national DPDP layer).
- Whether other US states beyond CA/NY have *passed* (not just proposed)
  companion chatbot law — search focused on confirmed-enacted law per the
  task; did not exhaustively survey all 50 states.
