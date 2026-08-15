# Track: whatsapp-platform — GTM reality check for WhatsApp-first multiparty distribution

Owner's thesis under test (`context/decisions.md#multiparty-direction`): distribution
begins on WhatsApp groups/communities, with the reversal condition reading —
*"the WhatsApp platform track shows bots in user groups are infeasible or
ban-bait under the Business API (then distribution pivots to app-first or
another surface)."*

## Verdict, stated plainly

**Partial reversal, not full reversal — but the specific thing the decision log
describes ("she participates in the group's shared space," implying the
group the humans already have) is not what shipped.** As of October 2025 the
WhatsApp Cloud API does support programmatic group messaging for the first
time ever — this overturns the historical "no group API" assumption the brief
asked me to check. But the Groups API only lets a business **create its own
new group and invite people into it**. There is no endpoint, and no path, for
an official Business API number to be **added to a group the users already
have** (their existing family/couple/friend-circle chat). That capability
exists on WhatsApp today — but only for Meta's own first-party Meta AI, which
any user can add to any of their own groups via `@Meta AI`. Third-party
businesses do not get that privilege; they get "spin up your own room and
invite people into it" instead.

So: **WhatsApp groups are officially feasible for a *Meera creates the group*
product shape** (a "Meera & the crew" room, cap 8 people, she's the host).
**They are not feasible, officially, for the *Meera joins your group* product
shape** implied by "common friend to a group" — which is the more natural
reading of "she participates in the group's shared space." That distinction
should go back to the owner explicitly; it changes what "WhatsApp-first" means
in practice, not whether it's possible at all.

Going the unofficial route (Baileys/whatsapp-web.js) to get the "joins your
real group" behavior trades that constraint for real, measured ban risk on
exactly the proactive-messaging pattern a chatty companion needs (see below).
That is genuinely ban-bait for this specific use case, even though low-volume
reactive bots survive much better.

---

## 1. WhatsApp Cloud API Groups API — what actually exists today

**Launched October 6, 2025** (per multiple trade-press/integrator sources,
consistent dating) as a genuinely new capability — this is the "historically:
no group messaging" premise being partially overturned, and worth flagging as
a fast-moving fact under continuous re-verification, not a settled platform
primitive with years of track record.

Confirmed via Meta's own developer documentation
(developers.facebook.com/documentation/business-messaging/whatsapp/groups and
…/groups/reference, fetched directly):

- **Business creates the group, not the reverse.** `POST
  /<BUSINESS_PHONE_NUMBER_ID>/groups` creates a new group and an invite link;
  the business shares that link (typically via an approved template) and
  people opt in. **There is no `join` endpoint and no `leave` endpoint** —
  confirmed absent from the full endpoint reference. A second, independent
  search corroborates this from the ecosystem side: *"WhatsApp API accounts
  cannot join Groups API created by another API contact"* and *"each group can
  include only 1 WhatsApp API contact."* [developers.facebook.com;
  islash.io/user-guide/groups-api — secondary, corroborating]
- **Participant cap: 8** per group. Up to 10,000 groups per business phone
  number (i.e., you can host many separate 8-person rooms, not one big room).
  [developers.facebook.com, corroborated by Unipile/imBee/Sanuker integrator
  writeups]
- **Message types**: plain text, media, and template-based (text/media)
  messages. **Explicitly unsupported inside groups**: voice/video calling,
  disappearing messages, view-once media, authentication messages, commerce
  messages, and **interactive messages (buttons/lists)**. No message edit or
  delete once sent. [developers.facebook.com, direct fetch]
- **Eligibility**: requires an **Official Business Account (OBA)** — not
  available to WhatsApp Business app numbers or numbers on
  Multi-solution-Conversations. [developers.facebook.com, direct fetch]
  - **Conflicting secondary claim, flagged as thin and unresolved**: several
    blog/integrator sources (chatarmin.com and others) state Groups API access
    additionally requires **100,000+ business-initiated conversations in a
    rolling 24h window** — a tier that would put this out of reach for an
    early-stage product entirely. Other sources say this threshold "does not
    appear anywhere in Meta's official documentation" and that OBA alone is
    sufficient. I could not resolve this discrepancy from Meta's own docs in
    the time available — **this needs a direct check with a Meta Business
    Partner / BSP before the GTM plan leans on it**, because if the volume
    threshold is real it is a harder gate than OBA status itself.
