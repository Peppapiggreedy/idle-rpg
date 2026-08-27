import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Прогон баланса печатает таблицу — она нужна в выводе как есть,
    // а перехваченный console репортёр по умолчанию проглатывает.
    disableConsoleIntercept: true,
  },
})
