import { defineConfig } from 'vitest/config';

// Vitest configuration for the pure-logic test suite.
//
// Scope: only the modules that can be unit-tested without a DOM /
// Electron / MediaPipe runtime. Tests live in `tests/` and import
// from `src/shared/*` (pure math + filter helpers) and from the
// parts of `src/renderer/lib/*` that only use type-only imports of
// browser-specific modules.
//
// Intentionally NOT using jsdom: the tests are pure-function
// checks and jsdom's overhead (plus its canvas polyfill quirks)
// would just slow them down and risk masking real bugs. If we ever
// need to test DOM-touching code, add a second project config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Keep test output terse enough for a CI badge check and a
    // developer running `npm test` locally.
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/shared/**/*.ts',
        'src/renderer/lib/faceTracker.ts'
      ]
    }
  }
});
