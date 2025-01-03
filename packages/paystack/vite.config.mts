import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/paystack',
  plugins: [
    swc.vite({
      jsc: {
        transform: {
          useDefineForClassFields: false,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@workspace/utils': path.resolve(__dirname, '../../libs/utils/src'),
    },
    preserveSymlinks: true,
  },
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'e2e/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8',
    },
    typecheck: {
      tsconfig: path.join(__dirname, 'tsconfig.spec.json'),
    },
  },
});
