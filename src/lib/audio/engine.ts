// Движок звука: WebAudio и ничего больше. Решений здесь нет — что и как
// играть, решил audio/mixer.ts.
//
// Контекст создаётся ТОЛЬКО по жесту игрока: браузеры и так не дают звука до
// первого клика, но дело не в них. Игра, которая начинает шуметь сама, — это
// игра, которую закрывают. Молчание по умолчанию — не техническое
// ограничение, а решение.
import { SOUND_DEFAULT_VOLUMES } from '../data/balance'
import type { SoundCategory } from '../data/sounds'
import type { CuePlan, } from './mixer'
import type { SoundEngine } from './manager'

export type Volumes = { master: number } & Record<SoundCategory, number>

export const DEFAULT_VOLUMES: Volumes = { ...SOUND_DEFAULT_VOLUMES }

interface Nodes {
  ctx: AudioContext
  master: GainNode
  categories: Record<SoundCategory, GainNode>
}

const CATEGORIES: SoundCategory[] = ['combat', 'loot', 'ui']

export class WebAudioEngine implements SoundEngine {
  private nodes: Nodes | null = null
  private volumes: Volumes = { ...DEFAULT_VOLUMES }
  // Кеш хранит ПРОМИС, а не буфер: два удара подряд не должны обернуться
  // двумя скачиваниями одного файла. Тот же довод, что и у кеша моделей.
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>()
  private readonly durations = new Map<string, number>()
  private readonly base: string

  constructor(base = '') {
    this.base = base
  }

  /** Жест игрока: только отсюда появляется контекст. */
  async unlock(): Promise<void> {
    if (this.nodes) {
      if (this.nodes.ctx.state === 'suspended') await this.nodes.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.connect(ctx.destination)
    const categories = Object.fromEntries(
      CATEGORIES.map((category) => {
        const gain = ctx.createGain()
        gain.connect(master)
        return [category, gain]
      }),
    ) as Record<SoundCategory, GainNode>
    this.nodes = { ctx, master, categories }
    this.applyVolumes()
    if (ctx.state === 'suspended') await ctx.resume()
  }

  /**
   * ЗВУК ИДЁТ, а не «контекст когда-то создали».
   *
   * Здесь стояло `this.nodes !== null`. На iOS AudioContext уходит в
   * `suspended` при блокировке экрана, входящем звонке и переключении
   * приложений, — и игра продолжала исправно «проигрывать» звуки в
   * остановленный контекст, считая себя разблокированной. Для игрока это
   * выглядело так: вернулся к телефону, а звука больше нет вообще, при
   * включённой громкости и всех галках на месте. Помогала только
   * перезагрузка страницы, о чём в игре не написано нигде.
   */
  get unlocked(): boolean {
    return this.nodes !== null && this.nodes.ctx.state === 'running'
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = volumes
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.nodes) return
    this.nodes.master.gain.value = this.volumes.master
    for (const category of CATEGORIES) {
      this.nodes.categories[category].gain.value = this.volumes[category]
    }
  }

  durationMs(file: string): number {
    const known = this.durations.get(file)
    if (known !== undefined) return known
    void this.load(file)
    return 0
  }

  private load(file: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(file)
    if (cached) return cached
    const promise = (async () => {
      if (!this.nodes) return null
      try {
        const response = await fetch(`${this.base}${file}`)
        if (!response.ok) return null
        const buffer = await this.nodes.ctx.decodeAudioData(await response.arrayBuffer())
        this.durations.set(file, buffer.duration * 1000)
        return buffer
      } catch {
        // Не доехал файл — игра продолжается молча. Звук не повод падать.
        return null
      }
    })()
    this.buffers.set(file, promise)
    return promise
  }

  play(plan: CuePlan, duck: number): void {
    const nodes = this.nodes
    if (!nodes) return
    void this.load(plan.file).then((buffer) => {
      if (!buffer || !this.nodes) return
      const source = this.nodes.ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = plan.playbackRate
      const gain = this.nodes.ctx.createGain()
      gain.gain.value = plan.gain * duck
      source.connect(gain)
      gain.connect(this.nodes.categories[plan.category])
      // Узлы браузер не чистит сам: снимаем связи, когда сэмпл отзвучал.
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
      }
      source.start()
    })
  }

  dispose(): void {
    if (!this.nodes) return
    void this.nodes.ctx.close()
    this.nodes = null
    this.buffers.clear()
  }
}
