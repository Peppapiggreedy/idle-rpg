// Минимальные типы node для тестов: полноценные @types/node в браузерный
// tsconfig не тянем, а тестам хватает файловых операций. Объявление глобальное,
// поэтому им пользуются и golden-тест, и проверка дизайн-системы в ui/kit.
// Тестам нужен ещё и доступ к переменным окружения (перегенерация фикстур).
declare const process: { env: Record<string, string | undefined> }

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: string): string
  export function readdirSync(path: string | URL): string[]
  export function writeFileSync(path: string | URL, data: string): void
  export function existsSync(path: string | URL): boolean
  export function mkdirSync(path: string | URL, opts?: { recursive?: boolean }): void
}
