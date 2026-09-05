# The six consent ceremonies in Hindi: a legal review document

WS-R83, 2026-09-05. This document is the deliverable, not a diff. Nothing in
`src/` changes as part of this workstream; the six studio files it covers
(`ModelConsentGate.tsx`, `IdentityProofing.tsx`, `VideoEnrollPanel.tsx`,
`IngestChannelStudio.tsx`, `LivenessCapture.tsx`, `VoiceIdentityChallenge.tsx`)
were held back from the studio's Hindi conversion by
`context/decisions.md#ws-r61-modelconsentgate-left-untouched-consent-ceremony-legal-text`,
`#ws-r61-identity-proofing-consent-statements-deferred-not-attempted` and
`#ws-r71-consent-ceremony-files-found-and-not-converted` for exactly this
reason: a mistranslation in a consent, KYC or biometric ceremony carries real
legal and compliance weight, and no session had legal sign-off on Hindi
wording in scope. This document is that sign-off's input, not its output. It
gets a lawyer to a "yes" or a set of specific line-level fixes.

## What happens after this document is reviewed

Once a person with sign-off authority over consent/KYC/biometric copy has
approved the Hindi in this document (as written, or as corrected inline):

1. The three decision entries named above get a `supersedes` edge from a new
   entry recording that legal review happened, on what date, for which rows.
2. The reviewed Hindi (not a re-translation from scratch) is written verbatim
   into `src/studio/hiCopy.ts`, one section per file, matching the shape every
   other Tier 1 file already uses.
3. Each of the six files is moved out of `TIER_2_ALLOWLIST` and into
   `TIER_1_FILES` in `evals/studio-locale/run.mjs`, and converted to read from
   `t.` the same way every other Tier 1 file was (WS-R52/R61/R71's own
   pattern for a Tier 2 to Tier 1 move: rewrite the component to route every
   string in this document through the copy table, keep every prop and
   handler unchanged, then let the static scan in `evals/studio-locale/run.mjs`
   prove zero literal English text nodes remain).
4. If a row's Hindi is corrected during review, the correction goes into
   `hiCopy.ts`, not into this document after the fact; this document stays a
   record of what was proposed and reviewed, not a living copy source.
5. `evals/consent-review/run.mjs` (this workstream's own eval) keeps running
   after that conversion happens; the copy in `hiCopy.ts` and the copy in this
   document should read as translations of each other. A future edit to
   `hiCopy.ts` that silently changes ceremony wording is a decisions.md entry
   of its own, not a reason to touch this file.

## Methodology: what is a "row", and why these rows and no others

Each of the six files was read in full. A **row** in this document is one of
five structural things every consent ceremony in this codebase is built from,
each one mechanically extractable from the component's own source rather than
picked by eye:

1. **A consent statement or checkbox label**: an entry of the file's own
   named statement array (`STATEMENTS`, `ATTESTATION_COPY`, `STATEMENT_COPY`),
   or, where a file has no named array, the inline `[key, label]` tuple list
   that renders its checkboxes (`LivenessCapture.tsx`'s biometric consent
   list). This is the actual thing a person affirmatively checks.
2. **A ceremony heading**: the section's `eyebrow` paragraph and its `h2`/`h3`
   (identified by the heading `id` the section's own `aria-labelledby`
   already points at), and the `<legend>` of the `<fieldset>` holding the
   statements.
3. **A primary action**: the resting-state (non-busy) label of the button
   that actually grants, submits or requests the ceremony's permission.
4. **A boundary or refusal line**: an explicit sentence stating what the
   consent does or does not cover (rendered with a `*-boundary` class name
   where one exists), a validation refusal shown when the statements are not
   all checked, or a withdrawal/cancellation confirmation.
5. **File 6 only** (`VoiceIdentityChallenge.tsx` has no checkbox array of its
   own; its gating consent lives in `EnrollmentWorkspace.tsx`'s own panel,
   which is out of scope for this document because it is not one of the six
   named files): its `REASON` map, the file's own refusal-line data structure,
   stands in for category 1 here, since "refusal line" is exactly what it is.

This boundary is intentionally narrower than "every string in the file". The
longer explanatory paragraphs this document also quotes (an intro sentence, a
privacy assurance, the Azure face-check data-flow disclosure) are included as
supporting context for the reviewer because they carry real meaning for a
biometric or KYC ceremony, but the five categories above are the set
`evals/consent-review/run.mjs` mechanically re-extracts from the live source
and checks against this document's English column on every run (law 3 of the
brief: a future edit to a ceremony fails the eval until this document is
updated). A row not in categories 1 to 5 is marked **(context)** and is not
part of that mechanical completeness proof.

### Glossary (kept consistent across all 88 rows)

| English | Hindi | Why |
|---|---|---|
| your AI / an AI | आपका AI / AI | `src/studio/hiCopy.ts`'s own established rendering; "AI" is never transliterated. |
| consent (noun) | सहमति | |
| permission / authorize | अनुमति / अनुमति देना | |
| withdraw (a permission) | वापस लेना | |
| cancel (an attempt) | रद्द करना | Matches `hiCopy.ts`'s existing `cancel: "रद्द करें"`. |
| erase / delete | मिटाना | Used consistently for a destructive, verified deletion. |
| identity | पहचान | |
| biometric | बायोमेट्रिक | Retained loanword, matches existing product usage; not a banned term. |
| verify / verification | सत्यापन / सत्यापित | |
| disclosure / watermark / synthetic / inference | डिस्क्लोज़र / वॉटरमार्क / सिंथेटिक / इन्फ़रेंस | Retained loanwords already established in `hiCopy.ts`. |
| owner (self-mode) | मालिक | Matches `hiCopy.ts`'s existing `eyebrow: "मालिक नियंत्रण"` and `proofOwnerOnly`. |
| government-issued identity document | सरकार द्वारा जारी पहचान दस्तावेज़ | |
| portrait (of a face) | चेहरे की तस्वीर | Plain rather than literary; a legal document does not need "portrait"'s formality. |

**Gender-neutral first person.** Every first-person consent statement uses the
slash convention `करता/करती हूं`, the common gender-neutral form for Hindi
consent and form copy, so no statement silently defaults to one gender. If the
platform's Hindi UI has (or later adopts) a stored gender preference, this is
the row a personalised, single-gendered form would read from instead; that is
a product decision, not something this review resolves.

