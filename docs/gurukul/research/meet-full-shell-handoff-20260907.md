# Full creator setup destination: bounded repair

2026-09-07. Isolate: `scratchpad/expert-meet-readiness`, base `2c2e5b2c`. Integration checkpoint19 `68283658` remained frozen and untouched. No real authentication, database, identity, model, activation or publication occurred.

## Decision and reversal

Execute the real `studio.html` -> `src/studio/main.tsx` -> `src/creatorStudio/main.tsx` -> full `StudioApp` using existing layout-fixture data and a synthetic cached owner session. The earlier replacement StudioApp host could not establish full-shell destination correctness. Keep its old results and limitations.

Three demonstrated repairs: select the explicitly requested owned replica for initial `mode=setup` hydration, retain current selection on refresh and refuse specified unavailable IDs; prevent old list/session completions from restoring a signed-out or superseded session; keep distinct async entry loaders so Vite preserves distinct CSS dependency manifests. The query never grants ownership. Default entry selection stays unchanged outside explicit setup.

The now-visible full shell demonstrated a fourth-child header overflow and long technical runtime stack. Move the existing My voice link into account-menu, remove its inherited form-style top margin/full width, offset runtime hash scrolling below the sticky header, and move qualification/version/provider details into a native disclosure. Short English/Hindi primary copy keeps every blocker and the existing disabled activation action visible. All backend authority and activation arguments remain unchanged. No palette, font, asset or motion redesign.

Reverse the async loader separation if a built-artifact test proves both dynamic branches retain the correct CSS dependencies without it. Reverse selection changes if an actual authorized caller requires a conflicting initial setup target contract; do not restore silent first-row fallback for a specified unavailable target. Reconsider the details grouping only if representative owner usage demonstrates hidden information is needed to decide the next action.

## Measurement and retained failures

All paths below are relative to `scratchpad/expert-meet-readiness/scratchpad/`.

- `meet-full-shell/1788782026655`: first synthetic full-shell run22pass/7fail. Correctly demonstrated second-row selection bug but fixture incorrectly refused POST read operations and lacked real entry HTML/CSS. Invalid visual acceptance.
- `meet-full-shell/1788782202250`: actual HTML and read operations27pass/2fail; visual inspection rejected styling despite logical checks. No style acceptance.
- `meet-full-shell/1788782331920`: explicit CSSOM guards27pass/6fail. Only personal CSS loaded, creator header/tabbar computed block.
- `meet-full-shell/1788782437464`: **actual frozen integration dist**, no rebuild,27pass/6fail. Same CSS absence and wrong selected replica. `dist/assets/studio-1F3wNZKa.js` contains one conditional import preload with only personalMain dependencies for both branches. This corroborates an emitted-artifact defect, not merely a single-entry test build issue. Manifest pins actual integration HEAD/source hashes; build.json pins every retained dist asset.
- `meet-full-shell/1788782624857`: first repaired dispatch/selection build31pass/2fail. Correct creator CSS535rules, selected requested replica. Actual390px runtime section1136px high, disabled action1068..1112px, header covered title. Desktop section614px, action533..581px. Rejected as mobile completion; screenshots retained.
- `meet-full-shell/1788782876257`: first concise setup build42pass/2fail plus incorrect new personal-route fixture selector timeout. Phone inherited text-button margin made header control overflow; actual root content/action now fit. Neither failure deleted.
- `meet-full-shell/1788782976404`: final **51/51** checks, four full signed-in setup cases (390/1440 x single/two-owned-replica), plus six real signed-out entry cases (personal/teacher/ops x both widths). Real HTML, actual full app/components/styles; no replacement imports or component host. CSS/request/geometry/text and source/build commitments retained. Keyboard Enter opens all four qualification/version cells; Space closes details; activation stays disabled.
- Final phone target top68.27px below52px header; action506.05..550.05px in1000px viewport. Header control boxes3.5..47.5px. Desktop target92.20px below76px header; action379.59..427.59px. No horizontal overflow, page exceptions or external requests in signed-in cases. Two synthetic owned rows were retained; requested replica was second, and actual runtime reads stayed bound to it.
- Actual load/sign-out callback source extraction: **10/10** groups, including malformed/empty/unowned IDs, absent defaults, preserved selection, empty list, delayed refresh after sign-out, delayed previous-owner list, late failure, old-first-row and missing-guard negative mutants. Initial race test itself exited on an unsettled await after6groups because it guessed cross-VM microtask timing; replaced with an explicit list-start signal, then10passed. No fabricated network evidence.
- Incumbent actual Meet component/dispatch mounted suite **34/34**, artifact `meet-setup-ui/1788782988128`. This older suite still uses a replacement destination host and is only incumbent state/race coverage; the new51-group full-shell result establishes real destination behavior.
- Original actual navigation/entry/CloneExperience caller **7/7**; `tsc -b --force`, copy check and `git diff --check` passed. No full release, performance gate or real-service acceptance was run by this agent.

Final screenshots (inspected): `meet-full-shell/1788782976404/390-requested-second-viewport.png` and `1440-requested-second-viewport.png`; full-page versions alongside. Before screenshots in `1788782624857`. All screenshots are synthetic UI evidence, not real identity or owner account data.

## Exact handoff files and frozen SHA256

Only these six product files and two new eval files are part of this next slice. The isolate also contains earlier Meet files already integrated; do not overwrite unrelated integrated CloneExperience/capture work.

| File | SHA256 |
| --- | --- |
| src/studio/main.tsx | 1a35abce56ee6bd658399f652b61f9e8ca1e02943ecf30422180054021d59ce7 |
| src/creatorStudio/StudioApp.tsx | 5a3a930ba628b8c6b3316592a453b8e0ca08bdb40b2a96c112edd6735cfc7ede |
| src/creatorStudio/RuntimeGate.tsx | 75fbd196b5aa91fa0700b97e4881c682379885ebea27940913ff1ed097dec83b |
| src/creatorStudio/runtime-setup.css | a41628610b5ac5367a9019f6c07875105363b7609d4d77e31d60f8cdfccc87bd |
| src/creatorStudio/copy.ts | 67a0ca3276dcc594d2061e9775c6b4f4cdae368feb85c1087ef1057b5cb9438d |
| src/creatorStudio/hiCopy.ts | 5b00742a53759ef1d047eda075cb379d34991e6facc6ac43735956229fe82683 |
| evals/studio-setup-selection.mjs | ca515f0fc866f9813ca18cfaa337661c19942d2a7b67cead4b1f508c5aa11342 |
| evals/conversation-setup-full-shell.mjs | 9fb00eb8eeafa9fb5449f9531b59e0abe7e77059bb5555ab624c9b49fe0f1768 |

Run focused callback proof: `node evals/studio-setup-selection.mjs`.
Run actual app single-entry Vite build without writing dist: `node evals/conversation-setup-full-shell.mjs`.
Run same existing release dist: `node evals/conversation-setup-full-shell.mjs --source-root ../expert-integration --dist`.

The final51-group proof used the isolate's actual app source with `configFile:false`, single HTML entry and `write:false`; it is not a substitute for the next normal full release build. The earlier actual frozen dist negative control demonstrates the source issue survives the normal multipage build. Root owns registry/context integration and full release. The original full release19 outcome is independent.
