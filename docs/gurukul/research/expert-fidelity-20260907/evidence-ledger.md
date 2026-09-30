# Research scope and evidence gaps

Decision: how to build a faithful, useful expert AI from the existing Vyakti lineages, with Hindi, Hinglish and Indian English as first-class evaluation languages. Audience: founder and implementation team. Geography: India-first expert distribution, global technology comparison. Evidence window: sources checked 6–7 September 2026. Excludes unsupported valuation, consciousness claims, clinical trait inference and an unmeasured claim to outperform every competitor.

Discovery and targeted follow-up are complete for this brief. Synthesis is in report-source.md. The planning tool was searched for but was not available. Two sequential specialist research lanes covered model provenance/voice and observable behavior/memory; the coordinator independently checked consequential claims and owns the artifact. No human listening study was performed.

| Claim family | Evidence and confidence | Contradiction or missing evidence | Decision |
|---|---|---|---|
| Existing model identity | Repo pinned revisions plus read-only Azure ARM deployment/job audit; high for inspected resources | Mutable training tag; ordinary preview adapter adoption unknown | Keep pretrained reference cloning distinct from historical LoRA |
| Qwen Hindi support | Official QwenLM/Qwen3-TTS README lists ten languages excluding Hindi; high for release list | A future model or custom adaptation could differ | English candidate; no Hindi claim |
| IndicF5 Hinglish | Official AI4Bharat model card lists Indian languages; high for listed support | No local held-out Hinglish acceptance | Evaluate rather than infer from Hindi support |
| VoxCPM dual conditioning | Official OpenBMB repository and local app.py caller; high | Public hardware throughput not our protected T4 latency | Measure existing implementation before adding mechanisms |
| Human simulation | Park et al. arXiv2411.10109v3, 28 June2026; high for reported sample and denominator | US survey behavior, not Indian expert conversational identity | Use elicitation and retest calibration, not86%clone claim |
| Long-term memory | LongMemEval ICLR2025 repository, cleaned historiesSep2025; local Mirror source; high | Existing scope proof does not prove relevant old-memory recall | Real SQL synthetic baseline then bounded candidate |
| Listening | Ekstedt and Skantze SIGDIAL2022 and Interspeech2022; moderate transfer | Hindi timing, echo and protected audio transport unproven | Shadow evaluation before full duplex |
| Competitor offer | Official Delphi, Coachvox, Sensay pages; high for visible offer | Vendor outcomes/retention are not independently verified | Narrow workflow pilot; no TAM-to-revenue extrapolation |
| Economics | Azure retail API plus actual deployment SKU and ledger; high for tiny text probe | Voice rejects, cold starts, support and renewal unknown | Measure accepted-task costs before unlimited plans |
| Product market fit | Proposed cohort pilot only | No completed paid pilot or renewal data | Explicit hypothesis, not accepted PMF |

Primary voice sources retained for follow-up: https://github.com/OpenBMB/VoxCPM ; https://voxcpm.readthedocs.io/en/latest/finetuning/finetune.html ; https://github.com/QwenLM/Qwen3-TTS ; https://huggingface.co/ai4bharat/IndicF5 ; https://github.com/resemble-ai/chatterbox ; https://github.com/k2-fsa/OmniVoice ; https://arxiv.org/html/2604.00688v1 . OmniVoice's reported Hindi WER/SIM-o use a different setup from local ECAPA; they must not be numerically compared. Fish S2 Pro model and license were inspected as an optional challenger: https://huggingface.co/fishaudio/s2-pro/blob/main/README.md and https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md . Its release is not a free commercial-training assumption.

Primary behavior sources: https://arxiv.org/abs/2411.10109v3 ; https://github.com/xiaowu0162/LongMemEval ; https://arxiv.org/abs/2504.14225 ; https://xiaowu0162.github.io/longmemeval-v2/ ; https://arxiv.org/html/2508.10695v1 ; https://aclanthology.org/2022.sigdial-1.51/ ; https://www.isca-archive.org/interspeech_2022/ekstedt22_interspeech.html . Feedback-training research motivates collecting useful corrections, not automatic training on every owner tap.

Primary market sources: https://www.delphi.ai/pricing ; https://coachvox.ai/ ; https://support.coachvox.ai/article/72-how-to-get-paid-for-ai-coaching ; https://sensay.io/ ; https://www.cartesia.ai/pricing . Public TTS-minute pricing, agent-minute pricing and expert subscriptions use different denominators. India IAMAI2024 language adoption was discovered but omitted from conclusions because it is not current paid clone demand; newer2025 report details were not fully recovered.

The source text is canonical for the six-page DOCX. The rendered brief retains descriptive clickable citations near supported claims. No source claims about subjective quality have been converted into local measurements. New runtime results belong in context/measurements.md and can supersede the dated implementation snapshot without rewriting old evidence.
