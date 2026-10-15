import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const rawSql = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'].map((property) => ({
  property,
  message: 'Raw SQL bypasses tenant scoping. Use the scoped Prisma client.',
}));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { 'no-restricted-properties': ['error', ...rawSql] } },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/generated/**', '.data/**', '.superpowers/**']),
]);
