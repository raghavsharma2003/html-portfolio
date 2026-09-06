#!/usr/bin/env python3
# Resolve git conflict markers in the given files by keeping OURS then THEIRS
# for every conflicted hunk (append-only shared files). Prints hunk counts.
import sys, re
for p in sys.argv[1:]:
    s = open(p, encoding="utf-8").read()
    n = 0
    out = []
    i = 0
    lines = s.split("\n")
    while i < len(lines):
        l = lines[i]
        if l.startswith("<<<<<<< "):
            ours, theirs, mode = [], [], "ours"
            i += 1
            while i < len(lines) and not lines[i].startswith(">>>>>>> "):
                if lines[i].startswith("=======") and mode == "ours":
                    mode = "theirs"
                elif lines[i].startswith("||||||| ") and mode == "ours":
                    mode = "base"
                elif mode == "ours": ours.append(lines[i])
                elif mode == "theirs": theirs.append(lines[i])
                i += 1
            out.extend(ours); out.extend(theirs); n += 1
        else:
            out.append(l)
        i += 1
    open(p, "w", encoding="utf-8").write("\n".join(out))
    print(f"{p}: {n} hunk(s) kept both")
