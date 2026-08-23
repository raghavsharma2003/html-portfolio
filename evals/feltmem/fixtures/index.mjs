// The fixture surface, in one import, plus the list of files the
// pre-registration hash covers. Adding a fixture file without adding it to
// PREREG_FILES would be a way to change the suite without changing its hash,
// so prereg.mjs cross-checks this list against the directory listing and fails
// on anything it has never heard of.
export * from "./dyads.mjs";
export * from "./probes.mjs";
export * from "./rubrics.mjs";
export * from "./acceptance.mjs";

/** Every file whose bytes are part of the pre-registration. Order is fixed —
 *  the combined hash is order-dependent by construction. */
export const PREREG_FILES = ["dyads.mjs", "probes.mjs", "rubrics.mjs", "acceptance.mjs", "index.mjs"];
