import Ppharness

/-!
# ppharness CLI

Emits **NDJSON**: one compact JSON object per proof, one per line.

NDJSON is deliberate. Because output is line-delimited and streamed, you control
how much data you consume downstream -- `| head -n 100`, `split`, or a
line-by-line reader -- without ever holding the whole corpus in memory. That is
the "I don't know yet how much data I'll need" knob.

Usage:
  lake exe ppharness FILE.lean [FILE2.lean ...]   # parse each file
  echo 'theorem t : True := by trivial' | lake exe ppharness   # parse stdin

Each output line:  {"file": "<path>", "data": {"index": N, "proof": {steps, allGoals}}}
-/

open Lean Ppharness

/-- Parse one source string and print one NDJSON line per proof found. -/
def emitForSource (src : String) (fileName : String) : IO Unit := do
  let objs ← parseSource src fileName
  for obj in objs do
    -- `.compress` = single line (no pretty newlines), so each proof is exactly one record.
    IO.println (Json.mkObj [("file", toJson fileName), ("data", obj)]).compress

-- `unsafe` so we may call `enableInitializersExecution`: importing a module
-- (here, `import Mathlib`) runs that module's `@[init]` declarations via the
-- interpreter, which is only permitted once initializer execution is enabled.
-- Without this, loading any Mathlib-importing source aborts with
-- "cannot evaluate `[init]` declaration … in the same module". Must run before
-- the first import (i.e. before `processHeader`), so it goes first in `main`.
unsafe def main (args : List String) : IO Unit := do
  enableInitializersExecution
  match args with
  | [] =>
      -- No paths → read a single source from stdin (handy for piping one theorem).
      let src ← (← IO.getStdin).readToEnd
      emitForSource src "<stdin>"
  | paths =>
      -- Process each file independently; a failure on one file is logged to stderr
      -- and does not abort the batch -- important when scaling over many files.
      for path in paths do
        try
          let src ← IO.FS.readFile path
          emitForSource src path
        catch e =>
          (← IO.getStderr).putStrLn s!"[ppharness] {path}: {e.toString}"
