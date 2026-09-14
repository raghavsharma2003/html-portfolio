#!/usr/bin/env python3
# keep-both for src/studio/copy.ts: when ours' side ends inside an open block
# (its last line is not a closer) and theirs' side starts a new top-level
# section, insert the closer between them.
import sys, re
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().split("\n")
out, i, n, fixed = [], 0, 0, 0
while i < len(lines):
    l = lines[i]
    if l.startswith("<<<<<<< "):
        ours, theirs, mode = [], [], "ours"; i += 1
        while i < len(lines) and not lines[i].startswith(">>>>>>> "):
            if lines[i].startswith("=======") and mode == "ours": mode = "theirs"
            elif mode == "ours": ours.append(lines[i])
            else: theirs.append(lines[i])
            i += 1
        n += 1
        last = next((x for x in reversed(ours) if x.strip()), "")
        first = next((x for x in theirs if x.strip()), "")
        if not last.rstrip().endswith(("}", "},")) and re.match(r"^(  \w+: \{|// |interface )", first):
            if re.match(r"^(// |interface )", first) or re.match(r"^  \w+: \w+Copy;", last):
                ours.append("}" if not re.match(r"^  \w+: \w+Copy;", last) else None)
                if ours[-1] is None: ours.pop()
            else:
                ours.append("  },")
            fixed += 1
        out.extend(ours); out.extend(theirs)
    else:
        out.append(l)
    i += 1
open(p, "w", encoding="utf-8").write("\n".join(out))
print(f"{p}: {n} hunks, {fixed} closers inserted")
