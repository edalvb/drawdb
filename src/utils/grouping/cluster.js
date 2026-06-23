// Clustering primitives for intelligent table grouping. Two similarity signals
// are combined into a single matrix:
//   - structural: the foreign-key graph (relationships)
//   - semantic:   cosine similarity of table-name/field embeddings
// then agglomerated (average linkage) down to a target number of groups.

export function cosineSim(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Pairwise semantic similarity in [0, 1] (negatives clamped to 0).
export function semanticMatrix(vectors) {
  const n = vectors.length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = Math.max(0, cosineSim(vectors[i], vectors[j]));
      S[i][j] = s;
      S[j][i] = s;
    }
  }
  return S;
}

// Structural similarity from FK relationships, normalized to [0, 1] by the
// strongest pair (so a pair linked by N foreign keys scores higher).
export function fkMatrix(tables, relationships) {
  const n = tables.length;
  const idx = new Map(tables.map((t, i) => [t.id, i]));
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  let max = 0;
  for (const r of relationships) {
    const a = idx.get(r.startTableId);
    const b = idx.get(r.endTableId);
    if (a == null || b == null || a === b) continue;
    S[a][b] += 1;
    S[b][a] += 1;
    max = Math.max(max, S[a][b]);
  }
  if (max > 0) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) S[i][j] /= max;
    }
  }
  return S;
}

export function hybridMatrix(fk, sem, wFk, wSem) {
  const n = fk.length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const s = sem ? sem[i][j] : 0;
      S[i][j] = wFk * fk[i][j] + wSem * s;
    }
  }
  return S;
}

// Agglomerative (average-linkage) clustering down to `targetGroups` clusters.
// Returns an array of clusters, each an array of indices into the similarity
// matrix. O(n^3) overall — fine for the table counts typical of a diagram.
export function agglomerative(sim, targetGroups) {
  const n = sim.length;
  if (n === 0) return [];

  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const k = Math.max(1, Math.min(targetGroups || 1, n));

  const clusterSim = (ca, cb) => {
    let sum = 0;
    for (const a of ca) {
      for (const b of cb) sum += sim[a][b];
    }
    return sum / (ca.length * cb.length);
  };

  while (clusters.length > k) {
    let bi = -1;
    let bj = -1;
    let best = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = clusterSim(clusters[i], clusters[j]);
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }

  return clusters;
}
