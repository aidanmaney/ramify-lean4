// Bundle the infoview user-widget (src/widget.tsx) into a single ES module that
// the Lean widget module `include_str`s (lean/ProofTreeWidget.lean).
//
// The infoview host already provides react / react-dom / @leanprover/infoview,
// so those are externalized (imported, not bundled) — mirroring ProofWidgets'
// own rollup config. Everything else (d3-dag, the renderer) is bundled in.
//
// Run before `lake build` (see CLAUDE.md). Output is web/dist/proofTreeWidget.js,
// which is gitignored — it is a build artifact, like ProofWidgets' .lake/build/js.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/widget.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/proofTreeWidget.js",
  // Provided by the infoview at runtime — must not be bundled.
  external: ["react", "react-dom", "react/jsx-runtime", "@leanprover/infoview"],
  jsx: "automatic",
  minify: true,
  logLevel: "info",
});
