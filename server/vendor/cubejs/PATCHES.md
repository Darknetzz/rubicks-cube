# Local changes to cubejs 1.3.2

`solve.js` is patched (search for `PATCH (rubiks-cube)`), to let the server iterate two-phase with a shrinking
maximum length under a time budget. cubejs has no timeout or keep-searching option of its own.

- `Cube.prototype.solve(maxDepth, deadline)` and `solveUpright(maxDepth, deadline)` take an optional deadline
  (`Date.now()` milliseconds). Past it, the search throws `Cube.SolveTimeout`.
- When no solution of at most `maxDepth` moves is found, they return `null` instead of throwing a TypeError.

Everything else is unchanged.
