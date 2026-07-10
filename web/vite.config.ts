import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // NOT `dist`: vite empties its outDir on build, and `dist/` is where
    // build:widget puts proofTreeWidget.js — the Lean build input that
    // lakefile.toml declares and ProofTreeWidget.lean include_str's. Letting
    // `npm run build` share it silently deletes the widget bundle and breaks
    // the next `lake build`.
    outDir: 'dist-app',
  },
})
