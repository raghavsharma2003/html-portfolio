// Main-registry entry point. Never chooses the hosted/database mode.
import assert from 'node:assert/strict';

assert.equal(process.argv.length, 2, 'source-only registry wrapper accepts no arguments');
process.argv.push('--source-only');
await import('./run.mjs');
