# Vyakti product position, 2026-10-09

## Decision

Build Vyakti first for independent experts who already have a paid audience and repeatedly answer the same contextual questions: cohort-course teachers, exam mentors, coaches and specialist educators. The promise is narrow: **their knowledge and way of explaining, available between live sessions, with a private memory for each learner**. Knowledge accuracy, correction and continuity must earn trust before voice becomes the headline.

This is a positioning hypothesis, not evidence of product-market fit. Start with a concierge pilot of 5 to 10 creators who each have an owned archive, an active paid community and at least 50 recurring audience members. Measure repeated visitor use, questions resolved without the creator, unsupported answers, creator correction time and willingness to renew. Do not claim fidelity or superiority from feature comparison.

The Azure-only serving rule is binding. The products below are journey and packaging references. Their hosted models and APIs are not implementation options.

## Current market evidence

Facts in this table were checked against first-party pages on 2026-10-09. Product claims are vendor claims unless explicitly described as an inference.

| Product | Verified current offer | Verified pricing | What it teaches Vyakti |
| --- | --- | --- | --- |
| [Delphi](https://www.delphi.ai/pricing) | A creator syncs documents, sites, social accounts, podcasts and video, fills knowledge gaps through questions, adds a short voice sample and shares a public profile. Its training mode accepts a conversational correction or an "Improve this response" form. Visitors get suggested questions, text and voice; signed-in conversations retain high-level cross-session memory. Paid plans add embeds, audience controls, products, alerts, integrations and branding. Sources: [knowledge and correction flow](https://help.delphi.ai/articles/16041852-add-knowledge-train-mind), [visitor journey and memory](https://help.delphi.ai/articles/16045443-find-delphi), [integrations](https://help.delphi.ai/articles/16043910-integrate-your-delphi-on-your-platforms). | Free includes voice/chat and 1M training words. Builder is $79/month with 5M words; Scaler is $299/month with 12M words and Pro Voice; Immortal is custom. Pro Voice is a $150/month Builder add-on and included in Scaler. | Closest journey reference. The valuable loop is source, talk, correct, retry, share. Its creator business layer also shows that distribution and audience access can justify a creator subscription. |
| [Personal AI](https://www.personal.ai/products) | Separates My AI, no-code Persona Studio and Memory Core. It describes persistent identity-specific memory, configurable personality, knowledge domains, memory behavior and guardrails. Its older consumer pages describe editable memory stacks and file/URL ingestion. Sources: [memory](https://www.personal.ai/memory), [current platform](https://www.personal.ai/about). | No current self-serve consumer price is published. The [pricing page](https://www.personal.ai/pricing) now asks carrier operators to scope an on-network MODEL-4 agreement. | Relationship memory can be a product layer, not a chat-history afterthought. The visible shift toward carrier infrastructure is also a caution: a broad "AI of everyone" proposition may be hard to package as one self-serve creator product. That caution is an inference, not a reported outcome. |
| [ElevenAgents](https://elevenlabs.io/pricing/agents?price.platform=agents_platform) | Real-time voice agents with knowledge bases, RAG, multilingual calls, widgets, tools, testing and analytics. Personalization comes from per-session variables, overrides or a webhook supplied by the customer; it is not presented as a built-in long-term relationship model. Sources: [knowledge base](https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base), [personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization), [testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing). | Free: 15 call minutes. Starter: $6/month and 75 minutes. Creator: $22/month and 275 minutes. Pro: $99/month and 1,238 minutes. Extra hosted calls are $0.08/minute, burst calls $0.16/minute and text $0.003/message; LLM and external telephony are additional. | Strong reference for observable call states, testing and turning a failed real conversation into a regression case. It also exposes the cost shape of voice: minutes, concurrency and model usage compound. |
| [Character.AI](https://support.character.ai/hc/en-us/articles/50608869548699-2-Creating-a-Character-Quickstart-Guide-%CF%89) | A five-minute creation route leads with name, avatar, greeting, tags, visibility and publish. A deeper Definition controls personality, speech and emotional logic; dialogue examples are first-class. Memory is mainly controlled by the visitor through pins, a short memory field and auto-memory. Creator Insights reports interactions, likes, followers and discovery on web and mobile. Sources: [definition](https://support.character.ai/hc/en-us/articles/50609183646875-5-Character-Definition), [memory and refinement](https://support.character.ai/hc/en-us/articles/50609303987099-6-Refining-and-Testing-your-Character), [creator insights](https://support.character.ai/hc/en-us/articles/51616603738395-Creator-Insights). | Free messaging is unlimited. US c.ai lite is $4.99/month or $2.49/week and adds more memory visibility and limited premium chat. Standard c.ai+ renews at $9.99/month or $94.99/year in the US, with regional variation. Sources: [lite](https://support.character.ai/hc/en-us/articles/56173313531675-About-c-ai-lite), [c.ai+ offer terms showing standard renewal](https://support.character.ai/hc/en-us/articles/51248493096987-c-ai-Summer-Flash-Sale-Offer-Terms). | A compelling first greeting and a few concrete dialogue examples do more than a long settings form. Visitor-controlled memory and a visible memory budget are useful patterns. Its free entertainment product sets an unrealistic price and breadth benchmark for a specialist work tool. |
| [Tavus](https://www.tavus.io/pricing) | A full real-time video-human stack with face/voice replica, perception, turn-taking, knowledge, dynamic memories and guardrails. A custom AI human can be created from an image or a short training video. | Free includes 25 conversation minutes. Starter is $59/month for 100 minutes and 3 custom AI humans; Growth is $397/month for 1,250 minutes. Starter overage is listed at $0.37/minute and each conversation has a 30-second minimum. | Useful evidence that a face dramatically increases the cost floor and failure surface. Defer video presence until users prove that text plus voice lacks essential value. |
| [Sensay](https://sensay.io/pricing) | Its current lead product captures departing employees' knowledge through AI-led interviews, documents and conversational search in Slack, Teams or web. Its replica help material still describes knowledge, expertise and communication-style representations. Source: [digital replicas](https://help.sensay.io/sensay-knowledge-base/what-are-digital-replicas-ai-agents). | $500 per knowledge base per year; larger organizational programs are custom. | A narrow, urgent job can be easier to buy than an abstract digital self. Vyakti should sell a recurring expert outcome, not the novelty of replication. |

## Journey to adopt

Keep the existing **Feed it, Meet it, Deploy it** model, but make one useful loop the whole first session:

1. **State the job.** Ask who this AI helps and the three questions it should answer. Generate the visitor-facing description and starters from this input.
2. **Feed a minimum useful set.** Accept one file, one link or pasted Q&A. Show exactly what was saved and processed. Do not force voice enrollment before knowledge can be tested.
3. **Meet immediately.** Open a private conversation with one generated starter. Place text first and voice as an explicit secondary action.
4. **Correct in place.** Every answer needs one clear correction action. Show the proposed durable change, its source/scope and a reversible accept step. Re-run the same question after acceptance.
5. **Preview the relationship.** Let the creator use a test follower identity, add one remembered preference, inspect what would be recalled, edit it and forget it. This proves the differentiator without exposing real follower data.
6. **Share privately.** Produce one private link with a concise profile, three useful starters and honest capability limits. Ask a visitor to sign in when continuity is needed, after they can see why the experience is useful.
7. **Show a small operating view.** Start with conversations, repeat visitors, unanswered questions and corrections needed. Show aggregate creator data only and preserve the repository's privacy thresholds.

The phone and desktop experiences should use the same information architecture. Mobile should emphasize the current task and the conversation; desktop may add the source ledger and operating view beside it. Avoid turning desktop into a technical dashboard or shrinking it into mobile cards.

## Value and cost traps

- **Voice can conceal a weak answer.** A familiar voice increases expectations. Keep text usable on its own and label voice quality honestly until owner-specific Hindi, Hinglish and English listening is measured.
- **Realtime cost arrives before retention.** Voice minutes, warm capacity, concurrency and retries create cost even when the relationship is not valuable. Cap pilot minutes per creator, show usage, and preserve graceful text continuation.
- **A broad consumer companion competes with free.** Character.AI offers unlimited free messaging. Vyakti needs an economic buyer with a repeated expert-support job, not generic companionship.
- **Integrations can become the product roadmap.** Delphi's embeds, CRM, messaging, products and broadcasts support distribution, but copying them before repeat use will multiply support work. Start with a private link and one embed only after demand.
- **Automatic memory can become confident surveillance.** Relationship memory should be scoped per person, visible, editable, attributable and forgettable. Never use a creator's aggregate view to reveal a follower's words.
- **Readiness scores can create false confidence.** Use concrete blockers and next actions. Do not invent completeness or likeness percentages.
- **Rich avatars are a cost multiplier.** Tavus pricing and pipeline breadth show the operational burden. Video does not fix knowledge, personality or memory fidelity.

## Build next, then defer

Next product work:

1. Finish one authenticated phone and desktop path through source save, private answer, correction, re-answer and private share.
2. Make the correction loop durable and legible, including source attribution, reversal and an explicit distinction between knowledge, personality and relationship memory.
3. Add the test-follower memory preview with inspect, edit and forget controls.
4. Build the visitor profile around purpose, three starters and immediate text chat; introduce voice after the first useful answer.
5. Add minimal creator outcomes: repeat visitors, unresolved questions, corrections and usage/cost. Run the narrow paid pilot before choosing a public price.
6. Continue the protected Azure voice comparison, but gate promotion on actual owner listening in Hindi, Hinglish and English rather than bandwidth or vendor claims.

Defer public discovery, creator leaderboards, affiliate/product recommendations, broadcasts, telephony, WhatsApp, video avatars, a marketplace, complex workflow builders, white-label enterprise controls and broad API access. Reconsider an item only when pilot users repeatedly need it to acquire, serve or retain paying members.

## Current unknowns

- No current evidence shows which narrow ICP will pay, what price they will renew at, or whether end users return for the relationship memory.
- Vyakti's per-active-creator and per-visitor Azure cost is not yet measured under a real mixed text/voice journey.
- Hindi, Hinglish and English owner likeness remains unmeasured by a valid listening comparison.
- The completion rate and time-to-first-useful-answer of the current signed-in mobile and desktop journeys are unknown.
- Competitor pages establish advertised features and list prices, not answer quality, retention, margins or privacy behavior in practice.
- Personal AI does not currently publish a self-serve consumer price on its pricing page; Delphi Pro Voice quality and the listed competitors' memory quality were not independently tested.
