// evals/candidate/stimulus-pool.mjs — shared chat-lane archive reader.
//
// Both generate.mjs (WS-CANDGEN, archive-replay arm) and corpus-generate.mjs
// (WS-CORPUS, the swap-test context corpus) need the SAME 288-unit incumbent
// chat-lane pool (charm-grok + charm-luna, google/gemini-3.6-flash, lane
// "text"). Factored here once so the "288" figure cannot drift between the
// two scripts, and so the archive-reading/filtering logic (which is the part
// most likely to need a future edit) exists in exactly one place. See
// generate.mjs's file header for the full evidentiary argument for why the
// pool caps at 288 and why byte-identical=0 — this file only extracts, it
// does not re-derive or re-argue that.
//
// Read-only: never writes to evals/archives/.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CHAT_LANE = "text";

export const SOURCES = [
  {
    archive: "charm-grok",
    files: ["pb-merged1.json", "pb-merged2.json"],
    incumbentModel: "google/gemini-3.6-flash",
  },
  {
    archive: "charm-luna",
    files: ["pb-raw.json", "pb-raw2.json"],
    incumbentModel: "google/gemini-3.6-flash",
  },
  // realtime-azure deliberately excluded — see generate.mjs's header: no
  // persona/user field, no lane=text data, not chat-lane, not replayable.
];

function readArchiveFile(archivesDir, archive, file) {
  return JSON.parse(readFileSync(join(archivesDir, archive, file), "utf8"));
}

/**
 * Returns one entry per (archive, file), each carrying the parsed raw
 * document and its chat-lane incumbent conversations already filtered.
 * `rep` mirrors generate.mjs's existing semantics: the file's index within
 * its archive (0 or 1 today).
 */
export function loadArchiveConversations(archivesDir) {
  const out = [];
  for (const src of SOURCES) {
    src.files.forEach((file, rep) => {
      const doc = readArchiveFile(archivesDir, src.archive, file);
      const convs = doc.results.filter((r) => r.model === src.incumbentModel && r.lane === CHAT_LANE);
      out.push({ archive: src.archive, file, rep, doc, convs, incumbentModel: src.incumbentModel });
    });
  }
  return out;
}

/**
 * Flattened stimulus pool: one entry per archived incumbent turn, carrying
 * only what a fresh compiled-state pairing needs — the turn's own `user`
 * stimulus text plus its identity (archive/rep/beat/turn), never the
 * incumbent's reply or the persona string (those are generate.mjs's
 * archive-replay concern, not this corpus's).
 */
export function buildStimulusPool(archivesDir) {
  const groups = loadArchiveConversations(archivesDir);
  const pool = [];
  for (const g of groups) {
    for (const conv of g.convs) {
      conv.turns.forEach((t, i) => {
        pool.push({
          id: `${g.archive}-r${g.rep}-${conv.beat}-t${i}`,
          archive: g.archive,
          rep: g.rep,
          beat: conv.beat,
          turn: i,
          user: t.user,
        });
      });
    }
  }
  return pool;
}
