# Temporary presentation boundary

This namespace preserves the complete Rooms creator workspace from
origin/codex/vyakti-completion. The personal recording and durable build journey
remains in src/studio. Both use the same authentication session, replica ID,
server APIs and database; neither creates a separate memory or publication engine.

The Studio entry loads only one workspace. Explicit teacher mode opens the
creator workspace, while replica mode opens the personal voice journey. Share
and My voice carry the exact replica in the URL. Publication still runs the
existing readiness, runtime and reviewed teaching-profile predicates.

Next consolidation: extract shared API contracts, auth, tokens and reusable
panels after both signed-in fixture suites pass, then replace the teaching-only
profile with an explicitly reviewed expert schema. Do not copy voice authority
or implement a second Room reply path. Do not remove either fixture's coverage
when deleting duplicate presentation files.
