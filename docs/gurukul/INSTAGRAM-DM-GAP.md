# INSTAGRAM-DM-GAP.md — why there is no Instagram adapter, and what it would take

**Status: NOT BUILT. Deliberately.** `instagram_dm` exists in migration 055's
`kind` domain and is absent from `CONNECTABLE_KINDS` in
`api/_clonechannel.js`, so a row can be stored and a channel cannot be
connected. The studio's Channels screen shows the surface with the blockers
written out instead of a button.

This file is the honest record of what stands in the way. It was written from
Meta's own current documentation plus the 2026 integration write-ups, verified
in August 2026 — not from memory and not from what the API looked like when
`api/whatsapp.js` was scaffolded.

Two rules govern why this is a document and not code:

- **`dead-writers`.** An adapter nothing can reach is indistinguishable from an
  adapter that does not work. Shipping `api/instagram.js` against credentials
  that cannot exist would put a file in the tree that nobody can prove, and
  the first person to read it would reasonably assume it had been.
- **The product promise.** A teacher who sees "Instagram" in a Channels list
  believes their audience can reach them there. If it cannot, we have told a
  paying customer something false in the most expensive possible place.

---

## 1. What Instagram DM actually requires (2026)

### The permission

| login type | permission | endpoint host |
|---|---|---|
| Instagram Login | `instagram_business_manage_messages` | `graph.instagram.com` |
| Facebook Login for Business | `instagram_manage_messages` + `pages_show_list` + `pages_read_engagement` | `graph.facebook.com` |

The two are not variants of one integration: they issue different token types
against different hosts, and Facebook Login additionally requires each
teacher's Instagram professional account to be linked to a Facebook Page. The
permission has also been renamed (`instagram_manage_messages` →
`instagram_business_manage_messages` in the newer docs), which is worth
recording because a search for the old name still returns guides written
against a flow that has moved.

### The access level, which is the actual blocker

- **Standard Access** works only for accounts that have a role on our app. It
  is enough to build against 25 test users and nothing more.
- **Advanced Access** is required "if your app serves Instagram professional
  accounts that you don't own or manage" — which is the literal description of
  this product: every account is a teacher's, none is ours.

Advanced Access is granted only through **App Review**, and App Review
requires, together:

1. **Meta Business Verification** — official business documents for a real
   legal entity (registration, address, phone, website), reviewed by Meta.
2. **A Live-mode app**, not a development-mode one.
3. **A published privacy policy URL** and a working **data-deletion path**.
4. **A screencast** demonstrating the integration doing exactly what the
   permission is being requested for, recorded against a working build.
5. **A written justification** per permission. Messaging permissions are
   reported as taking longer and needing more justification than read-only
   ones.

Reported turnaround: **weeks to months**, and it is a review of *us*, granted
per app — not something an individual teacher can complete on their own behalf.

### The messaging window

Free-form replies are allowed within **24 hours** of the person's last message.
Beyond it, the only extension is the **`human_agent` tag**, which buys 7 days
and which Meta restricts explicitly to messages sent by **a real human, not an
automated system**, with detection on their side for misuse.

That restriction is decisive for this product and it is not a technicality: an
AI clone answering after 24 hours under `human_agent` would be exactly the
misuse the tag names. So the honest shape of an Instagram lane here is
**inbound-triggered, inside 24 hours, or silent** — the same posture
`api/whatsapp.js` already takes for the Cloud API window, where `send()`
refuses rather than substituting a template.

---

## 2. What it would cost us, in order

| # | blocker | who can clear it | code we would write |
|---|---|---|---|
| 1 | Meta Business Verification for the operating entity | the owner, with company documents | none |
| 2 | A Meta app in Live mode with privacy policy + deletion endpoint | mostly done — `api/replica-erasure-sweep.js` and the privacy page exist | a public data-deletion callback in Meta's format |
| 3 | Advanced Access for the messaging permission, via App Review | Meta, on our submission | none |
| 4 | Per-teacher OAuth (Instagram Login or Facebook Login for Business) | each teacher, in the studio | an OAuth flow + a per-teacher token in `api/_channel-secrets.js` under a `credentials_ref` |
| 5 | The adapter itself | us | `api/instagram.js` — the four functions, ~200 lines, mirroring `api/whatsapp.js` |