- **OBA itself is not automatic**: requires 30+ days on the platform, business
  verification, two-step verification, an approved display name, and — the
  part that actually bites a companion-app startup — Meta's own notability
  bar: *"must represent a notable, well-known, and frequently searched for
  business, brand, or entity,"* assessed via press coverage. Meeting the
  checklist does not guarantee approval; the decision is Meta's. [multiple
  BSP docs — 360dialog, indigitall, Meta's own OBA documentation page,
  broadly consistent]

## 2. Pricing — the part that breaks the "she's chatty" persona goal

- Meta moved the whole platform from per-conversation to **per-message**
  pricing on **July 1, 2025**.
- **Group messages are billed per delivered recipient, not per group send.**
  A message sent once into an 8-person group that delivers to all 8 is billed
  as **8 separate messages** at that category's per-recipient rate in that
  recipient's country. [corroborated across several integrator pricing
  writeups describing this mechanic identically with worked examples — no
  single primary Meta pricing page confirms the group-specific multiplier in
  the fetches I ran, so treat the *mechanism* as well-corroborated secondary
  evidence, not primary-sourced]
- **India rates** (per-message, one representative source; a second source
  gives ~24% higher figures — treat as an approximate band, not an exact
  number): Marketing ≈ ₹0.88–1.09, Utility ≈ ₹0.13–0.145, Authentication ≈
  same as utility. Plus 18% GST on top of both Meta's charge and any BSP
  platform fee.
- **Session/service replies inside the 24h window are free today but stop
  being free on October 1, 2026** — after that date, service replies and
  utility messages inside the window bill at the utility rate. Given today's
  date (2026-08-15 per system context) this change lands inside any near-term
  launch runway and should be modeled as "no free lane" from day one, not as
  a future risk.
- **What this means for a chatty persona in an 8-person group**: at even a
  conservative 20 Meera-initiated turns/day into a full 8-person group, post
  Oct-2026 pricing is 20 × 8 × ₹0.13 ≈ ₹20.8/day/group just in utility-rate
  session messages — before any marketing-category outreach, before any
  template-triggered re-engagement outside the window, and before per-1:1
  costs for each member's private thread with her. This scales linearly with
  group headcount (fixed at ≤8) and message frequency, and is a real,
  non-trivial unit-economics input the architecture side should have, not
  just a policy footnote.

## 3. The 24-hour window, inside a group

- Corroborated across several integrator explainers (not independently
  confirmed against a single Meta primary page in this pass — flagged): any
  inbound message from **any** group member refreshes a shared 24h window for
  the whole group. Inside the window, free-form text/media is allowed; outside
  it, only pre-approved templates can be sent, and those sends are billable.
  Given real friend/family groups are typically active, the window likely
  stays open in practice most of the time — this is a genuine mitigant against
  the "template-only, can't be spontaneous" failure mode, but it means Meera's
  ability to speak unprompted (the "arre, B was just talking about that"
  bridging behavior central to the product thesis) is contingent on recent
  group activity, not guaranteed. On a quiet day in a quiet group, her
  proactive bridging line **requires a pre-approved template**, which cannot
  be the free-form, personality-driven line the product needs — templates are
  static, pre-submitted-for-approval strings/variables, not something a live
  LLM can phrase in the moment inside the review process WhatsApp requires.

## 4. Policy risk — unofficial libraries (the alternative to the above constraints)

If the official Groups API's "business creates its own room" limitation is
rejected in favor of getting a real number into users' actual existing
groups, the only route is an unofficial client (Baileys — Node/WebSocket, or
whatsapp-web.js — Puppeteer-driven browser automation). Both explicitly
violate WhatsApp's Terms of Service; WhatsApp does not sanction any
automation path outside the official Business Platform. [multiple sources
converge on this; techcrunch.com's reporting on WhatsApp's stated position —
"not permanently banning users... just blocking third-party clients" — is the
closest to a primary confirmation of WhatsApp's enforcement stance found in
this pass]

