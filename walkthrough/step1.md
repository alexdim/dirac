# Line-Anchored MultiFile Edits

**Dirac targets exact source lines with opaque stateful IDs and can batch multiple edits in a single file and across multiple files.**

Each edit coordinate pairs a task-scoped line ID with the exact current source content. Unchanged lines keep their IDs as surrounding code shifts, enabling precise refactors without relying on line numbers.

![Dirac planning demonstration](../assets/media/multiple_edit.png)