**Item 5 is the small one.** The adapter is the least of this, and that is the
finding worth carrying: the Instagram gap is an approvals and identity
problem, not an engineering one, and no amount of building shortens it.

Once items 1–4 exist, the binding layer already built here needs **no change**:
`vy_clone_channel` already stores `instagram_dm`, `resolveInboundClone` already
routes on `(kind, external_ref)`, `api/_channel-secrets.js` already holds a
per-teacher token behind a uuid reference, and `api/_surface.js` already
answers as whichever clone `ctx.agent` names. Adding Instagram is then adding
`instagram_dm` to `CONNECTABLE_KINDS` and writing the four functions.

---

## 3. The WhatsApp reality check, recorded here because it moved too

`api/whatsapp.js`'s header was written when a WhatsApp integration meant "get a
WABA and a phone number". As of 2026 that is no longer the onboarding path for
a platform like this one:

- **Tech Provider enrolment is mandatory** for an ISV offering WhatsApp
  messaging to other businesses, and **Embedded Signup is the default path**
  for new onboardings — a Meta-hosted popup, powered by Facebook Login for
  Business, that runs inside our studio.
- Business verification, Commerce Policy review, phone-number checks and
  template categorisation all happen **inside that flow**, on Meta's side.
- Per-customer phone-number selection must be settled **before** the teacher
  starts the flow.
- Meta Business Verification is not required for initial testing, but is
  required for higher messaging limits and several business features.
- Coexistence now allows an eligible business to keep using the WhatsApp
  Business app on a number that is also connected to the Cloud API — which
  matters, because "I would lose WhatsApp on my own phone" is the objection an
  individual teacher actually raises.

**What that means for what shipped here.** The `whatsapp` kind in the studio
collects a `phone_number_id` and an access token, which is the correct shape
for a teacher who has *already* been through Embedded Signup or who runs their
own WABA. It is NOT the self-serve flow, and the Channels screen says so in
the surface's cost line rather than implying otherwise. Making WhatsApp truly
self-serve is Tech Provider enrolment plus an Embedded Signup integration — a
separate, owner-blocked workstream of roughly the same shape as items 1–4
above, and it is why the web widget is listed first on that screen.

---

## 4. What is genuinely self-serve today

| surface | approval needed | time to live |
|---|---|---|
| **Web widget / embed** | none | one paste |
| **Telegram** | none — the teacher makes a bot in @BotFather and registers one webhook URL | minutes |
| WhatsApp | Meta business verification + WABA (or our Tech Provider enrolment) | days to weeks |
| Instagram DM | everything in §2 | weeks to months, ours to clear, not theirs |

This ordering is the reason the widget was built first and built completely: it
is the only one of the four where "an expert publishes a clone and puts it in
front of their audience, self-serve, without us writing code per customer" is
true today rather than after somebody else's review queue.

---

## Sources

- [Overview of the Instagram API — Meta for Developers](https://developers.facebook.com/docs/instagram-platform/overview/)
- [Send Messages — Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Instagram Messaging API Approval Guide (2026)](https://singhamandeep.com/instagram-messaging-api-approval-getting-instagram_business_manage_messages-2026/)
- [Instagram Messaging API 24-Hour Window Policy: The Complete Guide (2026)](https://www.keyapi.ai/blog/instagram-messaging-api-policy/)
- [How to Integrate the Instagram Messaging API: 2 ways in 2026](https://zernio.com/blog/instagram-messaging-api)
- [Embedded Signup — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Become a Tech Provider — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Business phone numbers — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)
