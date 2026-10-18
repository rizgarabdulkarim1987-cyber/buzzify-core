import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const rawSql = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'].map((property) => ({
  property,
  message: 'Raw SQL bypasses tenant scoping. Use the scoped Prisma client.',
}));

// The animation library is about 45 KB gzipped with its features, and `motion/react` builds the full component at
// module scope, so importing it anywhere puts all of that in the route's initial JavaScript. It belongs to the product
// sheet, which loads on demand. Anything that has to move before the sheet opens uses CSS or the Web Animations API.
const motionLibrary = ['motion', 'motion/react', 'motion/react-m', 'framer-motion'].map((name) => ({
  name,
  message:
    'The animation library stays out of the menu route’s initial JavaScript. Use CSS transitions or ' +
    'the Web Animations API here; the library is for the product sheet (src/ui/Sheet.tsx, src/ui/product).',
}));

// Public menu routes never load Studio code: it would ship the Studio's modules (and its sign-in library) to guests.
const studioCode = {
  group: ['@/studio', '@/studio/*', '@/server/studio', '@/server/studio/*', '@/app/studio', '@/app/studio/*'],
  message: 'Public menu code never imports Studio code (src/studio, src/server/studio, src/app/studio).',
};

// Studio pages and Server Actions reach data only through the framework, which checks the actor, scope and permission.
const databaseClient = {
  group: ['@/server/data/prisma', '@/generated/prisma', '@/generated/prisma/*'],
  message:
    'Studio routes load data through query() and change it through the framework’s actions (src/server/studio), ' +
    'never with the database client.',
};

// Brackets are glob syntax, so the `[tenant]` folders are matched with escaped brackets.
const publicMenuCode = ['src/app/\\[tenant\\]/**', 'src/app/api/\\[tenant\\]/**', 'src/ui/**'];

// Code that loads on demand or on a route of its own: the product sheet, and the Explore route, which is built on
// scroll-driven motion and is never part of the menu's bundle.
const onDemandMotion = ['src/ui/Sheet.tsx', 'src/ui/product/**', 'src/ui/RollingMoney.tsx', 'src/ui/explore/**'];

// The motion library (src/motion): each motion's file loads on demand, only when that motion is shown, so it may use
// the library. Its entry points are imported by pages directly and must stay free of it: the `Motion` component, the
// catalog and its helpers. `motion-value.ts` only re-exports a type, which is erased at build time.
const motionLibraryOnDemand = ['src/motion/**'];
const motionLibraryEntry = ['src/motion/Motion.tsx', 'src/motion/index.ts', 'src/motion/catalog/**', 'src/motion/loaders.ts', 'src/motion/params.ts', 'src/motion/progress.ts', 'src/motion/types.ts'];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { 'no-restricted-properties': ['error', ...rawSql] } },
  { rules: { 'no-restricted-imports': ['error', { paths: motionLibrary }] } },
  {
    files: publicMenuCode,
    rules: { 'no-restricted-imports': ['error', { paths: motionLibrary, patterns: [studioCode] }] },
  },
  {
    // A later block replaces the rule's options for the files it matches, so this one keeps the Studio patterns.
    files: onDemandMotion,
    rules: { 'no-restricted-imports': ['error', { patterns: [studioCode] }] },
  },
  {
    files: ['src/app/studio/**'],
    rules: { 'no-restricted-imports': ['error', { paths: motionLibrary, patterns: [databaseClient] }] },
  },
  {
    files: motionLibraryOnDemand,
    rules: { 'no-restricted-imports': ['error', { patterns: [studioCode] }] },
  },
  {
    files: motionLibraryEntry,
    rules: { 'no-restricted-imports': ['error', { paths: motionLibrary, patterns: [studioCode] }] },
  },
  {
    // The Studio's Motion area is a route of its own whose whole purpose is to play motions.
    files: ['src/studio/motion/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/generated/**', '.data/**', '.superpowers/**']),
]);
