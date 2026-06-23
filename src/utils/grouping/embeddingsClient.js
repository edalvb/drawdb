// Thin wrapper around the embeddings Web Worker. Lazily spawns the worker and
// reuses it across calls (so the model stays loaded between groupings).

let worker = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./embeddings.worker.js", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/**
 * Compute embeddings for an array of strings.
 * @param {string[]} texts
 * @param {(progress: object) => void} [onProgress] model download / load progress
 * @returns {Promise<number[][]>} one vector per input text
 */
export function embedTexts(texts, onProgress) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const handler = (e) => {
      const { type, data } = e.data;
      if (type === "progress") {
        onProgress?.(data);
        return;
      }
      w.removeEventListener("message", handler);
      if (type === "error") reject(new Error(data));
      else resolve(data);
    };
    w.addEventListener("message", handler);
    w.postMessage({ texts });
  });
}

export function terminateEmbeddings() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
