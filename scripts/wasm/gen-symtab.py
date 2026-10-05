#!/usr/bin/env python3
"""Generate a static symbol table for the WASM Lean build (docs/wasm-spike.md).

Lean's IR interpreter finds native code for a declaration with dlsym(); a static
wasm link has no dlsym, and the dynamic one (MAIN_MODULE=1 + EXPORT_ALL) exports
231k symbols, past V8's 100k-export limit. So: one sorted name -> address table
of every LEAN_EXPORT symbol (functions AND constants) of the given packages,
declared with the generated C's OWN prototypes (a mismatched prototype would make
wasm-ld bind a trapping stub), and `lean_wasm_lookup_symbol` bsearches it.

usage: gen-symtab.py OUT.c <irDir> <Pkg>...   e.g. build/stage1/lib/temp Init
"""
import os, re, sys

out, ir_dir, pkgs = sys.argv[1], sys.argv[2], sys.argv[3:]
decl_re = re.compile(r"^LEAN_EXPORT (.+?)\b([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\))?\s*(;|\{)\s*$")
protos = {}
for pkg in pkgs:
    roots = [os.path.join(ir_dir, pkg), os.path.join(ir_dir, pkg + ".c")]
    files = []
    for r in roots:
        if os.path.isfile(r):
            files.append(r)
        elif os.path.isdir(r):
            for d, _, fs in os.walk(r):
                files += [os.path.join(d, f) for f in fs if f.endswith(".c")]
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.startswith("LEAN_EXPORT"):
                    continue
                line = line.rstrip("\n")
                head = line.split(" = ", 1)[0]
                if head != line and "(" not in head:  # an initialised constant: keep the declaration
                    line = head + ";"
                m = decl_re.match(line)
                if not m:
                    continue
                ret, name, params, _ = m.groups()
                if name in protos:
                    continue
                protos[name] = f"extern {ret.strip()} {name}{params or ''};"
names = sorted(protos)
with open(out, "w") as o:
    o.write('#include <lean/lean.h>\n#include <string.h>\n#include <stdlib.h>\n')
    for n in names:
        o.write(protos[n] + "\n")
    o.write("typedef struct { const char * n; void * p; } lean_wasm_sym;\n")
    o.write("static const lean_wasm_sym lean_wasm_syms[] = {\n")
    for n in names:
        o.write(f'  {{"{n}", (void*)&{n}}},\n')
    o.write("};\n")
    o.write("""static int lean_wasm_cmp(const void * k, const void * e) {
  return strcmp((const char *)k, ((const lean_wasm_sym *)e)->n);
}
LEAN_EXPORT void * lean_wasm_lookup_symbol(const char * sym) {
  const lean_wasm_sym * r = (const lean_wasm_sym *)bsearch(sym, lean_wasm_syms,
    sizeof(lean_wasm_syms) / sizeof(lean_wasm_syms[0]), sizeof(lean_wasm_sym), lean_wasm_cmp);
  return r ? r->p : NULL;
}
""")
print(f"{len(names)} symbols -> {out}")
