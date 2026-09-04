import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // src/components/ui e' codigo VENDORIZADO: o CLI do shadcn copia esses
  // arquivos para dentro do repo e os reescreve a cada `shadcn add`. Lintar
  // (ou pior, corrigir) esses arquivos so' geraria conflito no proximo update.
  globalIgnores(['dist', 'src/components/ui']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
