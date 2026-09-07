// Both workspaces use the same authenticated API and replica identity.
// Keep the battle-tested voice capture and Rooms publication paths intact
// while their presentation layers are consolidated.
const mode = new URLSearchParams(window.location.search).get("mode");
if (mode === "teacher" || mode === "ops" || mode === "setup") {
  void import("../creatorStudio/main");
} else {
  void import("./personalMain");
}
