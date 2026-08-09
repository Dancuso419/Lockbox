import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // node environment for child_process (eciesharness interop)
    environment: 'node',
  },
})
