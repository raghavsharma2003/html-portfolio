# Frozen comparison106 execution packet

Packet: `VOICE-JOBS106-EXECUTION-PACKET.json`

SHA256: `f56c4f9f7e1ae2e97e85309070ba16b9b5f89d78f20998635f1441a1bf549cf9`

Envelope commitment: `8f9091c46c1e2352cba30c36814c0e583c5e553fc2410f1d97f6b371986a7f4e`

The packet and all47 pinned files are frozen for root execution. Do not edit or regenerate them after any operation starts. Source remains approved0b47b2b892f60b3f45f5d56bd647d97e2308329d. Two completed COPY-only overlays are reused by digest; no rebuild.

From the original repository, root can execute the same command with each MODE in order:

```powershell
python scratchpad/expert-tools/voice-jobs106-launch.py MODE scratchpad/expert-tools/VOICE-JOBS106-EXECUTION-PACKET.json f56c4f9f7e1ae2e97e85309070ba16b9b5f89d78f20998635f1441a1bf549cf9
```

1. `check`:47 file pins and envelope commitment, offline. Passed during preparation.
2. `logcheck`: actual KQL parser and workspace permission read. No model invocation.
3. `provision-chatterbox`: one create-only Manual Job PUT, requires target absent.
4. `provision-voxcpm2`: one create-only Manual Job PUT, requires target absent.
5. `inspect`: both exact configurations through the approved controller. Provision acceptance is insufficient; inspect must pass before admission/run.
6. `admit`: one exact CAS changes the existing GPU budget limit1,000,000 to2,500,000 microUSD, requiring970,200 reserved/0spent unchanged and preserving the foreign text ledger.
7. `run`: existing serial0b47 runner, one claim, detached observer, exact ARM execution capture and full collector before arm2. No start or synthesis retry. Unknown outcomes require retained receipt review, never rerunning the claim.

Each Manual Job: T4,8vCPU,56GiB,900-second timeout, one replica/completion, retry0. Fresh04:54 UTC retail query yielded462 microUSD per allocation second. Each1260-second planning reservation is582,120 microUSD; total1,164,240. Existing970,200 remains held, leaving365,560 after both reservations under the2.5M limit. Previous CPU overlay holds total1M microUSD separately and remain unchanged. This is a planning reserve, not an invoice cap or usage settlement.

Current metadata receipt `voice-jobs106-readonly-1788929669015467700.json` confirms both names absent, environment `vyakti-voice-env`, profile `Consumption-GPU-NC8as-T4`, workspace `cdb1ef00-c81f-4591-9897-413a691a8225`. No cloud key read/resource mutation/model call occurred during preparation. The launcher reads existing registry credentials into memory only when provisioning; ARM/log tokens and the AST-extracted isolated DB URL are never written to the packet or command line.

Preparation evidence: launcher check47pins passed; seven budget positive/negative controls passed with0SQL/0cloud. The prior source suite passed15 Node,6 Python and27 existing Job groups. Independent reviewer115 cleared cleanup/observer/capture source blockers. A conservative concurrent terminal-observation CAS race may refuse completion; it must never be turned into an implicit generation retry. Actual GPU startup,12audio clips, log delivery and model quality remain unmeasured until root executes.
