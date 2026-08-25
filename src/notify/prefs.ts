// The permission's memory, as a type. A LEAF: no imports at all.
//
// It lives in its own file rather than in `./index.ts` for the reason
// `src/state/store.ts`'s own header gives about `ActivityRecord`: the state
// layer must not import the engine, and `./index.ts` reaches
// `src/engine/persona.ts` for her name. A `import type` of a leaf is erased at
// compile time and drags nothing; a type re-exported from a module with runtime
// imports is a trap that only springs when someone bundles the store for a
// node eval and gets the whole persona with it.

export interface NotifyPrefs {
  /** When the FELT moment happened: the first time a notification would have
   *  been useful and there was no permission to send one. The explainer sheet
   *  waits for this, which is what makes an ask at onboarding structurally
   *  impossible — nothing can set it until she has already texted or called. */
  felt?: number;
  /** When the SYSTEM dialog was shown. Android 13+ gives exactly one, ever. */
  asked?: number;
  /** He said no, at the sheet or at the system dialog. Terminal, by promise:
   *  the sheet's own copy says "We will not ask again", and `shouldExplain`
   *  is what makes that a fact rather than an intention. */
  declined?: number;
  /** He said yes and the OS agreed. */
  granted?: number;
  /** His own switch, for afterwards. Absent means on — the same
   *  absent-means-default rule `theme` and `soundOn` follow, so the field
   *  arriving changes nothing for any install that predates it. */
  enabled?: boolean;
}

/** What "felt" a moment can be. Only two things in this product can be felt
 *  through a closed app, and both are events she caused. */
export type FeltReason = "message" | "call";