**Banned words the English source uses that the Hindi cannot.**
`scripts/check-copy.mjs`'s Rooms vocabulary rule bans `clone`, `replica`,
`model`, `fine-tune`/`train`/`training`, `weights`, `embedding`, `LoRA` and
`genome` (and their Devanagari equivalents क्लोन, मॉडल, प्रतिकृति) in any
user-visible string this document's target files will ship once converted.
Three of the English rows quoted below (`ModelConsentGate.tsx` rows 1, 3, 6
and `LivenessCapture.tsx` row 10) are written in English that predates that
rule and use exactly the words it bans (`replica`, `training`, `model`,
`embeddings`, `derived models`). The Hindi in this document renders those
functionally instead (`आपका AI` for "replica", "आवाज़ तैयार करने या बेहतर
बनाने" for "training or adaptation of a voice model", "आवाज़
पहचान-निशानी" for "voice embeddings") and each of those rows is flagged with
an explicit note. **These are the rows most likely to need a lawyer's
explicit confirmation that the functional Hindi still covers what the English
legal noun covers**, because the substitution is required by this product's
own vocabulary law, not chosen for style.

**Typed confirmation codes.** Two ceremonies ask a person to type an exact
phrase to confirm a destructive action: `PAUSE AI` (`ModelConsentGate.tsx`)
and `ERASE ID` (`IdentityProofing.tsx`). This document keeps both in English
Latin script inside the Hindi sentence that instructs the typing, matching the
product's existing pattern of never transliterating "AI". Whether the typed
match string itself should also exist in a Hindi form is a product decision
this document does not make; it is called out per row so it is not missed.

## Where each statement set is recorded

| File | `statement_set` | `policy_version` | Recorded in |
|---|---|---|---|
| `ModelConsentGate.tsx` | `verified-model-consent/v1` | `replica-self-v1` | `vy_replica_consent` (033) |
| `IdentityProofing.tsx` | `identity-proofing-consent/v1` | `vyakti-identity-evidence/v1` | `vy_identity_case` (040) |
| `VideoEnrollPanel.tsx` | `channel-ownership-attestation/v1` | `replica-self-v1` | `vy_channel_attestation` (057), reused by `api/_video-enroll.js` rather than a second consent table |
| `IngestChannelStudio.tsx` | `channel-ownership-attestation/v1` | `replica-self-v1` | `vy_channel_attestation` (057) |
| `LivenessCapture.tsx` | `biometric-verification-consent/v1` | verifier decision judged against `vyakti-liveness-composite/v2` (`LIVENESS_VERIFICATION_POLICY.version`) | `vy_replica_consent` scope `capture`, via `api/_replica-liveness.js` |
| `VoiceIdentityChallenge.tsx` | none of its own (no checkbox array; see Methodology, category 5) | `voice-identity-challenge/v1` | `vy_replica_voice_identity_challenge` (072) |

`VideoEnrollPanel.tsx` and `IngestChannelStudio.tsx` render the SAME
`channel-ownership-attestation/v1` statement set on two different screens
(`api/_video-enroll.js` reuses `vy_channel_attestation` rather than writing a
second consent artifact); their English wording differs by screen even though
the legal statement set is identical, so their Hindi need not be word-for-word
identical either, only equivalent in meaning. Both are reviewed as separate
rows below because a reviewer approving one should not be assumed to have
approved the other's specific phrasing.

---

## File 1 of 6: `ModelConsentGate.tsx`

The ceremony that turns on build and inference permission for an owner's own
AI, gated on a live identity/biometric receipt. `statement_set:
verified-model-consent/v1`, `policy_version: replica-self-v1`. 16 rows.

**R1.** `ModelConsentGate.tsx:74` (ceremony heading, eyebrow)
- **EN:** Permission to build your AI
- **HI (प्रस्तावित):** आपका AI बनाने की अनुमति
- **Back-translation:** Permission to build your AI
- **Note:** none

**R2.** `ModelConsentGate.tsx:74` (ceremony heading, h2)
- **EN:** This is the consent that lets your AI exist
- **HI (प्रस्तावित):** यह वह सहमति है जो आपका AI बनाती है
- **Back-translation:** This is the consent that makes your AI exist / creates your AI
- **Note:** none

**R3.** `ModelConsentGate.tsx:77` (boundary / scope, intro)
- **EN:** Uploading memories never grants rights to build your AI. This separate ceremony is bound to your passed live identity proof and can be withdrawn at any time.
- **HI (प्रस्तावित):** यादें अपलोड करने से आपका AI बनाने का अधिकार कभी नहीं मिलता। यह अलग प्रक्रिया आपके पास हुए लाइव पहचान प्रमाण से जुड़ी है और इसे कभी भी वापस लिया जा सकता है।
- **Back-translation:** Uploading memories never grants the right to build your AI. This separate process is tied to your passed live identity proof and it can be withdrawn at any time.
- **Note:** "ceremony" is rendered as "प्रक्रिया" (process); there is no single Hindi word carrying the same deliberate formality as the English "ceremony", and the legal weight sits in the procedure being separate and revocable, not in that one word.

**R4.** `ModelConsentGate.tsx:80` (refusal line, blocker heading)
- **EN:** Verified consent is unavailable
- **HI (प्रस्तावित):** सत्यापित सहमति अभी उपलब्ध नहीं है
- **Back-translation:** Verified consent is not available right now
- **Note:** none

**R5.** `ModelConsentGate.tsx:80` (refusal line, blocker body)
- **EN:** Complete adult identity and live face-and-voice verification first. The narrow biometric verification receipt must still be active.
- **HI (प्रस्तावित):** पहले वयस्क पहचान और लाइव चेहरे-और-आवाज़ सत्यापन पूरा करें। सीमित बायोमेट्रिक सत्यापन रसीद अभी भी सक्रिय होनी चाहिए।
- **Back-translation:** First complete adult identity and live face-and-voice verification. The limited biometric verification receipt must still be active.
- **Note:** none

**R6.** `ModelConsentGate.tsx:7` (consent statement, key `private_self_replica_only`)
- **EN:** I am creating only my own private replica. I will not submit another person's identity or voice.
- **HI (प्रस्तावित):** मैं सिर्फ़ अपना निजी AI बना रहा/रही हूं। मैं किसी और व्यक्ति की पहचान या आवाज़ नहीं दूंगा/दूंगी।
- **Back-translation:** I am building only my own private AI. I will not give another person's identity or voice.
- **Note:** the source key and English text say "replica"; a Rooms-vocabulary-banned word. Rendered as "AI" ("अपना निजी AI"), the platform's own required substitute in every user-visible string. This substitution should not narrow what "only my own" is understood to cover, but a lawyer should confirm that.

**R7.** `ModelConsentGate.tsx:8` (consent statement, key `authorize_biometric_voice_modeling`)
- **EN:** I authorize creation of revocable voice embeddings and biometric voice characteristics from my approved evidence.
- **HI (प्रस्तावित):** मैं अपने मंज़ूर किए गए सबूत से वापस ली जा सकने वाली आवाज़ पहचान-निशानी और बायोमेट्रिक आवाज़ विशेषताएं बनाने की अनुमति देता/देती हूं।
- **Back-translation:** I authorize creating a revocable voice identity-marker and biometric voice characteristics from my approved evidence.
- **Note:** "embeddings" has no direct Hindi equivalent and is separately a Rooms-vocabulary-banned word. Rendered functionally as "आवाज़ पहचान-निशानी" (voice identity-marker) rather than transliterated. **Needs legal confirmation this functional description still covers what "voice embeddings" covers technically.**

**R8.** `ModelConsentGate.tsx:9` (consent statement, key `authorize_private_training`)
- **EN:** I authorize private training or adaptation of a voice model bound only to this replica.
- **HI (प्रस्तावित):** मैं सिर्फ़ इसी AI से जुड़ी, निजी तौर पर आवाज़ तैयार करने या उसे बेहतर बनाने की अनुमति देता/देती हूं।
- **Back-translation:** I authorize privately preparing or improving the voice tied only to this AI.
- **Note:** "training", "model" and "replica" are all Rooms-vocabulary-banned words; none can appear in the Hindi. Rendered functionally as "आवाज़ तैयार करने या बेहतर बनाने" (preparing or improving the voice). **This is the single row in this document most likely to need explicit legal sign-off**: the English names a specific technical operation (training/adapting a model) that the Hindi can only describe functionally, and a court reading the Hindi in isolation would not necessarily recover "training a model" from it.

**R9.** `ModelConsentGate.tsx:10` (consent statement, key `authorize_disclosed_inference`)
- **EN:** I authorize private inference after activation. Every output must identify itself as synthetic.
- **HI (प्रस्तावित):** मैं सक्रिय होने के बाद निजी इन्फ़रेंस की अनुमति देता/देती हूं। हर आउटपुट को खुद को सिंथेटिक बताना ज़रूरी है।
- **Back-translation:** I authorize private inference after activation. Every output must state itself as synthetic.
- **Note:** none

**R10.** `ModelConsentGate.tsx:11` (consent statement, key `understand_synthetic_disclosure_and_watermarking`)
- **EN:** I understand generated audio will carry audible disclosure, an imperceptible watermark, and a signed provenance receipt.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि बनाए गए ऑडियो में सुनाई देने वाला डिस्क्लोज़र, एक अदृश्य वॉटरमार्क, और साइन की गई उत्पत्ति रसीद होगी।
- **Back-translation:** I understand that generated audio will have an audible disclosure, an invisible watermark, and a signed origin receipt.
- **Note:** none

**R11.** `ModelConsentGate.tsx:12` (consent statement, key `understand_revocation_stops_use_and_deletes_copies`)
- **EN:** I understand withdrawal disables use immediately and queues derived models and provider copies for verified deletion.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि वापस लेने पर इस्तेमाल तुरंत बंद हो जाता है और इससे बनी कोई भी चीज़ और प्रोवाइडर के पास मौजूद कॉपियां सत्यापित मिटाने के लिए कतार में लग जाती हैं।
- **Back-translation:** I understand that on withdrawal, use stops immediately and anything built from it, and copies held by the provider, go into a queue for verified deletion.
- **Note:** "derived models" is rendered as "इससे बनी कोई भी चीज़" (anything built from it), avoiding the banned word "model"; functionally equivalent but less specific than the English noun phrase. Flag alongside R8.

**R12.** `ModelConsentGate.tsx:84` (boundary line)
- **EN:** Public sharing, raw downloads, API access, telephony, and using your material to improve anyone else's AI remain off.
- **HI (प्रस्तावित):** पब्लिक शेयरिंग, कच्ची डाउनलोड, API एक्सेस, टेलीफ़ोनी, और किसी और के AI को बेहतर बनाने के लिए आपकी सामग्री का इस्तेमाल, ये सब बंद ही रहते हैं।
- **Back-translation:** Public sharing, raw downloads, API access, telephony, and using your material to improve anyone else's AI, all of these stay off.
- **Note:** none

**R13.** `ModelConsentGate.tsx:85` (withdrawal ceremony)
- **EN:** Type PAUSE AI to withdraw build and inference permission
- **HI (प्रस्तावित):** बनाने और इन्फ़रेंस की अनुमति वापस लेने के लिए PAUSE AI टाइप करें
- **Back-translation:** To withdraw the permission to build and for inference, type PAUSE AI
- **Note:** typed confirmation code kept in English (see Methodology).

**R14.** `ModelConsentGate.tsx:88` (primary action, withdrawal)
- **EN:** Withdraw now
- **HI (प्रस्तावित):** अभी वापस लें
- **Back-translation:** Withdraw now
- **Note:** none

**R15.** `ModelConsentGate.tsx:102` (primary action, grant)
- **EN:** Grant permission to build and run your AI
- **HI (प्रस्तावित):** आपका AI बनाने और चलाने की अनुमति दें
- **Back-translation:** Give permission to build and run your AI
- **Note:** none

**R16.** `ModelConsentGate.tsx:106` (boundary, duration note)
- **EN:** Build permission lasts 180 days; inference permission lasts 30 days. Renewal always requires a new affirmative ceremony.
- **HI (प्रस्तावित):** बनाने की अनुमति 180 दिन चलती है; इन्फ़रेंस की अनुमति 30 दिन चलती है। नवीनीकरण के लिए हमेशा एक नई, साफ़ सहमति वाली प्रक्रिया चाहिए।
- **Back-translation:** Build permission lasts 180 days; inference permission lasts 30 days. Renewal always needs a new, clearly-consented process.
- **Note:** none

---

## File 2 of 6: `IdentityProofing.tsx`

Adult identity and government-ID verification, KYC-adjacent. `statement_set:
identity-proofing-consent/v1`, `policy_version: vyakti-identity-evidence/v1`.
14 rows.

**R17.** `IdentityProofing.tsx:125` (ceremony heading, eyebrow)
- **EN:** Adult identity
- **HI (प्रस्तावित):** वयस्क पहचान
- **Back-translation:** Adult identity
- **Note:** none

**R18.** `IdentityProofing.tsx:125` (ceremony heading, h3)
- **EN:** Bind one real person to your AI
- **HI (प्रस्तावित):** अपने AI से एक असली व्यक्ति को जोड़ें
- **Back-translation:** Attach one real person to your AI
- **Note:** none

**R19.** `IdentityProofing.tsx:131` (context, intro)
- **EN:** Choose a private ID image or PDF already in your source vault. The verifier must establish document authenticity, current validity, adult age, and a usable portrait. OCR or facial age estimation alone can never unlock your AI.
- **HI (प्रस्तावित):** अपने सोर्स वॉल्ट में पहले से मौजूद किसी निजी पहचान-पत्र की तस्वीर या PDF को चुनें। सत्यापनकर्ता को दस्तावेज़ की असलियत, मौजूदा वैधता, वयस्क उम्र, और इस्तेमाल लायक चेहरे की तस्वीर साबित करनी होगी। सिर्फ़ OCR या चेहरे से अंदाज़ा लगाई गई उम्र कभी भी आपका AI अनलॉक नहीं कर सकती।
- **Back-translation:** Choose a private identity-document image or PDF already present in your source vault. The verifier must prove the document's genuineness, current validity, adult age, and a usable facial photo. OCR or face-estimated age alone can never unlock your AI.
- **Note:** none

**R20.** `IdentityProofing.tsx:166` (ceremony heading, legend)
- **EN:** Explicit identity-use permission
- **HI (प्रस्तावित):** पहचान के इस्तेमाल की साफ़ अनुमति
- **Back-translation:** Clear permission for the use of identity
- **Note:** none

**R21.** `IdentityProofing.tsx:6` (consent statement 1 of 5)
- **EN:** This is my own current government-issued identity document.
- **HI (प्रस्तावित):** यह मेरा अपना, मौजूदा, सरकार द्वारा जारी पहचान दस्तावेज़ है।
- **Back-translation:** This is my own, current, government-issued identity document.
- **Note:** none

**R22.** `IdentityProofing.tsx:7` (consent statement 2 of 5)
- **EN:** The document and portrait identify only me.
- **HI (प्रस्तावित):** यह दस्तावेज़ और चेहरे की तस्वीर सिर्फ़ मेरी पहचान बताते हैं।
- **Back-translation:** This document and facial photo identify only me.
- **Note:** none

**R23.** `IdentityProofing.tsx:8` (consent statement 3 of 5)
- **EN:** Use it only to verify my identity and that I am at least 18.
- **HI (प्रस्तावित):** इसे सिर्फ़ मेरी पहचान और यह जांचने के लिए इस्तेमाल करें कि मेरी उम्र कम से कम 18 साल है।
- **Back-translation:** Use it only to check my identity and that my age is at least 18 years.
- **Note:** none

**R24.** `IdentityProofing.tsx:9` (consent statement 4 of 5)
- **EN:** Do not use this document or portrait to build my AI.
- **HI (प्रस्तावित):** इस दस्तावेज़ या चेहरे की तस्वीर का इस्तेमाल मेरा AI बनाने के लिए न करें।
- **Back-translation:** Do not use this document or facial photo to build my AI.
- **Note:** none

**R25.** `IdentityProofing.tsx:10` (consent statement 5 of 5)
- **EN:** Erase the document and derived identity reference after verification or withdrawal.
- **HI (प्रस्तावित):** सत्यापन या वापस लेने के बाद दस्तावेज़ और उससे बना पहचान संदर्भ मिटा दें।
- **Back-translation:** After verification or withdrawal, erase the document and the identity reference derived from it.
- **Note:** none

**R26.** `IdentityProofing.tsx:175` (primary action)
- **EN:** Submit for independent verification
- **HI (प्रस्तावित):** स्वतंत्र सत्यापन के लिए भेजें
- **Back-translation:** Send for independent verification
- **Note:** none

**R27.** `IdentityProofing.tsx:189` (withdrawal ceremony, heading)
- **EN:** Withdraw identity evidence and erase its private source?
- **HI (प्रस्तावित):** पहचान सबूत वापस लें और उसका निजी स्रोत मिटा दें?
- **Back-translation:** Withdraw identity evidence and erase its private source?
- **Note:** none

**R28.** `IdentityProofing.tsx:190` (withdrawal ceremony, body)
- **EN:** This immediately clears adult, identity, and liveness gates. Type ERASE ID to continue.
- **HI (प्रस्तावित):** इससे वयस्क, पहचान, और लाइवनेस गेट तुरंत खाली हो जाते हैं। जारी रखने के लिए ERASE ID टाइप करें।
- **Back-translation:** This immediately clears the adult, identity, and liveness gates. To continue, type ERASE ID.
- **Note:** typed confirmation code kept in English (see Methodology).

**R29.** `IdentityProofing.tsx:196` (boundary line)
- **EN:** The owner interface cannot approve authenticity, age, identity, or liveness. It can only submit or revoke evidence.
- **HI (प्रस्तावित):** मालिक का इंटरफ़ेस असलियत, उम्र, पहचान, या लाइवनेस को मंज़ूर नहीं कर सकता। यह सिर्फ़ सबूत भेज या वापस ले सकता है।
- **Back-translation:** The owner's interface cannot approve authenticity, age, identity, or liveness. It can only submit or withdraw evidence.
- **Note:** none

**R30.** `IdentityProofing.tsx:141` (context, privacy note)
- **EN:** No name, date of birth, document number, address, portrait, or OCR transcript is written to your AI's database.
- **HI (प्रस्तावित):** आपके AI के डेटाबेस में कोई नाम, जन्म तिथि, दस्तावेज़ नंबर, पता, चेहरे की तस्वीर, या OCR ट्रांसक्रिप्ट नहीं लिखा जाता।
- **Back-translation:** No name, date of birth, document number, address, facial photo, or OCR transcript is written into your AI's database.
- **Note:** none

---

## File 3 of 6: `VideoEnrollPanel.tsx`

The "one link" YouTube video enrollment lane; reuses the channel-ownership
attestation `IngestChannelStudio.tsx` also writes. `statement_set:
channel-ownership-attestation/v1`, `policy_version: replica-self-v1`. 11 rows.

**R31.** `VideoEnrollPanel.tsx:153` (ceremony heading, h2)
- **EN:** Make your AI from one video
- **HI (प्रस्तावित):** एक वीडियो से अपना AI बनाएं
- **Back-translation:** Make your AI from one video
- **Note:** none

**R32.** `VideoEnrollPanel.tsx:155` (context, intro)
- **EN:** Paste a link to one of your own videos: a lecture, a talk, anything where you are the one speaking. We take the audio, find the clearest ten seconds of your voice anywhere in it, and use that as the reference. The opening does not have to be clean.
- **HI (प्रस्तावित):** अपने किसी वीडियो का लिंक पेस्ट करें: कोई लेक्चर, कोई बातचीत, कुछ भी जिसमें बोलने वाले आप खुद हों। हम उसमें से ऑडियो लेते हैं, आपकी आवाज़ के सबसे साफ़ दस सेकंड कहीं भी ढूंढते हैं, और उसे रेफ़रेंस की तरह इस्तेमाल करते हैं। शुरुआत का हिस्सा साफ़ होना ज़रूरी नहीं है।
- **Back-translation:** Paste a link to one of your videos: some lecture, some talk, anything where you yourself are the one speaking. We take the audio from it, find your voice's clearest ten seconds anywhere in it, and use that as a reference. The opening part does not need to be clean.
- **Note:** none

**R33.** `VideoEnrollPanel.tsx:194` (context, pre-attestation note)
- **EN:** We check the video really was uploaded by this channel before we download anything. If it was not, we stop.
- **HI (प्रस्तावित):** कुछ भी डाउनलोड करने से पहले हम जांचते हैं कि यह वीडियो सच में इसी चैनल से अपलोड हुआ था। अगर नहीं, तो हम रुक जाते हैं।
- **Back-translation:** Before downloading anything, we check that this video was really uploaded from this same channel. If not, we stop.
- **Note:** none

**R34.** `VideoEnrollPanel.tsx:200` (ceremony heading, legend)
- **EN:** Before we take the audio
- **HI (प्रस्तावित):** ऑडियो लेने से पहले
- **Back-translation:** Before we take the audio
- **Note:** none

**R35.** `VideoEnrollPanel.tsx:39` (consent statement, key `owns_or_controls_channel`)
- **EN:** This is my channel. I own or control it.
- **HI (प्रस्तावित):** यह मेरा चैनल है। मैं इसका मालिक हूं या इस पर मेरा नियंत्रण है।
- **Back-translation:** This is my channel. I am its owner or I have control over it.
- **Note:** none

**R36.** `VideoEnrollPanel.tsx:40` (consent statement, key `is_rights_holder_of_uploads`)
- **EN:** I am the rights holder of what I upload to it.
- **HI (प्रस्तावित):** जो मैं इस पर अपलोड करता/करती हूं, उसके अधिकार मेरे पास हैं।
- **Back-translation:** I hold the rights to what I upload on it.
- **Note:** none

**R37.** `VideoEnrollPanel.tsx:41` (consent statement, key `authorizes_audio_extraction_for_own_replica`)
- **EN:** I authorise Vyakti to take the audio from this video to build MY own AI.
- **HI (प्रस्तावित):** मैं Vyakti को अपना ही AI बनाने के लिए इस वीडियो से ऑडियो लेने की अनुमति देता/देती हूं।
- **Back-translation:** I authorize Vyakti to take audio from this video to build my own AI.
- **Note:** the source key name says "replica"; rendered as "AI" per the platform's own vocabulary rule (see Methodology). The English text itself already says "AI", so this row's English/Hindi meaning matches exactly; only the internal key name differs.

**R38.** `VideoEnrollPanel.tsx:43` (consent statement, key `understands_tos_exposure_is_not_copyright_permission`)
- **EN:** I understand you can give us copyright permission for your own lecture, and that this is separate from YouTube's own terms about downloading, which nobody but YouTube can grant.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि आप अपने ही लेक्चर के लिए हमें कॉपीराइट अनुमति दे सकते हैं, और यह YouTube की अपनी उन शर्तों से अलग बात है जो डाउनलोड करने को लेकर हैं, जिनकी अनुमति सिर्फ़ YouTube दे सकता है, कोई और नहीं।
- **Back-translation:** I understand that you can give us copyright permission for your own lecture, and this is a separate matter from YouTube's own terms about downloading, permission for which only YouTube can give, nobody else.
- **Note:** this is the statement `IngestChannelStudio.tsx`'s own header comment (line 21-23) calls out as "the one about YouTube's Terms is exactly the one a teacher needs to have read"; the Hindi keeps both clauses (copyright permission vs. YouTube's separate download terms) as separate sentences rather than compressing them, for the same reason.

**R39.** `VideoEnrollPanel.tsx:45` (consent statement, key `understands_revocation_stops_extraction`)
- **EN:** I understand that withdrawing this permission stops extraction and deletes what it produced.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि यह अनुमति वापस लेने से निकालना बंद हो जाता है और जो कुछ इससे बना था, वह मिटा दिया जाता है।
- **Back-translation:** I understand that withdrawing this permission stops the extraction and whatever it produced is deleted.
- **Note:** none

**R40.** `VideoEnrollPanel.tsx:217` (refusal line)
- **EN:** All five need to be true before we can start.
- **HI (प्रस्तावित):** शुरू करने से पहले सभी पांचों बातें सही होनी चाहिए।
- **Back-translation:** Before we can start, all five things must be true.
- **Note:** none

**R41.** `VideoEnrollPanel.tsx:214` (primary action)
- **EN:** Make your AI from this video
- **HI (प्रस्तावित):** इस वीडियो से अपना AI बनाएं
- **Back-translation:** Make your AI from this video
- **Note:** none

---

## File 4 of 6: `IngestChannelStudio.tsx`

The channel-watch enrollment lane; writes to the SAME `vy_channel_attestation`
table as File 3. `statement_set: channel-ownership-attestation/v1`,
`policy_version: replica-self-v1`. 12 rows.

**R42.** `IngestChannelStudio.tsx:181` (ceremony heading, h2)
- **EN:** Learn from your own channel
- **HI (प्रस्तावित):** अपने ही चैनल से सीखें
- **Back-translation:** Learn from your own channel
- **Note:** none

**R43.** `IngestChannelStudio.tsx:183` (context, intro)
- **EN:** Your own lectures are the best material there is for your AI: your explanations, your examples, your phrasing. Point us at your channel and we will keep learning from it as you upload. Nothing is published from it without your review.
- **HI (प्रस्तावित):** आपके अपने लेक्चर आपके AI के लिए सबसे अच्छी सामग्री हैं: आपकी समझाने की शैली, आपके उदाहरण, आपके अपने शब्द। हमें अपना चैनल बताएं और आप जैसे-जैसे अपलोड करेंगे, हम उससे सीखते रहेंगे। आपकी समीक्षा के बिना इससे कुछ भी पब्लिश नहीं होता।
- **Back-translation:** Your own lectures are the best material for your AI: your way of explaining, your examples, your own words. Tell us your channel and as you keep uploading, we will keep learning from it. Nothing from it gets published without your review.
- **Note:** none

**R44.** `IngestChannelStudio.tsx:207` (ceremony heading, legend)
- **EN:** Confirm this channel is yours
- **HI (प्रस्तावित):** पुष्टि करें कि यह चैनल आपका है
- **Back-translation:** Confirm that this channel is yours
- **Note:** none

**R45.** `IngestChannelStudio.tsx:208` (context, intro under legend)
- **EN:** We only ever build an AI of the person who asked for it. Before we read a single video we need you to confirm, on the record, that this channel is yours. All five apply.
- **HI (प्रस्तावित):** हम हमेशा सिर्फ़ उसी व्यक्ति का AI बनाते हैं जिसने खुद इसके लिए कहा हो। एक भी वीडियो पढ़ने से पहले हमें रिकॉर्ड पर आपकी पुष्टि चाहिए कि यह चैनल आपका है। सभी पांचों बातें लागू होती हैं।
- **Back-translation:** We always only build the AI of the person who themself asked for it. Before we read even one video we need your confirmation on record that this channel is yours. All five points apply.
- **Note:** none

**R46.** `IngestChannelStudio.tsx:41` (consent statement, key `owns_or_controls_channel`)
- **EN:** This YouTube channel is mine. I own it or I control it.
- **HI (प्रस्तावित):** यह YouTube चैनल मेरा है। मैं इसका मालिक हूं या इस पर मेरा नियंत्रण है।
- **Back-translation:** This YouTube channel is mine. I am its owner or I have control over it.
- **Note:** none

**R47.** `IngestChannelStudio.tsx:43` (consent statement, key `is_rights_holder_of_uploads`)
- **EN:** I hold the rights to the videos on it, so I can license their use for my own AI.
- **HI (प्रस्तावित):** इस पर मौजूद वीडियो के अधिकार मेरे पास हैं, इसलिए मैं अपने ही AI के लिए इनके इस्तेमाल की अनुमति दे सकता/सकती हूं।
- **Back-translation:** I hold the rights to the videos on it, so I can permit their use for my own AI.
- **Note:** none

**R48.** `IngestChannelStudio.tsx:45` (consent statement, key `authorizes_audio_extraction_for_own_replica`)
- **EN:** I authorise this platform to take the AUDIO from those videos and use it to build my own AI.
- **HI (प्रस्तावित):** मैं इस प्लेटफ़ॉर्म को उन वीडियो से ऑडियो लेने और अपना ही AI बनाने में इसका इस्तेमाल करने की अनुमति देता/देती हूं।
- **Back-translation:** I authorize this platform to take audio from those videos and use it to build my own AI.
- **Note:** same key-name substitution as R37.

**R49.** `IngestChannelStudio.tsx:47` (consent statement, key `understands_tos_exposure_is_not_copyright_permission`)
- **EN:** I understand that my permission covers copyright, and that downloading from YouTube is separately restricted by YouTube's own Terms. That is a matter between YouTube and the account used, and my permission does not remove it.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि मेरी अनुमति कॉपीराइट को कवर करती है, और YouTube से डाउनलोड करना YouTube की अपनी शर्तों के तहत अलग से सीमित है। यह मामला YouTube और इस्तेमाल किए गए अकाउंट के बीच का है, और मेरी अनुमति इसे नहीं हटाती।
- **Back-translation:** I understand that my permission covers copyright, and downloading from YouTube is separately restricted under YouTube's own terms. That is a matter between YouTube and the account used, and my permission does not remove it.
- **Note:** same YouTube-Terms distinction as R38, this file's own wording of it.

**R50.** `IngestChannelStudio.tsx:49` (consent statement, key `understands_revocation_stops_extraction`)
- **EN:** I understand that withdrawing this permission stops all further extraction immediately.
- **HI (प्रस्तावित):** मैं समझता/समझती हूं कि यह अनुमति वापस लेने से आगे की सारी निकासी तुरंत बंद हो जाती है।
- **Back-translation:** I understand that withdrawing this permission immediately stops all further extraction.
- **Note:** none

**R51.** `IngestChannelStudio.tsx:230` (primary action)
- **EN:** Record this
- **HI (प्रस्तावित):** इसे रिकॉर्ड करें
- **Back-translation:** Record this
- **Note:** none

**R52.** `IngestChannelStudio.tsx:248` (context, withdrawal confirmation notice)
- **EN:** Withdrawn. Nothing further will be read from this channel.
- **HI (प्रस्तावित):** वापस ले लिया गया। अब इस चैनल से आगे कुछ भी नहीं पढ़ा जाएगा।
- **Back-translation:** Withdrawn. Nothing further will be read from this channel now.
- **Note:** none

**R53.** `IngestChannelStudio.tsx:252` (primary action, withdrawal)
- **EN:** Withdraw this permission
- **HI (प्रस्तावित):** यह अनुमति वापस लें
- **Back-translation:** Withdraw this permission
- **Note:** none

---

## File 5 of 6: `LivenessCapture.tsx`

Biometric live face-and-voice capture, gated behind consent + adult ID
evidence, decided by an independent verifier. `statement_set:
biometric-verification-consent/v1`. 17 rows.

**R54.** `LivenessCapture.tsx:395` (ceremony heading, eyebrow)
- **EN:** Live capture
- **HI (प्रस्तावित):** लाइव कैप्चर
- **Back-translation:** Live capture
- **Note:** none

**R55.** `LivenessCapture.tsx:396` (ceremony heading, h3)
- **EN:** Prove this recording was made now
- **HI (प्रस्तावित):** साबित करें कि यह रिकॉर्डिंग अभी बनी है
- **Back-translation:** Prove that this recording was made right now
- **Note:** none

**R56.** `LivenessCapture.tsx:406` (refusal line, blocker heading)
- **EN:** Source permission and adult ID evidence are required first
- **HI (प्रस्तावित):** पहले सोर्स की अनुमति और वयस्क पहचान-पत्र का सबूत चाहिए
- **Back-translation:** First, source permission and adult identity-document evidence are needed
- **Note:** none

**R57.** `LivenessCapture.tsx:406` (refusal line, blocker body)
- **EN:** Record capture and private storage permission, then complete the independent ID evidence step above.
- **HI (प्रस्तावित):** रिकॉर्ड कैप्चर और निजी स्टोरेज की अनुमति दें, फिर ऊपर दिए गए स्वतंत्र पहचान-पत्र सबूत वाले चरण को पूरा करें।
- **Back-translation:** Give recording-capture and private-storage permission, then complete the independent identity-document evidence step above.
- **Note:** none

**R58.** `LivenessCapture.tsx:440` (ceremony heading, legend)
- **EN:** Before any biometric processing
- **HI (प्रस्तावित):** किसी भी बायोमेट्रिक प्रोसेसिंग से पहले
- **Back-translation:** Before any biometric processing
- **Note:** none

**R59.** `LivenessCapture.tsx:443` (consent statement, key `live_face_and_voice_processing`)
- **EN:** Process my live face and voice only to verify this private, self-only AI.
- **HI (प्रस्तावित):** मेरे लाइव चेहरे और आवाज़ को सिर्फ़ इस निजी, सिर्फ़-अपने-लिए बनाए गए AI को सत्यापित करने के लिए प्रोसेस करें।
- **Back-translation:** Process my live face and voice only to verify this private, self-only AI.
- **Note:** none

**R60.** `LivenessCapture.tsx:444` (consent statement, key `compare_face_to_my_id`)
- **EN:** Compare my live face with the government ID I submitted.
- **HI (प्रस्तावित):** मेरे लाइव चेहरे की तुलना उस सरकारी पहचान-पत्र से करें जो मैंने जमा किया।
- **Back-translation:** Compare my live face with the government identity-document I submitted.
- **Note:** none

**R61.** `LivenessCapture.tsx:445` (consent statement, key `anti_spoof_and_synthetic_detection`)
- **EN:** Run replay, synthetic-media, and single-speaker checks on this attempt.
- **HI (प्रस्तावित):** इस कोशिश पर रीप्ले, सिंथेटिक-मीडिया, और सिर्फ़-एक-वक्ता जांच चलाएं।
- **Back-translation:** Run replay, synthetic-media, and single-speaker checks on this attempt.
- **Note:** none

**R62.** `LivenessCapture.tsx:446` (consent statement, key `erase_raw_and_provider_session`)
- **EN:** Erase raw verification media and the provider session after the decision.
- **HI (प्रस्तावित):** फ़ैसले के बाद कच्चा सत्यापन मीडिया और प्रोवाइडर सेशन मिटा दें।
- **Back-translation:** After the decision, erase the raw verification media and the provider session.
- **Note:** none

**R63.** `LivenessCapture.tsx:447` (consent statement, key `self_only_private_replica`)
- **EN:** This is me, I am an adult, and my AI will remain private and disclosed as synthetic.
- **HI (प्रस्तावित):** यह मैं हूं, मैं वयस्क हूं, और मेरा AI निजी रहेगा और खुद को सिंथेटिक बताता रहेगा।
- **Back-translation:** This is me, I am an adult, and my AI will stay private and will keep disclosing itself as synthetic.
- **Note:** source key name says "replica"; rendered as "AI" per the platform's own vocabulary rule, same substitution as R6/R37/R48.

**R64.** `LivenessCapture.tsx:185` (refusal line, validation)
- **EN:** Confirm every narrow biometric verification statement before requesting a challenge.
- **HI (प्रस्तावित):** चुनौती मांगने से पहले हर सीमित बायोमेट्रिक सत्यापन कथन की पुष्टि करें।
- **Back-translation:** Before requesting a challenge, confirm every limited biometric verification statement.
- **Note:** none

**R65.** `LivenessCapture.tsx:421` (primary action, withdrawal)
- **EN:** Withdraw verification and erase evidence
- **HI (प्रस्तावित):** सत्यापन वापस लें और सबूत मिटाएं
- **Back-translation:** Withdraw verification and erase evidence
- **Note:** none

**R66.** `LivenessCapture.tsx:474` (primary action, cancel)
- **EN:** Cancel and erase this attempt
- **HI (प्रस्तावित):** इस कोशिश को रद्द करें और मिटाएं
- **Back-translation:** Cancel and erase this attempt
- **Note:** none

**R67.** `LivenessCapture.tsx:461` (primary action)
- **EN:** Request live phrase
- **HI (प्रस्तावित):** लाइव वाक्यांश मांगें
- **Back-translation:** Request live phrase
- **Note:** none

**R68.** `LivenessCapture.tsx:485` (context, data-flow disclosure)
- **EN:** Azure hosts a single-use camera check. Vyakti receives only the bounded live/not-live and same-person decision. The one-time link is never durably stored; a short volatile retry cache expires with the authorization. An encrypted recovery credential exists only until confirmed provider deletion, which must complete before capture unlocks.
- **HI (प्रस्तावित):** Azure एक बार इस्तेमाल होने वाली कैमरा जांच होस्ट करता है। Vyakti को सिर्फ़ सीमित लाइव/नॉट-लाइव और वही-व्यक्ति वाला फ़ैसला मिलता है। एक बार वाला लिंक कभी स्थायी रूप से सेव नहीं होता; एक छोटा, अस्थायी रीट्राई कैश अनुमति के साथ ही खत्म हो जाता है। एक एन्क्रिप्टेड रिकवरी क्रेडेंशियल तब तक ही रहता है जब तक प्रोवाइडर से मिटाने की पुष्टि नहीं हो जाती, जो कैप्चर अनलॉक होने से पहले पूरी होनी चाहिए।
- **Back-translation:** Azure hosts a single-use camera check. Vyakti only gets the limited live/not-live and same-person decision. The one-time link is never stored permanently; a short, temporary retry cache expires along with the authorization. An encrypted recovery credential exists only until deletion is confirmed by the provider, which must complete before capture unlocks.
- **Note:** third-party data flow disclosure (Azure); worth a lawyer's read regardless of translation quality, since it is describing what a third-party processor does with biometric data.

**R69.** `LivenessCapture.tsx:508` (context, privacy assurance)
- **EN:** Nothing uploads when permission opens. Capture stays only in this browser until you review it and choose Upload. Device tracks close after recording.
- **HI (प्रस्तावित):** अनुमति खुलने पर कुछ भी अपलोड नहीं होता। कैप्चर सिर्फ़ इसी ब्राउज़र में तब तक रहता है जब तक आप इसे देखकर Upload नहीं चुनते। रिकॉर्डिंग के बाद डिवाइस ट्रैक बंद हो जाते हैं।
- **Back-translation:** Nothing uploads when permission opens. The capture stays only in this browser until you review it and choose Upload. Device tracks close after recording.
- **Note:** none

**R70.** `LivenessCapture.tsx:569` (boundary line)
- **EN:** Live evidence is not a verifier result. Only the independent server verifier can mark this challenge as passed.
- **HI (प्रस्तावित):** लाइव सबूत कोई सत्यापनकर्ता का नतीजा नहीं है। सिर्फ़ स्वतंत्र सर्वर सत्यापनकर्ता ही इस चुनौती को पास किया हुआ मान सकता है।
- **Back-translation:** Live evidence is not a verifier's result. Only the independent server verifier can mark this challenge as passed.
- **Note:** none

---

## File 6 of 6: `VoiceIdentityChallenge.tsx`

The WS-R2 voice+face identity re-check band, behind `VOICE_IDENTITY_CHALLENGE`
(default off). No checkbox array of its own (see Methodology, category 5); its
`REASON` map is this file's refusal-line data structure. `policy_version:
voice-identity-challenge/v1`. 18 rows.

**R71.** `VoiceIdentityChallenge.tsx:407` (ceremony heading, eyebrow)
- **EN:** Prove it is you
- **HI (प्रस्तावित):** साबित करें कि यह आप ही हैं
- **Back-translation:** Prove that this is you
- **Note:** none

**R72.** `VoiceIdentityChallenge.tsx:408` (ceremony heading, h3)
- **EN:** Read this sentence out loud, on camera
- **HI (प्रस्तावित):** इस वाक्य को कैमरे के सामने ज़ोर से पढ़ें
- **Back-translation:** Read this sentence out loud in front of the camera
- **Note:** none

**R73.** `VoiceIdentityChallenge.tsx:456` (context, intro)
- **EN:** We give you a sentence, you read it out loud on camera, and we check two things: that the voice is the one already enrolled on this account, and that you read today's sentence rather than playing an old recording. It takes about ten seconds. The recording is deleted once the check has run, whatever the answer.
- **HI (प्रस्तावित):** हम आपको एक वाक्य देते हैं, आप उसे कैमरे के सामने ज़ोर से पढ़ते हैं, और हम दो बातें जांचते हैं: कि आवाज़ वही है जो पहले से इस अकाउंट पर दर्ज है, और कि आपने आज का वाक्य पढ़ा है, कोई पुरानी रिकॉर्डिंग नहीं चलाई। इसमें करीब दस सेकंड लगते हैं। जांच होने के बाद रिकॉर्डिंग मिटा दी जाती है, चाहे नतीजा कुछ भी हो।
- **Back-translation:** We give you a sentence, you read it out loud in front of the camera, and we check two things: that the voice is the one already registered on this account, and that you read today's sentence rather than playing an old recording. It takes about ten seconds. Once the check has run, the recording is deleted, whatever the result.
- **Note:** none

**R74.** `VoiceIdentityChallenge.tsx:585` (boundary line)
- **EN:** A recording is not a result. Only the server check can mark this as verified, and it decides on your voice and on the words you read, never on your face.
- **HI (प्रस्तावित):** रिकॉर्डिंग कोई नतीजा नहीं है। सिर्फ़ सर्वर की जांच ही इसे सत्यापित मान सकती है, और यह आपकी आवाज़ और आपके पढ़े गए शब्दों पर फ़ैसला करती है, कभी आपके चेहरे पर नहीं।
- **Back-translation:** A recording is not a result. Only the server check can mark this as verified, and it decides based on your voice and the words you read, never on your face.
- **Note:** none

**R75.** `VoiceIdentityChallenge.tsx:431` (context, result disclosure)
- **EN:** The recording was compared with the voice already on this account and then deleted. This check covers identity and the live anti-replay check. Age is verified separately.
- **HI (प्रस्तावित):** रिकॉर्डिंग की तुलना इस अकाउंट पर पहले से मौजूद आवाज़ से की गई और फिर मिटा दी गई। यह जांच पहचान और लाइव एंटी-रीप्ले जांच को कवर करती है। उम्र अलग से सत्यापित होती है।
- **Back-translation:** The recording was compared with the voice already present on this account and then deleted. This check covers identity and the live anti-replay check. Age is verified separately.
- **Note:** none

**R76.** `VoiceIdentityChallenge.tsx:443` (context, waiting disclosure)
- **EN:** Your recording is in private storage and has granted nothing. We compare it with the voice already on this account and check that you read today's sentence. This usually takes a few minutes, and it can take longer if our voice service is starting up. You can leave this page open.
- **HI (प्रस्तावित):** आपकी रिकॉर्डिंग निजी स्टोरेज में है और अभी तक इससे कुछ भी अनुमति नहीं मिली है। हम इसकी तुलना इस अकाउंट पर पहले से मौजूद आवाज़ से करते हैं और जांचते हैं कि आपने आज का वाक्य पढ़ा। इसमें आमतौर पर कुछ मिनट लगते हैं, और अगर हमारी वॉइस सेवा अभी शुरू हो रही हो तो इसमें ज़्यादा समय लग सकता है। आप इस पेज को खुला छोड़ सकते हैं।
- **Back-translation:** Your recording is in private storage and has not granted anything yet. We compare it with the voice already on this account and check that you read today's sentence. This usually takes a few minutes, and if our voice service is starting up it can take longer. You can leave this page open.
- **Note:** none

**R77.** `VoiceIdentityChallenge.tsx:72` (refusal line, `REASON.spoken_code_missing`)
- **EN:** The spoken code did not come through / Say the six digits one at a time, clearly, at the end of the sentence. Get a new sentence and try again.
- **HI (प्रस्तावित):** बोला गया कोड नहीं पहुंचा / छह अंकों को एक-एक करके, साफ़-साफ़, वाक्य के आखिर में बोलें। नया वाक्य लें और फिर से कोशिश करें।
- **Back-translation:** The spoken code didn't arrive / Say the six digits one by one, clearly, at the end of the sentence. Get a new sentence and try again.
- **Note:** none

**R78.** `VoiceIdentityChallenge.tsx:76` (refusal line, `REASON.sentence_not_read`)
- **EN:** The sentence did not come through / Read every word exactly as shown, at your normal speaking pace, somewhere quiet. Get a new sentence and try again.
- **HI (प्रस्तावित):** वाक्य ठीक से नहीं पहुंचा / हर शब्द को ठीक वैसे ही पढ़ें जैसे दिखाया गया है, अपनी सामान्य रफ़्तार में, किसी शांत जगह पर। नया वाक्य लें और फिर से कोशिश करें।
- **Back-translation:** The sentence didn't come through properly / Read every word exactly as shown, at your normal pace, in a quiet place. Get a new sentence and try again.
- **Note:** none

**R79.** `VoiceIdentityChallenge.tsx:80` (refusal line, `REASON.voice_did_not_match`)
- **EN:** This did not sound like your enrolled voice / Use the same microphone and room you enrolled with if you can, and keep background noise down. Get a new sentence and try again.
- **HI (प्रस्तावित):** यह आपकी दर्ज की गई आवाज़ जैसा नहीं लगा / अगर हो सके तो वही माइक्रोफ़ोन और कमरा इस्तेमाल करें जिससे आपने दर्ज कराया था, और पीछे का शोर कम रखें। नया वाक्य लें और फिर से कोशिश करें।
- **Back-translation:** This didn't sound like your enrolled voice / If possible use the same microphone and room you enrolled with, and keep background noise low. Get a new sentence and try again.
- **Note:** none

**R80.** `VoiceIdentityChallenge.tsx:84` (refusal line, `REASON.reference_evidence_insufficient`)
- **EN:** There is not enough enrolled voice to compare against / This one is on us. Add more of your own audio in the first step, let it finish processing, then come back.
- **HI (प्रस्तावित):** तुलना के लिए दर्ज आवाज़ का सबूत काफ़ी नहीं है / यह हमारी तरफ़ से है। पहले चरण में अपनी और ऑडियो जोड़ें, उसे पूरी तरह प्रोसेस होने दें, फिर वापस आएं।
- **Back-translation:** There isn't enough enrolled-voice evidence to compare against / This one is on us. Add more of your own audio in the first step, let it finish processing, then come back.
- **Note:** "This one is on us" (AGENTS.md's "waiting on us" honesty split) is kept as an explicit statement that the platform, not the person, is the blocker.

**R81.** `VoiceIdentityChallenge.tsx:88` (refusal line, `REASON.challenge_expired`)
- **EN:** That sentence expired / Sentences are good for three minutes. Get a new one and record straight away.
- **HI (प्रस्तावित):** वह वाक्य की समय-सीमा खत्म हो गई / वाक्य तीन मिनट तक मान्य रहते हैं। नया वाक्य लें और तुरंत रिकॉर्ड करें।
- **Back-translation:** That sentence's time limit ran out / Sentences remain valid for three minutes. Get a new one and record right away.
- **Note:** none

**R82.** `VoiceIdentityChallenge.tsx:92` (refusal line, `REASON.challenge_evidence_deleted`)
- **EN:** That recording was deleted before it was checked / Get a new sentence and record again.
- **HI (प्रस्तावित):** वह रिकॉर्डिंग जांचे जाने से पहले ही मिटा दी गई / नया वाक्य लें और फिर से रिकॉर्ड करें।
- **Back-translation:** That recording was deleted even before it was checked / Get a new sentence and record again.
- **Note:** none

**R83.** `VoiceIdentityChallenge.tsx:96` (refusal line, `REASON.owner_cancelled`)
- **EN:** You cancelled that attempt / Get a new sentence whenever you are ready.
- **HI (प्रस्तावित):** आपने वह कोशिश रद्द कर दी / जब भी आप तैयार हों, नया वाक्य ले लें।
- **Back-translation:** You cancelled that attempt / Whenever you're ready, get a new sentence.
- **Note:** none

**R84.** `VoiceIdentityChallenge.tsx:100` (refusal line, `REASON.challenge_superseded`)
- **EN:** That sentence was replaced by a newer one / Read the sentence shown above.
- **HI (प्रस्तावित):** वह वाक्य एक नए वाक्य से बदल दिया गया / ऊपर दिखाया गया वाक्य पढ़ें।
- **Back-translation:** That sentence was replaced by a new sentence / Read the sentence shown above.
- **Note:** none

**R85.** `VoiceIdentityChallenge.tsx:481` (primary action)
- **EN:** Get my sentence
- **HI (प्रस्तावित):** मेरा वाक्य लें
- **Back-translation:** Get my sentence
- **Note:** none

**R86.** `VoiceIdentityChallenge.tsx:449` (primary action, cancel, pending state)
- **EN:** Cancel this attempt and delete the recording
- **HI (प्रस्तावित):** इस कोशिश को रद्द करें और रिकॉर्डिंग मिटाएं
- **Back-translation:** Cancel this attempt and delete the recording
- **Note:** none

**R87.** `VoiceIdentityChallenge.tsx:496` (primary action, cancel, in-progress state)
- **EN:** Cancel and delete this attempt
- **HI (प्रस्तावित):** इस कोशिश को रद्द करें और मिटाएं
- **Back-translation:** Cancel and delete this attempt
- **Note:** none

**R88.** `VoiceIdentityChallenge.tsx:503` (context, privacy assurance)
- **EN:** Nothing uploads when the camera opens. The recording stays in this browser until you review it and choose to send it. The camera and microphone close as soon as you stop.
- **HI (प्रस्तावित):** कैमरा खुलने पर कुछ भी अपलोड नहीं होता। रिकॉर्डिंग सिर्फ़ इसी ब्राउज़र में तब तक रहती है जब तक आप इसे देखकर भेजना नहीं चुनते। रोकते ही कैमरा और माइक्रोफ़ोन बंद हो जाते हैं।
- **Back-translation:** Nothing uploads when the camera opens. The recording stays only in this browser until you review it and choose to send it. As soon as you stop, the camera and microphone close.
- **Note:** none

---

## Coverage

88 rows across six files, six ceremonies, four `statement_set` ids (one
shared by two files) and three `policy_version` ids. Every consent statement
and checkbox label the six files render (26 of them: 6 + 5 + 5 + 5 + 5 + 0) is
covered, along with every ceremony heading, legend, primary action and
boundary/refusal line the Methodology section defines as in scope, plus the
file 6 `REASON` map's 8 title/note pairs standing in for its checkbox array.
`evals/consent-review/run.mjs` re-extracts every one of those categories from
the live six files on every run and asserts it appears in this document's
English column; see that file's own header for exactly which structural
anchor each extraction rule targets.

**What needs a lawyer, specifically:**

- R8 (`ModelConsentGate.tsx`, "training or adaptation of a voice model") and
  R7 (the same file, "voice embeddings"): the Hindi is a functional
  paraphrase because the product's own vocabulary law bans the literal words.
  Confirm the paraphrase does not narrow what a person is taken to have
  consented to.
- R11, R63: the same substitution ("replica" to "AI", "derived models" to
  "anything built from it"), lower stakes than R7/R8 but flagged for the same
  reason.
- R68: the Azure third-party data-flow disclosure. Independent of translation
  quality, confirm the English original itself still accurately describes
  what the current Azure integration does before the Hindi ships.
- R13, R28: the typed confirmation codes (PAUSE AI, ERASE ID) staying in
  English inside a Hindi sentence. Confirm this is acceptable, or specify a
  Hindi phrase that should be typed instead.
- Every row's gender-neutral `करता/करती हूं` construction: confirm this reads
  naturally rather than legally overcautious to a Hindi-reading person signing
  a real consent form.
