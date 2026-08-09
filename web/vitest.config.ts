import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // node environment for child_process (eciesharness interop)
    environment: 'node',
  },
})
