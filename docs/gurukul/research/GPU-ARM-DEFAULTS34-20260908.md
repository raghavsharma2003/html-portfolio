# Narrow normalization of observed ARM defaults

One read-only GET of the existing `vyakti-replica-processing` Job on September8 recorded only selected empty/default values, field names and presence. No environment values, secret values, key reads, writes or model requests were collected. The retained safe projection is `evals/gpu-job-control/fixtures/arm-defaults34.json`, SHA256 `5ef543bfe1e73281bef54e875202a4c34ac4d9191b6596f9f76c8c6f02ab3825`. The original helper/output remain under `scratchpad/expert-tools/azure-gpu-job-defaults34-*`.

The earlier exact comparison rejected additional ARM default fields even when they described no extra work. This adaptation removes exactly these observed optional values from **responses**, without changing the approved request plan or its commitments:

| Response path | Only accepted extra value |
|---|---|
| configuration.dapr | null |
| configuration.eventTriggerConfig | null |
| configuration.identitySettings | empty array |
| template.initContainers | null |
| template.volumes | null |

The same template normalization is used for configuration inspection, named execution observation and recovery, so server-added optional fields cannot break a correctly marked execution midway through its lifecycle. The per-window environment marker, command, image, resources and configuration are still compared exactly. Normalization clones its input and does not mutate the observed resource.

This is intentionally not a recursive empty-value filter. Unknown null fields and nonempty alternatives remain in the comparison and refuse. A null required manual trigger, changed command, empty arguments, changed ephemeral storage, another identity, startup container or mounted volume also refuse. This work does not normalize `scheduleTriggerConfig`: the inspected existing job is scheduled and that field was nonempty. Its actual manual-job counterpart must be read before any further adaptation. Several container fields were absent in the observation, which is not evidence that newly returned null/empty forms should be dropped.

The official ARM reference describes the manual trigger, job template containers, initialization containers, volumes and identity settings as separate configuration fields. It is background schema evidence, not evidence that this new candidate has been deployed. [Jobs GET, API2025-07-01](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/get?view=rest-resource-manager-containerapps-2025-07-01).

Validation:25 synthetic ARM/DB groups passed, including the hash-pinned real safe projection, all five accepted forms, nonempty/mistyped alternatives, required-field refusal and preserved per-window markers during observation/recovery. The existing original recovery graph check also passed at2564nodes/2422edges after root released the host reservation. No new SQL or model/GPU execution ran. No database/migration files changed; original149/150 and JOB_SQL remain pinned.

Reversal condition: an actual ARM field changes execution/authentication behavior despite the listed empty value, or real candidate metadata shows additional required fields. In that case preserve refusal and update only from a retained, reviewed observation with positive and negative controls. These five fields alone do not establish that the future manual job will pass every configuration check.

Independent review found the captured JSON would be normalized by the global LF rule, breaking its raw evidence hash in a fresh checkout. The fixture now has a narrow `-text` attribute, and the staged Git blob was checked against the original captured SHA. No generic Git normalization was changed.
