import PlaygroundLive
/-! `lake exe playgroundlive [LEANPATH]` — the live engine natively: one JSON
request per stdin line, one answer per stdout line (`PlaygroundLive.lean`).
LEANPATH defaults to the toolchain's own `lib/lean`. -/

def main (args : List String) : IO UInt32 := do
  let leanPath ← match args with
    | [p] => pure p
    | _ => pure ((← Lean.findSysroot) / "lib" / "lean").toString
  let stdin ← IO.getStdin
  let stdout ← IO.getStdout
  stdout.putStrLn (← Playground.liveInit leanPath)
  stdout.flush
  repeat
    let line ← stdin.getLine
    if line.isEmpty then break
    if line.trimAscii.isEmpty then continue
    stdout.putStrLn (← Playground.liveAnswer line)
    stdout.flush
  return 0
