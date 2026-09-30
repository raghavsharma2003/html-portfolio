// A forced exit can discard queued pipe writes. Keep the runner's terminal
// control flow, but wait for both ordered stream callbacks before exiting.
export async function exitWithFlushedOutput(code) {
  process.exitCode = code;
  const flush = stream => new Promise((resolve, reject) => {
    stream.write('', error => error ? reject(error) : resolve());
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}
