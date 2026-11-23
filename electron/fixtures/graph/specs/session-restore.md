---
id: DB-12
status: draft
owner: 서연
tags: [restore, sessions]
---

# Session restore

Restore every tab after a relaunch, in the same layout.

## Plan

1. `planRestore` reads the saved layout and decides which tabs wake now.
2. Hidden tabs stay asleep until they are shown.

See https://github.com/example/aquila/issues/12 for the original report.
