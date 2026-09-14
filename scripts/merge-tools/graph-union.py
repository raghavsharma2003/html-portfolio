import json, subprocess, sys
# usage: graph-union.py <branch>   (ours = index/HEAD version, theirs = branch)
branch = sys.argv[1]
o = json.loads(subprocess.check_output(["git","show","HEAD:context/graph.json"]))
t = json.loads(subprocess.check_output(["git","show",f"{branch}:context/graph.json"]))
ids = {n["id"] for n in o["nodes"]}; an = 0
for n in t["nodes"]:
    if n["id"] not in ids: o["nodes"].append(n); ids.add(n["id"]); an += 1
ek = {(e["src"],e["rel"],e["dst"]) for e in o["edges"]}; ae = 0
for e in t["edges"]:
    k = (e["src"],e["rel"],e["dst"])
    if k not in ek: o["edges"].append(e); ek.add(k); ae += 1
json.dump(o, open("context/graph.json","w"), indent=2, ensure_ascii=True); open("context/graph.json","a").write("\n")
print(f"graph union: +{an} nodes +{ae} edges")
