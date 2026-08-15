import fs from "fs";
const report = JSON.parse(fs.readFileSync("report.json", "utf8"));

const fab = report.fabrication_powered_comparison;
const engArch = report.engagement_archived_canonical;

const engagementRises = engArch.p_two_sided < 0.001; // n=240/arm matched-batch, already powered
const fabricationDoesNotSignificantlyRise = fab.p_two_sided >= 0.05;
const meetsPowerBar = fab.both_arms_meet_n300;

const bundle = {
  model: "grok-4-20-non-reasoning",
  battery: "visiongate-confirm",
  n: Math.min(fab.n_before, fab.n_v4b), // the binding (smaller) arm's assertion count, per this project's own n>=300 law
  result: {
    question: "can engagement rise without fabrication rising?",
    arms: report.arms,
    fabrication: {
      ...fab,
      interpretation:
        "Not statistically significant (p=0.64); point estimate +1.0pp (v4b higher). 95% CI on the difference is " +
        "[-3.1pp, +5.1pp] -- wide enough that failing to reach significance is NOT the same claim as proving no " +
        "effect; a true small rise (up to ~5pp) is not excluded at this n. This IS the first time this comparison " +
        "has cleared the project's own n>=300 fab-noise-floor bar on BOTH arms.",
    },
    engagement: {
      archived_canonical_n240_per_arm: engArch,
      this_run_pooled_with_drift_caveat: report.engagement_this_run_pooled,
      interpretation:
        "Robust and highly significant under the original matched-batch (same-day) archived sampling (p<0.0001). " +
        "A newly observed temporal-drift finding (see process_finding_2) widens the pooled gap further, not the reverse.",
    },
    process_finding_1_incomplete_prior_judging: {
      what: "visiongate-interim's reported v4b fabrication rate (6.8%, n=59) was computed from a PARTIAL judge pass " +
        "-- only 33 of the 100 archived spoken replies had been scored; 67 sat generated-but-unjudged. Completing " +
        "the judging of that SAME already-paid-for archived data (zero new generation calls, 67 judge calls only) " +
        "moves the archived-only v4b rate to 12.0% (21/175) -- HIGHER than the archived before-arm's 7.2%. The " +
        "'flat' read in visiongate-interim was an artifact of incomplete scoring on one arm, not a property of the text.",
      evidence: "out/v4b_comment.archive_rows.json (240 rows, dir=v4b_comment) x out/v4b_comment.judged.json",
    },
    process_finding_2_temporal_drift: {
      what: "Both arms' engagement rate shifted materially between the Aug-11 archived battery and this Aug-15 run, " +
        "in the SAME direction that widens (not narrows) the engagement gap: before-arm 20.4%(n=240,Aug11) -> " +
        "7.9%(n=720,Aug15) -> 7.3%(n=1360,Aug15); v4b-arm 41.7%(n=240,Aug11) -> 57.1%(n=560,Aug15). The two new " +
        "before-arm batches agree closely with each other (7.9% / 7.3%) and both disagree with the archived rate, " +
        "so this reads as a real behavior shift in the underlying deployment over the 4 days, not batch noise. " +
        "Consistent with config/models.json's own flagged risk: grok-4-20-non-reasoning on this Foundry deployment " +
        "'is a beta build that could change underneath us.' Recommended follow-up, not resolved here: a scheduled " +
        "re-run of this exact battery to characterize drift as a trend rather than a two-point observation.",
    },
  },
  passed: engagementRises && fabricationDoesNotSignificantlyRise && meetsPowerBar,
  passed_caveat:
    "'passed' reflects the gate's literal stated criterion (engagement rises, fabrication does not SIGNIFICANTLY " +
    "rise, both arms >=n300). It is not an equivalence claim -- the fabrication CI does not exclude a true small " +
    "rise. Recommend the coordinator (Fable, per this repo's model policy) makes the actual ship/no-ship call using " +
    "this evidence plus process_finding_2's drift risk, rather than this bundle self-certifying.",
  spend: report.spend_this_confirmatory_run,
  at: new Date().toISOString(),
};

fs.writeFileSync("gate-bundle.json", JSON.stringify(bundle, null, 2));
console.log("wrote gate-bundle.json");
console.log("passed:", bundle.passed);
