// Offline source review and experiment index. Commands are display-only metadata.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REGISTRY_PATH = 'docs/gurukul/research/registry.json';
const DAY = 86_400_000;
const REVIEW_DAYS = Object.freeze({ paper: 90, official_docs: 14, official_repository: 14, standard: 90 });
const SOURCE_FIELDS = ['id', 'title', 'url', 'kind', 'publishedAt', 'retrievedAt', 'version', 'evidence', 'decision', 'claim', 'limitations', 'relevance', 'experimentId'];
const EXPERIMENT_FIELDS = ['id', 'title', 'state', 'outcome', 'observedAt', 'hypothesis', 'sourceIds', 'artifactPaths', 'runCommand', 'successCriteria', 'evidenceScope', 'result'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const text = (value, max = 5000) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const identifier = value => text(value, 100) && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}

// Never fetch or resolve a citation. Query strings, credentials and local hosts
// have no place in this public source ledger.
export function citationIdentity(value) {
  if (!text(value, 2048) || /\s|\\|%(?![\da-f]{2})/i.test(value)) throw new Error('invalid citation URL');
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.port
      || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.')
      || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) || host.endsWith('.')) {
    throw new Error('citation must be a public HTTPS URL without credentials, port or query');
  }
  url.hash = '';
  url.pathname = url.pathname.replace(/%([\da-f]{2})/gi, (escape, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/.test(char) ? char : escape.toUpperCase();
  }).replace(/\/+$/, '') || '/';
  return url.href;
}

