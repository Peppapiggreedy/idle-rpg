import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Имя репозитория — нужно для GitHub Pages (https://<username>.github.io/idle-rpg/)
  base: '/idle-rpg/',
  plugins: [svelte()],
})
