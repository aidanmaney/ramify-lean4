import type { PlacedNode } from "./types";

export interface PathNode {
  id: string;
  parents: { id: string }[];
}

export function pathKeys(nodes: readonly PathNode[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const n of nodes) {
    const p = n.parents[0]?.id ?? null;
    const bucket = p ?? "";
    const i = seen.get(bucket) ?? 0;
    seen.set(bucket, i + 1);
    const pk = p !== null ? out.get(p) : undefined;
    out.set(n.id, pk !== undefined ? `${pk}.${i}` : String(i));
  }
  return out;
}

export function remapIds(
  before: readonly PathNode[],
  after: readonly PathNode[],
): Map<string, string> {
  const oldKeys = pathKeys(before);
  const newById = pathKeys(after);
  const byKey = new Map<string, string>();
  for (const [id, key] of newById) if (!byKey.has(key)) byKey.set(key, id);
  const out = new Map<string, string>();
  for (const [id, key] of oldKeys) {
    const to = byKey.get(key);
    if (to !== undefined) out.set(id, to);
  }
  return out;
}

export interface LayoutKey {
  posKey: string | null;

  idKey: string;
}

export function layoutKeys(nodes: PlacedNode[]): Map<string, LayoutKey> {
  const seen = new Map<string, number>();
  const out = new Map<string, LayoutKey>();
  for (const n of nodes) {
    const p = n.data.position?.start;
    let posKey: string | null = null;
    if (p) {
      const base = `P${p.line}:${p.character}`;
      const ord = seen.get(base) ?? 0;
      seen.set(base, ord + 1);
      posKey = `${base}#${ord}`;
    }
    out.set(n.data.id, { posKey, idKey: `I${n.data.id}` });
  }
  return out;
}