- **Ban rate is sharply bimodal by behavior pattern**, per one synthesis
  source (secondary, methodology not fully disclosed — treat as directional
  not precise): purely **reactive** bots (only replying to inbound messages)
  reported **under 2% ban rate over 12 months**; bots that **send proactive
  messages to new/wider contacts** reported **15–30% ban rate over the same
  window**. A companion that initiates conversation, bridges between people,
  and speaks unprompted in a group is structurally in the second, high-risk
  category — this is close to a worst-case fit for the failure mode.
  Detection signals cited: reply-ratio under 10%, contact-graph distance from
  "stranger" accounts, and robotic/regular timing patterns — all things an
  AI companion sending frequent, scheduled-feeling messages will trip more
  than a human.
- **India-specific claim, thin sourcing, flagged explicitly**: one vendor
  blog (Kraya AI) reports 68% of ~600+ surveyed Indian SMBs using unofficial
  WhatsApp automation saw at least one ban within 12 months. This is a single
  self-published source with an undisclosed sampling method and a commercial
  incentive (they sell an alternative) — **do not treat this number as load
  bearing**; it is directionally consistent with "unofficial automation in
  India is high-risk" but should not be quoted as a hard percentage without
  independent replication.
- Unofficial libraries also carry no SLA, break silently on WhatsApp protocol
  changes (this is inherent to reverse-engineering an undocumented protocol),
  and a ban costs the **user's personal phone number** if that's what's
  bridged — a materially worse failure mode for a companion product than a
  business-owned number going down, because it can burn a real person's own
  WhatsApp identity, not just a marketing asset.

**Bottom line on this path**: unofficial-client group-joining is technically
capable of the "she's in your existing group" product shape the decision log
implies, but it is the single highest-risk piece of this entire stack —
proactive, personality-driven, frequent messaging is exactly the pattern
correlated with the worst ban outcomes in every source found, official ToS
explicitly disallows it, and a ban here can consume a real user's phone
number rather than a disposable business asset.

## 5. Alternatives, ranked

1. **Telegram bots in groups — fully supported, free, best fit by far.**
   Telegram's Bot API has supported bots-in-groups natively for years (stable,
   versioned — v10.2 as of July 2026 per search results), costs nothing
   per-message, has no participant cap comparable to WhatsApp's 8, no OBA-style
   notability gate, and a bot **can be added to a user's existing group** by
   any group admin — the exact capability WhatsApp's Cloud API does not offer
   third parties. This is the one alternative that actually matches the
   product thesis ("common friend, in the group you already have") rather
   than working around a platform limitation. The tradeoff is Telegram's much
   smaller India user base relative to WhatsApp's near-ubiquity — a
   real distribution cost, not a technical one.
2. **Discord bots in servers — fully supported, free, but wrong audience
   shape.** Discord's Bot API is mature, free, well-documented, and bots
   already do this exact "AI companion in a shared space" job today (Chat
   Data, Quickchat AI, MEE6, and many hobbyist projects, per search results).
   The mismatch is cultural/demographic: Discord skews toward gaming/online
   communities and English-first tech-savvy users, not the Hinglish
   couple/family/friend-circle target the product describes. Worth keeping
   as a fallback distribution surface, not a primary one.
