import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/gestao-financeira/',
  resolve: {
    // O alias "@" é exigência do shadcn/ui — os componentes que o CLI copia
    // importam "@/lib/utils". Sem isso o build quebra na primeira adição.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
