// THE INSTALL-SCRIPT ALLOWLIST. WS-R57.
//
// `scripts/check-headers.mjs`'s supply-chain check runs
// `npm query ':attr(scripts, [preinstall]), :attr(scripts, [postinstall])'`
// over the installed tree and fails the build the moment a dependency
// carries a `preinstall` or `postinstall` script UNLESS its exact
// `name@version` is listed here, with a comment naming what the script does
// and why it is safe to let a stranger's package run code on this machine
// (and on Vercel's build machine) during `npm install`.
//
// This is the same shape as `scripts/roomsVocabAllowlist.mjs`: never a
// blanket exemption, never a name added without the reason next to it, and
// checked at the exact version so a dependency bump that changes the script
// re-triggers review rather than riding the old entry forever.
//
// As of WS-R57 (2026-09-04) this list is EMPTY: `npm query` above returns
// `[]` on the committed lockfile (see `context/measurements.md`'s
// `ws-r57-install-script-scan` entry) -- nothing in this tree's dependency
// graph declares a preinstall or postinstall script today. The list exists
// so the FIRST one that ever does has a place to be judged, in its own
// commit, rather than the gate being loosened at the moment it first fires.
export const INSTALL_SCRIPT_ALLOWLIST = [
  // { name: "example-pkg", version: "1.2.3", reason: "why this is safe" },
];
