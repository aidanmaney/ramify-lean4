import Ppharness

open Lean Ppharness

def emitForSource (src : String) (fileName : String) (traces lint : Bool) :
    IO Unit := do
  let objs ← parseSource src fileName (traces := traces) (lint := lint)
  for obj in objs do

    IO.println (Json.mkObj [("file", toJson fileName), ("data", obj)]).compress

unsafe def main (args : List String) : IO Unit := do
  enableInitializersExecution
  -- `--traces` (B4) costs ONE extra elaboration of the whole file: every
  -- automation tactic is rewritten to its `?` form together and the file
  -- re-elaborated once. Off by default because that doubles `gen.sh`.
  let traces := args.contains "--traces"
  -- `--lint` (D4) turns Mathlib's linters on inside the SAME elaboration, so
  -- it costs the linter passes rather than a second pass over the file.
  let lint := args.contains "--lint"
  match args.filter (!·.startsWith "--") with
  | [] =>

      let src ← (← IO.getStdin).readToEnd
      emitForSource src "<stdin>" traces lint
  | paths =>

      for path in paths do
        try
          enableInitializersExecution
          let src ← IO.FS.readFile path
          emitForSource src path traces lint
        catch e =>
          (← IO.getStderr).putStrLn s!"[ppharness] {path}: {e.toString}"
