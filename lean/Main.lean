import Ppharness

open Lean Ppharness

def emitForSource (src : String) (fileName : String) : IO Unit := do
  let objs ← parseSource src fileName
  for obj in objs do

    IO.println (Json.mkObj [("file", toJson fileName), ("data", obj)]).compress

unsafe def main (args : List String) : IO Unit := do
  enableInitializersExecution
  match args with
  | [] =>

      let src ← (← IO.getStdin).readToEnd
      emitForSource src "<stdin>"
  | paths =>

      for path in paths do
        try
          enableInitializersExecution
          let src ← IO.FS.readFile path
          emitForSource src path
        catch e =>
          (← IO.getStderr).putStrLn s!"[ppharness] {path}: {e.toString}"
