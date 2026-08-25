import { loadConfig } from "./config.js";
import { createVerifierServer } from "./server.js";

const config = loadConfig();
const server = createVerifierServer(config);
server.requestTimeout = config.limits.totalDeadlineMs + 5_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, "0.0.0.0");

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
