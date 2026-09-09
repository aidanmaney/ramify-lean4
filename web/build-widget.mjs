import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/widget.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/proofTreeWidget.js",

  external: ["react", "react-dom", "react/jsx-runtime", "@leanprover/infoview"],
  jsx: "automatic",
  minify: true,
  logLevel: "info",
});
