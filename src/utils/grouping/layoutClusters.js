// Given clusters of tables, compute new (x, y) positions so each cluster sits
// together on the canvas, and a Subject Area rectangle wrapping each cluster.
// Tables inside a cluster are laid out in a near-square grid; clusters
// themselves are placed in a wrapping meta-grid so areas never overlap.

import {
  tableWidth as defaultTableWidth,
  tableHeaderHeight,
  tableFieldHeight,
  tableColorStripHeight,
} from "../../data/constants";

const TABLE_GAP_X = 40;
const TABLE_GAP_Y = 40;
const AREA_PAD = 40; // gap between the cluster bbox and the area edge
const AREA_PAD_TOP = 56; // extra room at the top for the area name
const CLUSTER_GAP = 100; // gap between areas

// Palette cycled across areas. Rendered with ~40% alpha by the Area component.
const PALETTE = [
  "#175e7a",
  "#8e44ad",
  "#c0392b",
  "#27ae60",
  "#d35400",
  "#2980b9",
  "#16a085",
  "#c2185b",
];

function tableHeight(table) {
  if (table.collapsed) return tableHeaderHeight + tableColorStripHeight;
  return (
    (table.fields?.length || 0) * tableFieldHeight +
    tableHeaderHeight +
    tableColorStripHeight
  );
}

// Pick a representative name for a cluster: the table with the most FK links
// (falls back to the first table). Keeps area names meaningful and language
// agnostic, e.g. "users", "orders".
function representativeName(cluster, degree, index) {
  if (!cluster.length) return `group_${index + 1}`;
  let best = cluster[0];
  let bestDeg = degree.get(best.id) || 0;
  for (const t of cluster) {
    const d = degree.get(t.id) || 0;
    if (d > bestDeg) {
      best = t;
      bestDeg = d;
    }
  }
  return best.name || `group_${index + 1}`;
}

function layoutClusterAt(cluster, areaX, areaY, width, degree, index) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(cluster.length)));
  const originX = areaX + AREA_PAD;
  const originY = areaY + AREA_PAD_TOP;

  const positions = [];
  let yCursor = originY;
  let maxRight = originX;

  for (let r = 0; r * cols < cluster.length; r++) {
    const row = cluster.slice(r * cols, (r + 1) * cols);
    let xCursor = originX;
    let rowMaxH = 0;
    for (const tbl of row) {
      positions.push({ id: tbl.id, x: xCursor, y: yCursor });
      rowMaxH = Math.max(rowMaxH, tableHeight(tbl));
      xCursor += width + TABLE_GAP_X;
      maxRight = Math.max(maxRight, xCursor - TABLE_GAP_X);
    }
    yCursor += rowMaxH + TABLE_GAP_Y;
  }

  const contentBottom = yCursor - TABLE_GAP_Y;
  const area = {
    name: representativeName(cluster, degree, index),
    x: areaX,
    y: areaY,
    width: maxRight - originX + 2 * AREA_PAD,
    height: contentBottom - originY + AREA_PAD_TOP + AREA_PAD,
    color: PALETTE[index % PALETTE.length],
    locked: false,
  };

  return { positions, area };
}

/**
 * @param {Array<Array<object>>} clusters tables grouped into clusters
 * @param {{ settings?: object, degree?: Map<string|number, number> }} opts
 * @returns {{ positions: Map<string|number, {x:number,y:number}>, areas: object[] }}
 */
export function layoutClusters(clusters, { settings = {}, degree = new Map() } = {}) {
  const width = settings.tableWidth || defaultTableWidth;
  const positions = new Map();
  const areas = [];

  const perRow = Math.max(1, Math.ceil(Math.sqrt(clusters.length)));
  let shelfX = 0;
  let shelfY = 0;
  let shelfMaxH = 0;

  clusters.forEach((cluster, ci) => {
    const { positions: clusterPositions, area } = layoutClusterAt(
      cluster,
      shelfX,
      shelfY,
      width,
      degree,
      ci,
    );
    clusterPositions.forEach((p) => positions.set(p.id, { x: p.x, y: p.y }));
    areas.push(area);

    shelfX += area.width + CLUSTER_GAP;
    shelfMaxH = Math.max(shelfMaxH, area.height);
    if ((ci + 1) % perRow === 0) {
      shelfX = 0;
      shelfY += shelfMaxH + CLUSTER_GAP;
      shelfMaxH = 0;
    }
  });

  return { positions, areas };
}
