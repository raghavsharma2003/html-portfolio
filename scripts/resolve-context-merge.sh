#!/bin/bash
# Union-resolve the append-only `context/` files after an agent merge.
#
# This lived in an ephemeral session scratchpad and was rebuilt from memory more
# than once, so it lives in the repo now. Merging `context/` by hand is not a
# judgement call: decisions/rejected/measurements/architecture are append-only
# prose, so BOTH sides are always right and the union is the answer. graph.json
# is a node/edge SET, so it unions by id and by (src, rel, dst). Anything else
# that conflicts is a real conflict and is left alone for a person to read.
#
# STATE.md is the one exception and the reason the heal step below exists: it
# has a narrative HEADER, and a header is not append-only.
#
# Usage: after `git merge` reports conflicts, run this, check `git diff`, commit.
set -u
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re, subprocess, json, sys

conflicted = [l[3:] for l in subprocess.run(
    ['git','status','--porcelain'],capture_output=True,text=True).stdout.splitlines()
    if l.startswith(('UU ','AA '))]

prose = [p for p in conflicted if p.endswith('.md')]
graph = [p for p in conflicted if p.endswith('graph.json')]
other = [p for p in conflicted if p not in prose and p not in graph]

for p in prose:
    s = open(p).read()
    n = s.count('<<<<<<<')
    s = re.sub(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', r'\1\2', s, flags=re.S)
    open(p,'w').write(s)
    print(f"  prose  {p}: {n} hunk(s) unioned, {s.count('<<<<<<<')} left")

# SELF-HEAL THE ONE FILE THAT IS NOT ACTUALLY APPEND-ONLY AT THE TOP.
# STATE.md has a narrative header, and a header is not append-only: every agent
# that added its own "Last updated" line there survived this union, and eight of
# them stacked up twice. The file now carries a "## Session log" section at the
# bottom, which IS append-only, so any header-region line found here is moved
# there rather than left to pile up. Fixing the helper, not the symptom.
STATE = 'context/STATE.md'
if STATE in prose:
    lines = open(STATE).read().split('\n')
    try:
        first_h2 = next(i for i, l in enumerate(lines) if l.startswith('## '))
    except StopIteration:
        first_h2 = len(lines)
    head, body = lines[:first_h2], lines[first_h2:]
    moved, kept = [], []
    for l in head:
        m = re.match(r'^Last updated: \d{4}-\d\d-\d\d \((WS-[A-Z]+): (.*)\)\s*$', l)
        if m:
            moved.append(f'- **{m.group(1)}** — {m.group(2)}')
        else:
            kept.append(l)
    if moved:
        out = '\n'.join(kept + body).rstrip('\n')
        if '## Session log' not in out:
            out += '\n\n## Session log\n\nAppend-only. One line per workstream, newest at the bottom.\n'
        out += '\n' + '\n'.join(moved) + '\n'
        open(STATE, 'w').write(out)
        print(f"  heal   {STATE}: {len(moved)} header line(s) moved to the session log")

for p in graph:
    o = json.loads(subprocess.run(['git','show',f':2:{p}'],capture_output=True,text=True).stdout)
    t = json.loads(subprocess.run(['git','show',f':3:{p}'],capture_output=True,text=True).stdout)
    ids = {n['id'] for n in o['nodes']}
    for n in t['nodes']:
        if n['id'] not in ids: o['nodes'].append(n); ids.add(n['id'])
    have = {(e['src'],e['rel'],e['dst']) for e in o['edges']}
    for e in t['edges']:
        k = (e['src'],e['rel'],e['dst'])
        if k not in have: o['edges'].append(e); have.add(k)
    for key in ('relations','kinds'):
        for k,v in t.get(key,{}).items(): o.setdefault(key,{}).setdefault(k,v)
    json.dump(o, open(p,'w'), indent=2)
    print(f"  graph  {p}: {len(o['nodes'])} nodes, {len(o['edges'])} edges")

if other:
    print("  UNRESOLVED (needs a human read):")
    for p in other: print(f"    {p}")
    sys.exit(2)
PY
