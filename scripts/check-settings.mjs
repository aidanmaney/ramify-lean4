#!/usr/bin/env node
// Docs check: every setting the extension contributes and every command it
// contributes must be mentioned in INSTALL.md, so the user manual cannot drift
// from ext/ramify/package.json.
//
//     node scripts/check-settings.mjs [--doc INSTALL.md] [--package ext/ramify/package.json]
//
// A setting counts as documented when its full key (`ramify.hoverBar.tactic`)
// appears in the doc. A command counts as documented when its title
// (`Ramify: Set experience level`) appears verbatim. Exit 1 lists every miss.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : resolve(root, dflt);
};
const pkgPath = opt("--package", "ext/ramify/package.json");
const docPath = opt("--doc", "INSTALL.md");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const doc = readFileSync(docPath, "utf8");

const contributes = pkg.contributes ?? {};
// `configuration` may be one object or an array of them.
const configs = [].concat(contributes.configuration ?? []);
const settings = configs.flatMap((c) => Object.keys(c.properties ?? {}));
const commands = (contributes.commands ?? []).map((c) => ({
  id: c.command,
  title: c.title,
}));

const missingSettings = settings.filter((k) => !doc.includes(k));
const missingCommands = commands.filter((c) => !doc.includes(c.title));

console.log(
  `${settings.length} settings, ${commands.length} commands in ${pkgPath.replace(root + "/", "")}; ` +
    `checked against ${docPath.replace(root + "/", "")}`,
);

if (missingSettings.length === 0 && missingCommands.length === 0) {
  console.log("ok: every setting key and command title is documented");
  process.exit(0);
}

if (missingSettings.length) {
  console.error(`\n${missingSettings.length} setting(s) not mentioned in the doc:`);
  for (const k of missingSettings) console.error(`  setting  ${k}`);
}
if (missingCommands.length) {
  console.error(`\n${missingCommands.length} command(s) whose title is not in the doc:`);
  for (const c of missingCommands) console.error(`  command  "${c.title}"  (${c.id})`);
}
console.error("\nAdd them to INSTALL.md (the exact key / exact title), then re-run.");
process.exit(1);