function exactObject(value, fields, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}: expected an object`);
    return false;
  }
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    errors.push(`${label}: fields must be exactly ${fields.join(', ')}`);
  }
  return true;
}

function list(value, min, max, predicate = item => text(item, 2000)) {
  return Array.isArray(value) && value.length >= min && value.length <= max
    && value.every(predicate) && new Set(value).size === value.length;
}

function artifactExists(value, root) {
  if (!text(value, 500) || /[\\:]/.test(value) || path.posix.isAbsolute(value)
      || value.split('/').some(part => ['', '.', '..'].includes(part))) return false;
  try {
    const base = realpathSync(root);
    const target = realpathSync(path.join(base, value));
    const relative = path.relative(base, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative) && statSync(target).isFile();
  } catch { return false; }
}

export function validateRegistry(registry, { root = ROOT } = {}) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  if (!exactObject(registry, ['schemaVersion', 'asOf', 'sources', 'experiments'], 'registry', errors)) return errors;
  require(registry.schemaVersion === 1, 'registry.schemaVersion: must be 1');
  const asOf = calendarDate(registry.asOf);
  require(asOf !== null, 'registry.asOf: real YYYY-MM-DD required');
  if (!Array.isArray(registry.sources) || !Array.isArray(registry.experiments)) return [...errors, 'sources and experiments must be arrays'];
  require(registry.sources.length >= 1 && registry.sources.length <= 2000, 'sources: expected 1..2000');
  require(registry.experiments.length <= 1000, 'experiments: at most 1000');
  const sources = new Map(), experiments = new Map(), citations = new Set();
  for (const [i, source] of registry.sources.entries()) {
    const label = `sources[${i}]`;
    if (!exactObject(source, SOURCE_FIELDS, label, errors)) continue;
    require(identifier(source.id), `${label}.id: invalid identifier`);
    require(!sources.has(source.id), `${label}.id: duplicate identifier`);
    sources.set(source.id, source);
    require(text(source.title, 300), `${label}.title: bounded text required`);
    try {
      const identity = citationIdentity(source.url);
      require(!citations.has(identity), `${label}.url: duplicate canonical citation`);
      citations.add(identity);
    } catch { errors.push(`${label}.url: invalid public citation`); }
    require(Object.hasOwn(REVIEW_DAYS, source.kind ?? ''), `${label}.kind: unknown source kind`);
    const retrieved = calendarDate(source.retrievedAt), published = calendarDate(source.publishedAt);
    require(retrieved !== null && asOf !== null && retrieved <= asOf, `${label}.retrievedAt: real date no later than snapshot required`);
    require(source.publishedAt === null || (published !== null && retrieved !== null && published <= retrieved), `${label}.publishedAt: real date no later than retrieval or null required`);
    require(retrieved === null || !Object.hasOwn(REVIEW_DAYS, source.kind ?? '')
      || retrieved + REVIEW_DAYS[source.kind] * DAY <= calendarDate('9999-12-31'), `${label}.retrievedAt: review interval exceeds calendar range`);
    require(source.version === null || text(source.version, 160), `${label}.version: bounded text or null required`);
    require(['author_reported', 'documentation', 'independent_study'].includes(source.evidence), `${label}.evidence: invalid category`);
    require(['adopt', 'experiment', 'watch', 'defer'].includes(source.decision), `${label}.decision: invalid category`);
    require(text(source.claim), `${label}.claim: bounded text required`);
    require(list(source.limitations, 1, 32), `${label}.limitations: unique bounded texts required`);
    require(list(source.relevance, 1, 32), `${label}.relevance: unique bounded texts required`);
    require(source.experimentId === null || identifier(source.experimentId), `${label}.experimentId: identifier or null required`);
    require(source.decision !== 'experiment' || source.experimentId !== null, `${label}.experimentId: experiment decision requires a target`);
  }
  for (const [i, experiment] of registry.experiments.entries()) {
    const label = `experiments[${i}]`;
    if (!exactObject(experiment, EXPERIMENT_FIELDS, label, errors)) continue;
    require(identifier(experiment.id), `${label}.id: invalid identifier`);
    require(!experiments.has(experiment.id) && !sources.has(experiment.id), `${label}.id: duplicate identifier`);
    experiments.set(experiment.id, experiment);
    require(text(experiment.title, 300) && text(experiment.hypothesis), `${label}: title and hypothesis required`);
    require(['planned', 'implemented', 'completed'].includes(experiment.state), `${label}.state: invalid execution state`);
    require(experiment.outcome === null || ['pass', 'fail', 'inconclusive'].includes(experiment.outcome), `${label}.outcome: invalid measured outcome`);
    require(list(experiment.sourceIds, 1, 128, identifier), `${label}.sourceIds: unique identifiers required`);
    if (Array.isArray(experiment.sourceIds)) for (const id of experiment.sourceIds) require(sources.has(id), `${label}.sourceIds: unknown source ${id}`);
    require(list(experiment.artifactPaths, experiment.state === 'planned' ? 0 : 1, 128, value => artifactExists(value, root)), `${label}.artifactPaths: existing files inside this repository required`);
    require(experiment.runCommand === null || text(experiment.runCommand, 2000), `${label}.runCommand: bounded display-only text or null required`);
    require(list(experiment.successCriteria, 1, 32), `${label}.successCriteria: unique bounded texts required`);
    require(['offline_contract', 'historical_runtime', 'product_trial'].includes(experiment.evidenceScope), `${label}.evidenceScope: unknown scope`);
    require(experiment.result === null || text(experiment.result, 10000), `${label}.result: bounded text or null required`);
    if (experiment.state === 'completed') {
      const observed = calendarDate(experiment.observedAt);
      require(experiment.outcome !== null, `${label}: completed execution needs an outcome`);
      require(observed !== null && asOf !== null && observed <= asOf, `${label}.observedAt: real date no later than snapshot required`);
      require(text(experiment.result, 10000) && !/^(?:passed|pass|success|done|failed|fail|tbd|pending)[.!]?$/i.test(experiment.result), `${label}.result: concrete observation required`);
    } else {
      require(experiment.outcome === null && experiment.observedAt === null && experiment.result === null, `${label}: unexecuted experiment cannot carry an outcome or result`);
    }
    require(experiment.evidenceScope !== 'historical_runtime' || experiment.runCommand === null, `${label}: historical executions cannot advertise a replay command`);
  }
  for (const source of sources.values()) {
    if (source.experimentId === null) continue;
    const experiment = experiments.get(source.experimentId);
    require(Boolean(experiment) && Array.isArray(experiment.sourceIds) && experiment.sourceIds.includes(source.id), `source ${source.id}: experiment reference must exist and link back`);
  }
  return errors;
}

export function buildQueue(registry, { asOf = registry?.asOf, root = ROOT } = {}) {
  const errors = validateRegistry(registry, { root });
  const timestamp = calendarDate(asOf);
  if (timestamp === null || asOf < registry?.asOf) errors.push('queue asOf must be a real date on or after registry.asOf');
  if (errors.length) throw new Error(`Research registry invalid:\n- ${errors.join('\n- ')}`);
  const sourceReviews = registry.sources.map(source => {
    const due = calendarDate(source.retrievedAt) + REVIEW_DAYS[source.kind] * DAY;
    return {
      id: source.id, decision: source.decision, url: citationIdentity(source.url),
      reviewAt: new Date(due).toISOString().slice(0, 10), stale: timestamp >= due,
      overdueDays: Math.max(0, Math.floor((timestamp - due) / DAY)),
    };
  }).sort((a, b) => Number(b.stale) - Number(a.stale) || b.overdueDays - a.overdueDays || compare(a.reviewAt, b.reviewAt) || compare(a.id, b.id));
  const stale = new Set(sourceReviews.filter(source => source.stale).map(source => source.id));
  const experiments = registry.experiments.filter(experiment => experiment.state !== 'completed' || experiment.outcome !== 'pass').map(experiment => ({
    id: experiment.id, state: experiment.state, outcome: experiment.outcome, evidenceScope: experiment.evidenceScope,
    staleSourceIds: experiment.sourceIds.filter(id => stale.has(id)).sort(compare),
    nextAction: experiment.state === 'completed' ? 'design_followup_from_recorded_outcome'
      : experiment.sourceIds.some(id => stale.has(id)) ? 'refresh_sources'
        : experiment.state === 'planned' ? 'implement_bounded_experiment' : 'run_and_record_evidence',
    runCommand: experiment.runCommand,
  })).sort((a, b) => Number(b.state === 'completed') - Number(a.state === 'completed') || compare(a.id, b.id));
  return {
    asOf, registryAsOf: registry.asOf, mode: 'offline_snapshot',
    notice: 'Metadata review only. No sources fetched, commands executed, results reproduced, providers selected or background monitoring enabled. A passing experiment is limited to its stated evidence scope.',
    sourceReviews, experiments,
  };
}

export function main(args) {
  const [command, ...flags] = args;
  if (!['check', 'queue'].includes(command)) throw new Error('Usage: node scripts/research-cycle.mjs check | queue [--as-of YYYY-MM-DD] [--json]');
  let asOf, json = false;
  for (let i = 0; i < flags.length; i++) {
    if (command === 'queue' && flags[i] === '--as-of' && asOf === undefined && flags[i + 1]) asOf = flags[++i];
    else if (command === 'queue' && flags[i] === '--json' && !json) json = true;
    else throw new Error('Unknown, duplicate or incomplete argument');
  }
  const registry = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_PATH), 'utf8'));
  if (command === 'check') {
    const errors = validateRegistry(registry);
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write(`Research metadata valid: ${registry.sources.length} sources, ${registry.experiments.length} experiments. Results were not re-executed.\n`);
    return;
  }
  const queue = buildQueue(registry, { asOf: asOf ?? registry.asOf });
  process.stdout.write(json ? `${JSON.stringify(queue, null, 2)}\n` : [
    `Research review queue: ${queue.asOf} (snapshot ${queue.registryAsOf})`, queue.notice, '',
    ...queue.sourceReviews.map(source => `${source.stale ? 'DUE' : 'upcoming'} ${source.id}: ${source.reviewAt}`), '',
    ...queue.experiments.map(experiment => `${experiment.id}: ${experiment.nextAction} (${experiment.evidenceScope}, outcome ${experiment.outcome ?? 'unmeasured'})`), '',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
