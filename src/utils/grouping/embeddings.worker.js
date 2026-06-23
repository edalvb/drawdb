// Web Worker that computes sentence embeddings entirely in the browser using
// Transformers.js. The model (Xenova/all-MiniLM-L6-v2, 384 dims) is downloaded
// from the Hugging Face Hub on first use and cached by the browser, so it works
// offline afterwards. Kept in a worker to avoid blocking the main UI thread.

import { pipeline, env } from "@huggingface/transformers";

// Always fetch the model from the Hub; we don't ship local weights.
env.allowLocalModels = false;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      progress_callback: (p) => self.postMessage({ type: "progress", data: p }),
    });
  }
  return extractorPromise;
}

self.onmessage = async (e) => {
  const { texts } = e.data;
  try {
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });

    // output is a Tensor of shape [n, dims]; split it into one array per text.
    const [n, dims] = output.dims;
    const flat = output.data;
    const vectors = [];
    for (let i = 0; i < n; i++) {
      vectors.push(Array.from(flat.slice(i * dims, (i + 1) * dims)));
    }
    self.postMessage({ type: "result", data: vectors });
  } catch (err) {
    self.postMessage({ type: "error", data: String(err?.message || err) });
  }
};