3. **iMessage — infeasible, confirmed.** Apple has no public server-side
   bot/automation API. Apple's own **Messages for Business explicitly does
   not support group chat at all** ("if you need an iMessage solution that
   supports group chats, then with Business Chat you can forget about it" —
   per search-synthesized trade coverage of Apple's own positioning). Every
   third-party iMessage bridge that exists is a workaround: a Mac running
   24/7, reverse-engineered protocol clients, or a paid relay service (e.g.
   LoopMessage) — none of which are an official, durable path, and none
   solve the group-chat gap Apple itself declines to support. Rule this out
   plainly; it is not a near-term option.
4. **WhatsApp Cloud API groups (official)** — feasible only for the
   business-hosts-its-own-room shape, at real per-recipient cost that scales
   with chattiness, with proactive/unprompted messages gated behind template
   approval whenever the 24h window has lapsed, and with an unresolved
   eligibility question (OBA alone, vs. a possible high-volume gate) that
   needs a direct BSP conversation before it's load-bearing for planning.
5. **WhatsApp via unofficial client (Baileys/whatsapp-web.js)** — technically
   matches the product vision best (joins existing groups) but carries the
   highest, most product-relevant ban risk of anything on this list, explicit
   ToS violation, and risk to the user's own phone number rather than a
   disposable business asset. Rank last despite matching the vision most
   closely, precisely because the failure mode is the worst one on this list.

## 6. What this means for the decision log's reversal condition

The reversal condition as written — *"bots in user groups are infeasible or
ban-bait under the Business API"* — is **half true, precisely stated**:

- **Not infeasible outright** — the historical "no group API at all" premise
  the brief asked me to check is now false as of Oct 2025; WhatsApp groups
  are officially buildable.
- **But infeasible for the specific "joins your existing group" shape**, which
  is the more natural reading of "common friend to a group" — that shape is
  either (a) redefined to "Meera hosts her own room and invites the group's
  members into it" (available today, officially, at a real and scaling
  per-message cost, with proactive speech gated by window/template
  mechanics), or (b) pursued via unofficial clients, which is close to
  textbook ban-bait for a proactive, personality-forward messaging pattern
  specifically.

**Recommendation for the owner, stated as a decision, not a hedge**: if the
product vision is genuinely "she's in the group you already have," WhatsApp
cannot deliver that today without unofficial-client risk that this track
would call disqualifying for a product whose entire value is trust and
relationship durability — getting a user's real phone number banned is
close to the worst possible failure for that thesis. **Telegram delivers the
actual product shape natively, officially, for free, today**, at the cost of
smaller reach in the target demographic. WhatsApp's own Groups API is a real,
usable, official option only if the product accepts the narrower
"Meera's own room" framing — which is a genuine product-shape decision, not
a technical detail, and should go back to the owner explicitly rather than
being silently absorbed into implementation.

## Sources consulted

- developers.facebook.com/documentation/business-messaging/whatsapp/groups
  (direct fetch — primary, Meta's own docs)
- developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/
  (direct fetch — primary, partial content only)
- developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference
  (direct fetch — primary, full endpoint list)
- Unipile, imBee, Sanuker, Chatarmin, whatsappbusiness.com, islash.io,
  wassenger.com, wuseller.com, chakrahq.com, woztell.com, whapi.cloud, Turn.io —
  integrator/BSP secondary sources, used only where they corroborated or
  filled gaps in Meta's primary docs, and flagged inline wherever they
  conflicted or stood alone
- myoperator.com, 2factor.in, aisensy.com, blueticks.co, montymobile.com,
  chati.ai, uptail.ai, m.aisensy.com — pricing secondary sources, India rates
  triangulated across 2 disagreeing figures, banded rather than point-quoted
- 360dialog docs, indigitall docs, happilee.io, academy.insiderone.com — OBA
  eligibility, consistent across sources
- multilogin.com, getkanal.com, tisankan.dev, techcrunch.com (WhatsApp's own
  stated ToS-enforcement position), kraya-ai.com (flagged thin/self-published),
  achiya-automation.com — unofficial-client ban risk
- docs.discord.com/developers/platform/bots, chat-data.com, quickchat.ai,
  fast.io — Discord bot ecosystem
- botscrew.com, clawmessenger.com, loopmessage.com, developer.apple.com forums
  — iMessage/Apple Business Chat limitations
- freeapihub.com, qualtir.com, chatimize.com — Telegram Bot API group support
- faq.whatsapp.com (Meta AI as group member — fetch attempts returned
  truncated/no usable content; relied on corroborating search snippets
  describing the `@Meta AI` mention mechanism instead of a direct primary
  fetch — flagged as the one claim in this file sourced only via search
  snippets, not a page I read in full)
