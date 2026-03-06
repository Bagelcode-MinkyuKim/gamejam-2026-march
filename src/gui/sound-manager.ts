const STORAGE_KEY = 'pungak-sound-settings'

export interface SoundSettings {
  bgmVolume: number
  sfxVolume: number
  bgmMuted: boolean
  sfxMuted: boolean
}

const DEFAULT_SETTINGS: SoundSettings = {
  bgmVolume: 0.7,
  sfxVolume: 0.8,
  bgmMuted: false,
  sfxMuted: false,
}

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<SoundSettings>
    return {
      bgmVolume: typeof parsed.bgmVolume === 'number' ? clamp01(parsed.bgmVolume) : DEFAULT_SETTINGS.bgmVolume,
      sfxVolume: typeof parsed.sfxVolume === 'number' ? clamp01(parsed.sfxVolume) : DEFAULT_SETTINGS.sfxVolume,
      bgmMuted: typeof parsed.bgmMuted === 'boolean' ? parsed.bgmMuted : DEFAULT_SETTINGS.bgmMuted,
      sfxMuted: typeof parsed.sfxMuted === 'boolean' ? parsed.sfxMuted : DEFAULT_SETTINGS.sfxMuted,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // silent — storage full or unavailable
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

let currentSettings = loadSettings()
let activeBgm: HTMLAudioElement | null = null
let activeBgmTrack: string | null = null
let activeBgmBaseVolume = 0

const listeners = new Set<() => void>()

export function getSoundSettings(): SoundSettings {
  return { ...currentSettings }
}

export function updateSoundSettings(partial: Partial<SoundSettings>): void {
  currentSettings = {
    ...currentSettings,
    ...partial,
    bgmVolume: partial.bgmVolume !== undefined ? clamp01(partial.bgmVolume) : currentSettings.bgmVolume,
    sfxVolume: partial.sfxVolume !== undefined ? clamp01(partial.sfxVolume) : currentSettings.sfxVolume,
  }
  saveSettings(currentSettings)
  applyBgmVolume()
  listeners.forEach((fn) => fn())
}

export function subscribeSoundSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function effectiveBgmVolume(baseVolume: number): number {
  if (currentSettings.bgmMuted) return 0
  return baseVolume * currentSettings.bgmVolume
}

function effectiveSfxVolume(baseVolume: number): number {
  if (currentSettings.sfxMuted) return 0
  return baseVolume * currentSettings.sfxVolume
}

function applyBgmVolume(): void {
  if (activeBgm !== null) {
    activeBgm.volume = effectiveBgmVolume(activeBgmBaseVolume)
  }
}

export function playOneShotAudio(src: string, baseVolume: number): void {
  const vol = effectiveSfxVolume(baseVolume)
  if (vol <= 0) return
  const sound = new Audio(src)
  sound.preload = 'auto'
  sound.volume = vol
  void sound.play().catch(() => {})
}

export function playBackgroundAudio(src: string, baseVolume: number): void {
  if (activeBgmTrack === src && activeBgm !== null) {
    activeBgmBaseVolume = baseVolume
    activeBgm.volume = effectiveBgmVolume(baseVolume)
    return
  }

  stopBackgroundAudio()

  const bg = new Audio(src)
  bg.loop = true
  bg.preload = 'auto'
  bg.volume = effectiveBgmVolume(baseVolume)
  void bg.play().catch(() => {})
  activeBgm = bg
  activeBgmTrack = src
  activeBgmBaseVolume = baseVolume
}

export function stopBackgroundAudio(): void {
  if (activeBgm !== null) {
    activeBgm.pause()
    activeBgm.currentTime = 0
    activeBgm = null
  }
  activeBgmTrack = null
  activeBgmBaseVolume = 0
}

export function getActiveBgmTrack(): string | null {
  return activeBgmTrack
}
