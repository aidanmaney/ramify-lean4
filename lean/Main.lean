import Ppharness

open Lean Ppharness

def emitForSource (src : String) (fileName : String) (traces lint widgetData : Bool) :
    IO Unit := do
  let objs ← parseSource src fileName (traces := traces) (lint := lint)
    (widgetData := widgetData)
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
  -- `--widget-data` adds what only the widget used to carry — diagnostics,
  -- tactic edits and tokens, the declaration header, and the tagged goals and
  -- token hovers BAKED to plain strings — for the static viewer
  -- (`web/scripts/publish.mjs`). Off for `gen.sh`, so the corpus is unchanged.
  let widgetData := args.contains "--widget-data"
  match args.filter (!·.startsWith "--") with
  | [] =>

      let src ← (← IO.getStdin).readToEnd
      emitForSource src "<stdin>" traces lint widgetData
  | paths =>

      for path in paths do
        try
          enableInitializersExecution
          let src ← IO.FS.readFile path
          emitForSource src path traces lint widgetData
        catch e =>
          (← IO.getStderr).putStrLn s!"[ppharness] {path}: {e.toString}"
