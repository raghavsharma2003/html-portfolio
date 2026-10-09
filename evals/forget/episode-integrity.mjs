// A partial forget removes selected raw turns and the derived episode that
// covered them. Raw turns that survive must stop citing the deleted episode in
// the same statement, and the consolidator needs a content-free provisional
// wake episode to discover them again.
//
// This is a source-level SQL-shape gate because CI has no PostgreSQL server.
// The negative controls prove each required part is load-bearing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const source = readFileSync(join(ROOT, "api", "memory.js"), "utf8");

let failed = 0;
function ok(name, condition, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function partialEpisodeCursorIsAtomic(text) {
  const purgeStart = text.indexOf("async function purgeRelational");
  const purgeEnd = text.indexOf("async function rebuildRelState", purgeStart);
  if (purgeStart < 0 || purgeEnd < 0) return false;
  const purge = text.slice(purgeStart, purgeEnd);
  const unclaimedCte = purge.indexOf("), unclaimed_logs as (");
  const begin = purge.lastIndexOf("`with recursive doomed as (", unclaimedCte);
  const episodeDelete = purge.indexOf("delete from vy_episode", unclaimedCte);
  const end = purge.indexOf("returning id`", episodeDelete);
  if (begin < 0 || episodeDelete < 0 || end < 0) return false;
  const statement = purge.slice(begin, end);
  const unclaim = statement.indexOf("update meera_log l set episode_id = null");
  const wake = statement.indexOf("insert into vy_episode", unclaim);
  const remove = statement.indexOf("delete from vy_episode", wake);
  return (
    unclaim >= 0 &&
    wake > unclaim &&
    remove > wake &&
    /l\.episode_id in \(select id from doomed\)/.test(statement) &&
    /returning l\.id,l\.agent_id,l\.device_id,l\.channel,l\.at,l\.group_id,l\.room_memory_follower_id/.test(statement) &&
    /from unclaimed_logs l/.test(statement) &&
    /l\.group_id is null and l\.room_memory_follower_id is null/.test(statement) &&
    /'backfill',min\(l\.id\),max\(l\.id\),'',true/.test(statement) &&
    /group by l\.agent_id,l\.device_id,case when l\.channel = 'call' then 'call' else 'chat' end/.test(statement) &&
    /select count\(\*\) from unclaimed_logs/.test(statement) &&
    /select count\(\*\) from wake_episodes/.test(statement) &&
    !/l\.content/.test(statement)
  );
}

console.log("\n── partial forget episode integrity ──");
ok(
  "episode deletion atomically unclaims survivors and leaves a content-free wake marker",
  partialEpisodeCursorIsAtomic(source),
);

const cursorMutant = source.replace(
  "update meera_log l set episode_id = null",
  "update meera_log l set episode_id = episode_id",
);
ok(
  "NEGATIVE CONTROL: leaving surviving cursors unchanged is detected",
  cursorMutant !== source && !partialEpisodeCursorIsAtomic(cursorMutant),
);

const summaryMutant = source.replace(
  "'backfill',min(l.id),max(l.id),'',true",
  "'backfill',min(l.id),max(l.id),'invented summary',true",
);
ok(
  "NEGATIVE CONTROL: inventing a replacement summary is detected",
  summaryMutant !== source && !partialEpisodeCursorIsAtomic(summaryMutant),
);

const wakeMutant = source.replace("from unclaimed_logs l", "from meera_log l");
ok(
  "NEGATIVE CONTROL: waking from rows outside the deletion is detected",
  wakeMutant !== source && !partialEpisodeCursorIsAtomic(wakeMutant),
);

const guardMutant = source.replace(
  "and (select count(*) from unclaimed_logs) >= 0",
  "and true",
);
ok(
  "NEGATIVE CONTROL: removing the unclaim execution guard is detected",
  guardMutant !== source && !partialEpisodeCursorIsAtomic(guardMutant),
);

if (failed) {
  console.error(`\n${failed} partial-forget integrity assertion(s) FAILED`);
  process.exit(1);
}
console.log("\n5/5 partial-forget integrity assertions passed");
