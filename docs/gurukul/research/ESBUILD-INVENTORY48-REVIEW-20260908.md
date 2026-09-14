# esbuild 0.28.2 install inventory review

Source-only review, 2026-09-08. Base: release45 `71663c5d173ed0ffe49b86639567cf83e9b7cd16`.

The direct fixture bundler requires esbuild. Its declared `postinstall: node install.js` makes the existing dependency inventory fail despite the initial install using `--ignore-scripts`. This change accepts only the reviewed package identity, exact lifecycle command set, and exact installed hook bytes. It does not execute the hook or change installation policy.

Read: `scratchpad/expert-release45-candidate/node_modules/esbuild/install.js`. SHA256 measured once with PowerShell `Get-FileHash`: `612294e278914443bdcf81cb17f54afec34dbdd2ebd999a6ee187912320cc315`. The measurement identifies the reviewed hook, not the provenance or safety of every dependency byte. No environment values were read.

## Observed source behavior

- Selects the platform-specific optional `@esbuild/*` package using OS, architecture and endianness. Resolves its executable with `require.resolve`. Normal optional-package resolution is **not** binary-hash-checked by this hook.
- Runs the selected wrapper or binary with `--version` and compares the output to the package manifest version. This executes the binary; the inventory checker never invokes this path.
- If the optional package cannot resolve, attempts `npm install` for the exact platform-package version in a temporary package directory. This command has no explicit `--ignore-scripts` switch. It reads the installed executable, checks its SHA256 against `package.json["esbuild.binaryHashes"]`, then moves it into the package. The temporary directory is removed in a finally block.
- If npm installation fails, fetches the exact-version archive from `https://registry.npmjs.org`, follows HTTP redirects, extracts the selected binary, validates its SHA256 against that same manifest table, writes it and makes it executable. This validates extracted binary bytes, not the archive as a whole. Fetch has no explicit timeout in the reviewed hook.
- Supports `ESBUILD_BINARY_PATH`. An existing override rewrites the CLI wrapper and prepends a configured binary path to `lib/main.js`. It then validates the version; it does **not** enforce the binary hash table on the override. The override's value was not inspected in this review.
- On non-Windows, non-Yarn, non-WASM installations, may hard-link and rename the selected executable over the CLI wrapper as an optimization.

## Inventory contract

`scripts/installScriptInventory.mjs` reads only. It rejects unlisted identity/version; changed preinstall/install/postinstall command sets; missing review hashes/reason; package locations outside the actual dependency tree; mismatched installed manifests; reviewed files escaping their package; unreadable material; and altered hook hashes. It uses real paths to reject linked files escaping the package boundary. Root review additionally required the actual npm query to include install-only hooks, closing the former preinstall/postinstall-only discovery gap. Vulnerability/header checks remain unchanged.

The checked manifest is not itself pinned by a hash, and the reviewed hook depends on its binary hash table. This review therefore is not an authorization to run arbitrary modified package metadata or override binaries. Lockfile integrity, package provenance, vulnerability checks and ignored lifecycle execution remain separate safeguards. Inventory acceptance cannot establish runtime binary trust.

## Prepared validation, not executed

`evals/install-script-inventory.mjs` contains Node-only positive and negative controls using synthetic files. The synthetic hook throws if executed; acceptance must read its bytes without running it. Negative controls cover changed package name/version, changed reported/installed hooks, an extra lifecycle hook, changed hook bytes, missing files, invalid hashes, path escape, absent location, incomplete review and malformed manifest. No hook, test, npm query, browser or build has run in this worktree. No dependency copy was performed.

Reverse this decision if esbuild ceases to be required, its version/command/hook changes, or source review identifies unacceptable behavior. Any hook or version change must fail the inventory and receive a new review; do not widen the allowlist to make it pass.

## Approved validation completed

After root source review, one Node-only run of `evals/install-script-inventory.mjs` passed all 17 controls, exit 0. No failures or retries. `node scripts/check-copy.mjs` passed seven scopes and 21 negative controls. The context graph passed at 2754 nodes and 2432 edges before final validation notes were appended. These checks do not execute dependency hooks. The actual npm inventory, audit, headers, browser and build were not run here. No dependencies were copied. The real npm query now includes preinstall, install and postinstall selectors.
