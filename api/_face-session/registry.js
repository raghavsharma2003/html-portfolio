import { createAzureFaceSessionBroker, createAzureFaceSessionErasureBroker } from "./providers/azure-quicklink.js";

export function configuredFaceSessionBroker(options = {}) {
  const env = options.env || process.env;
  const name = String(env.REPLICA_FACE_SESSION_BROKER || "").trim();
  if (!name) return null;
  if (name !== "azure_face_liveness_quicklink") {
    throw Object.assign(new Error("face_session_broker_unsupported"), { code: "face_session_broker_unsupported", status: 503 });
  }
  return createAzureFaceSessionBroker(options);
}

export function configuredFaceSessionErasureBroker(options = {}) {
  const env = options.env || process.env;
  const name = String(env.REPLICA_FACE_SESSION_BROKER || "").trim();
  if (!name) return null;
  if (name !== "azure_face_liveness_quicklink") {
    throw Object.assign(new Error("face_session_broker_unsupported"), { code: "face_session_broker_unsupported", status: 503 });
  }
  return createAzureFaceSessionErasureBroker(options);
}
