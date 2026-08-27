import { copyFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// GitHub Pages отдаёт 404.html на любой неизвестный путь. Копия index.html
// делает рабочим адрес /idle-rpg/balance?debug=1 — без неё отладочную страницу
// можно открыть только через хеш (?debug=1#/balance).
function pagesSpaFallback(): Plugin {
  return {
    name: 'pages-spa-fallback',
    closeBundle() {
      copyFileSync('dist/index.html', 'dist/404.html')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Имя репозитория — нужно для GitHub Pages (https://<username>.github.io/idle-rpg/)
  base: '/idle-rpg/',
  plugins: [svelte(), pagesSpaFallback()],
  define: {
    // Время сборки для дебаг-оверлея: видно, какая версия задеплоена.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
