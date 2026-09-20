import js from '@eslint/js'
import globals from 'globals'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import { defineConfig, globalIgnores } from 'eslint/config'

// Migrado da configuração do Vite (react-refresh/vite dava falso positivo nos
// exports de metadata/viewport do App Router) para as regras oficiais do Next.js.
// eslint-config-next já traz react-hooks e @typescript-eslint embutidos — não
// declarar de novo (o ESLint recusa registrar o mesmo plugin duas vezes).
export default defineConfig([
  globalIgnores(['.next', 'node_modules', 'dist', 'coverage', 'next-env.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...nextCoreWebVitals, ...nextTypescript],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
