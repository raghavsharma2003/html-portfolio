// THE INSTALL-SCRIPT ALLOWLIST. WS-R57.
//
// `scripts/check-headers.mjs`'s supply-chain check runs
// `npm query ':attr(scripts, [preinstall]), :attr(scripts, [install]), :attr(scripts, [postinstall])'`
// over the installed tree and fails the build the moment a dependency
// carries a `preinstall`, `install` or `postinstall` script UNLESS its exact
// `name@version` is listed here, with a comment naming what the script does
// and why it is safe to let a stranger's package run code on this machine
// (and on Vercel's build machine) during `npm install`.
//
// This is the same shape as `scripts/roomsVocabAllowlist.mjs`: never a
// blanket exemption, never a name added without the reason next to it, and
// checked at the exact version so a dependency bump that changes the script
// re-triggers review rather than riding the old entry forever.
//
// At WS-R57 (2026-09-04) this list was EMPTY: `npm query` above returned
// `[]` on the committed lockfile (see `context/measurements.md`'s
// `ws-r57-install-script-scan` entry) -- nothing in this tree's dependency
// graph declared a preinstall or postinstall script then. The list exists
// so the FIRST one that ever does has a place to be judged, in its own
// commit, rather than the gate being loosened at the moment it first fires.
export const INSTALL_SCRIPT_ALLOWLIST = [
  {
    name: "esbuild",
    version: "0.28.2",
    scripts: { postinstall: "node install.js" },
    files: { "install.js": "612294e278914443bdcf81cb17f54afec34dbdd2ebd999a6ee187912320cc315" },
    reason: "Required direct fixture bundler. Reviewed the exact install.js SHA256 on 2026-09-08: optional platform binary resolution and version validation; exact-version npm/archive fallbacks verify binary SHA256 from package metadata. Inventory acceptance does not execute the hook; initial install remains --ignore-scripts. See docs/gurukul/research/ESBUILD-INVENTORY48-REVIEW-20260908.md for override and trust limits.",
  },
];
