import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build the embeddings web worker as an ES module (it imports Transformers.js).
  worker: {
    format: "es",
  },
  // Transformers.js + onnxruntime-web don't play well with Vite's dep
  // pre-bundling; let them load as-is.
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
})
