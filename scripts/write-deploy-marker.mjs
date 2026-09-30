#!/usr/bin/env node
// Materialise source identity passed by the authenticated deploy client.
//
// Vercel can restore and reconcile its build workspace before a custom install
// command runs. Therefore no hash computed inside that workspace can prove the
// bytes the deploy client uploaded. The client computes the commitment first
// and supplies these non-secret values as deployment-scoped build metadata.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPLOY_COMMITMENT_SCHEMA, DEPLOY_PRODUCTS } from "./deploy-commitment.mjs";
import { vercelProduct } from "./vercel-product.mjs";

const HASH = /^sha256:[a-f0-9]{64}$/;
const positiveInteger = (value, maximum) => {
  if (!/^[1-9][0-9]*$/.test(value || "")) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
};

export function markerFromEnvironment(environment = process.env) {
  const product = environment.VYAKTI_SOURCE_PRODUCT || "";
  const sourceCommitment = environment.VYAKTI_SOURCE_COMMITMENT || "";
  const inputFiles = positiveInteger(environment.VYAKTI_SOURCE_INPUT_FILES, 1_000_000);
  const inputBytes = positiveInteger(environment.VYAKTI_SOURCE_INPUT_BYTES, 10_000_000_000);

  if (!DEPLOY_PRODUCTS.includes(product)) throw new Error("deployment source product is missing or invalid");
  if (product !== vercelProduct(environment)) throw new Error("deployment source product does not match target project");
  if (!HASH.test(sourceCommitment)) throw new Error("deployment source commitment is missing or invalid");
  if (inputFiles === null) throw new Error("deployment source file count is missing or invalid");
  if (inputBytes === null) throw new Error("deployment source byte count is missing or invalid");

  return Object.freeze({
    schema: DEPLOY_COMMITMENT_SCHEMA,
    product,
    source_commitment: sourceCommitment,
    input_files: inputFiles,
    input_bytes: inputBytes,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const marker = markerFromEnvironment();
  writeFileSync(".vercel-release-preinstall.json", `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  console.log(`accepted uploaded-source commitment ${marker.source_commitment}`);
}
