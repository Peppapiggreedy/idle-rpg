import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Имя репозитория — нужно для GitHub Pages (https://<username>.github.io/idle-rpg/)
  base: '/idle-rpg/',
  plugins: [svelte()],
  define: {
    // Время сборки для дебаг-оверлея: видно, какая версия задеплоена.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
