import { defineConfig } from 'tsdown';

export default defineConfig({
  platform: 'node',
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  clean: true,
  exports: true
});