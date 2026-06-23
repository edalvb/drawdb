// Orchestrates intelligent table grouping: builds a hybrid (FK + semantic)
// similarity matrix, clusters tables, then lays each cluster out and wraps it
// in a Subject Area. Returns a new tables array (with updated positions) and the
// areas to add. Pure data in / data out — the caller applies it to state.

import { buildTableText } from "./buildTableText";
import { embedTexts } from "./embeddingsClient";
import {
  fkMatrix,
  semanticMatrix,
  hybridMatrix,
  agglomerative,
} from "./cluster";
import { layoutClusters } from "./layoutClusters";

const W_FK = 0.6;
const W_SEM = 0.4;

function computeDegree(tables, relationships) {
  const degree = new Map(tables.map((t) => [t.id, 0]));
  for (const r of relationships) {
    if (degree.has(r.startTableId))
      degree.set(r.startTableId, degree.get(r.startTableId) + 1);
    if (degree.has(r.endTableId))
      degree.set(r.endTableId, degree.get(r.endTableId) + 1);
  }
  return degree;
}

/**
 * @param {object[]} tables
 * @param {object[]} relationships
 * @param {{ useSemantic?: boolean, targetGroups?: number, settings?: object,
 *           onProgress?: (p: object) => void }} [options]
 * @returns {Promise<{ tables: object[], areas: object[] }>}
 */
export async function groupTablesIntelligently(
  tables,
  relationships = [],
  options = {},
) {
  const { useSemantic = true, targetGroups = 4, settings = {}, onProgress } =
    options;

  if (!tables || tables.length === 0) return { tables: tables || [], areas: [] };

  const fk = fkMatrix(tables, relationships);

  let sem = null;
  if (useSemantic && tables.length > 1) {
    onProgress?.({ phase: "embedding" });
    const texts = tables.map(buildTableText);
    const vectors = await embedTexts(texts, (p) =>
      onProgress?.({ phase: "model", data: p }),
    );
    sem = semanticMatrix(vectors);
  }

  const sim = hybridMatrix(fk, sem, W_FK, useSemantic ? W_SEM : 0);

  onProgress?.({ phase: "clustering" });
  const clusterIdx = agglomerative(sim, targetGroups);
  const clusters = clusterIdx.map((c) => c.map((i) => tables[i]));

  const degree = computeDegree(tables, relationships);
  const { positions, areas } = layoutClusters(clusters, { settings, degree });

  const newTables = tables.map((t) =>
    positions.has(t.id) ? { ...t, ...positions.get(t.id) } : t,
  );

  return { tables: newTables, areas };
}

/**
 * Turns a grouping result into the new tables/areas arrays and a single atomic
 * undo entry. Appends the new areas after the existing ones (re-indexing their
 * ids, which the areas state uses as the array position).
 *
 * @param {{ tables: object[], areas: object[] }} result from groupTablesIntelligently
 * @param {object[]} prevTables tables before grouping
 * @param {object[]} prevAreas areas before grouping
 * @param {string} message undo-stack label
 */
export function applyGrouping(result, prevTables, prevAreas, message) {
  const newAreas = [
    ...prevAreas,
    ...result.areas.map((a, i) => ({ ...a, id: prevAreas.length + i })),
  ];
  const undoEntry = {
    action: "group",
    undo: { tables: prevTables, areas: prevAreas },
    redo: { tables: result.tables, areas: newAreas },
    message,
  };
  return { newTables: result.tables, newAreas, undoEntry };
}
