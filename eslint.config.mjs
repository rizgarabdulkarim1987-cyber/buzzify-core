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
  {
    // The animation library is about 45 KB gzipped with its features, and `motion/react` builds the full
    // component at module scope, so importing it anywhere puts all of that in the route's initial JavaScript.
    // It belongs to the product sheet, which loads on demand. Anything that has to move before the sheet
    // opens uses CSS or the Web Animations API.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['motion', 'motion/react', 'motion/react-m', 'framer-motion'].map((name) => ({
            name,
            message:
              'The animation library stays out of the menu route’s initial JavaScript. Use CSS transitions or ' +
              'the Web Animations API here; the library is for the product sheet (src/ui/Sheet.tsx, src/ui/product).',
          })),
        },
      ],
    },
  },
  {
    // Code that loads on demand or on a route of its own: the product sheet, and the Explore route, which is
    // built on scroll-driven motion and is never part of the menu's bundle.
    files: ['src/ui/Sheet.tsx', 'src/ui/product/**', 'src/ui/RollingMoney.tsx', 'src/ui/explore/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/generated/**', '.data/**', '.superpowers/**']),
]);
