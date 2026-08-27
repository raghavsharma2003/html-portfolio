// Offline two-agent dispatch fixture. The loader redirects only api/_db.js;
// the dispatch, room, disclosure and gate modules are the shipping files.
import { register } from "node:module";

register("./agent-room/loader.mjs", import.meta.url);
await import("./agent-room/case.mjs");
