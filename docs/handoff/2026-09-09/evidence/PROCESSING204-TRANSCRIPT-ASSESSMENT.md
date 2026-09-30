# Processing204 synthetic Hindi transcript assessment

Date: 2026-09-09. Sample size: one synthetic source, two stored transcript
spans. This assesses ASR text only, not speaker likeness or voice quality.

## Authored reference

> नमस्ते, आज हम एक छोटे विचार पर बात करेंगे। जब कोई छात्र कठिन सवाल से घबराता है, तो पहले उसकी उलझन समझना जरूरी है। हम सवाल को छोटे हिस्सों में बाँटेंगे, एक सरल उदाहरण देखेंगे, और फिर सही तरीका चुनेंगे। गलती सीखने का हिस्सा है। उसे छिपाने की जरूरत नहीं। नियमित अभ्यास से धीरे धीरे आत्मविश्वास बनता है।

## Stored ASR spans in readback order

> उसे छिपाने की जरूरत नहीं। नियमित अभ्यास से धीरेधीरे आत्मविश्वास बनता है। नमस्ते, आज हम एक छोटे विचार पर बात करेंगे। जब कोई छात्र कठिन सवाल से घबराता है तो पहले उसकी उलझन समझना ज़रूरी है। हम सवाल को छोटे हिस्सों में बांटेंगे, एक सरल उदाहरण देखेंगे और फिर सही तरीका चुनेंगे। गलती सीखने का हिस्सा है।

Both stored spans identify their language as `hi-IN`. The authored text has 58
whitespace-delimited words and the ASR output has 57 because `धीरे धीरे` became
`धीरेधीरे`. Unordered exact-token recall is 54/58 (93.1%). Every mismatch is
accounted for by three Hindi orthographic or segmentation variants:

- `जरूरी` became `ज़रूरी`.
- `बाँटेंगे` became `बांटेंगे`.
- `धीरे धीरे` became `धीरेधीरे`.

After normalizing only those equivalent forms, the reference and ASR token
multisets are identical: 58/58, with no omitted or invented lexical item found.
The two stored spans were concatenated in database creation/UUID order for this
readback, so the resulting sequence moves the last two reference sentences to
the front. The resulting raw sequence word error rate is 27/58 (46.6%), but it
must not be interpreted as ASR omission or substitution accuracy because this
query did not order spans by their audio offsets.

The source-scoped read used `BEGIN READ ONLY`, verified the development database
and `transaction_read_only=on`, executed seven SQL statements, then received
ROLLBACK and connection-close acknowledgements. It made zero blob and model
calls. Receipt: `processing204-transcript-readonly-result.json` SHA-256
`50f3aa105206cb198224e9aad1021641f5b83d1bf6b7335e17ac8d63898fbcd1`.
