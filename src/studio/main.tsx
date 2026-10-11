// Both workspaces use the same authenticated API and replica identity.
// Keep the battle-tested voice capture and Rooms publication paths intact
// while their presentation layers are consolidated.
const mode = new URLSearchParams(window.location.search).get("mode");
// Keep separate async boundaries: folding the two imports into one conditional
// preload attaches only the personal entry's CSS dependencies to both routes.
async function openCreatorStudio() { await import("../creatorStudio/main"); }
async function openPersonalStudio() { await import("./personalMain"); }
if (new URLSearchParams(window.location.search).has("publication")) {
  void import("./publication/main");
} else if (mode === "teacher" || mode === "ops" || mode === "setup") {
  void openCreatorStudio();
} else {
  void openPersonalStudio();
}
