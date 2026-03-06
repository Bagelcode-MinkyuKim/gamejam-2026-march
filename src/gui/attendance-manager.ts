const STORAGE_KEY = 'pungak-attendance'

export interface AttendanceConfig {
  dailyCoinReward: number
  dailyRandomUnlockCount: number
  weekBonusCoinReward: number
  weekBonusRandomUnlockCount: number
  cycleDays: number
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  dailyCoinReward: 100,
  dailyRandomUnlockCount: 1,
  weekBonusCoinReward: 300,
  weekBonusRandomUnlockCount: 2,
  cycleDays: 7,
}

export interface AttendanceData {
  lastCheckInDate: string | null
  streakCount: number
  checkedDays: boolean[]
}

export interface CheckInReward {
  coins: number
  unlockGameIds: string[]
  isWeekBonus: boolean
  dayIndex: number
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadData(): AttendanceData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { lastCheckInDate: null, streakCount: 0, checkedDays: [] }
    const parsed = JSON.parse(raw) as Partial<AttendanceData>
    return {
      lastCheckInDate: typeof parsed.lastCheckInDate === 'string' ? parsed.lastCheckInDate : null,
      streakCount: typeof parsed.streakCount === 'number' ? parsed.streakCount : 0,
      checkedDays: Array.isArray(parsed.checkedDays) ? parsed.checkedDays : [],
    }
  } catch {
    return { lastCheckInDate: null, streakCount: 0, checkedDays: [] }
  }
}

function saveData(data: AttendanceData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // silent
  }
}

export function getAttendanceState(config: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG): {
  data: AttendanceData
  canCheckIn: boolean
  currentDayIndex: number
} {
  const data = loadData()
  const today = todayKey()
  const canCheckIn = data.lastCheckInDate !== today

  let currentDayIndex = data.streakCount % config.cycleDays
  if (data.lastCheckInDate !== null && data.lastCheckInDate !== today && data.lastCheckInDate !== yesterdayKey()) {
    currentDayIndex = 0
  }

  return { data, canCheckIn, currentDayIndex }
}

export function performCheckIn(
  lockedGameIds: string[],
  config: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG,
): CheckInReward | null {
  const data = loadData()
  const today = todayKey()

  if (data.lastCheckInDate === today) return null

  const isConsecutive = data.lastCheckInDate === yesterdayKey()
  const newStreak = isConsecutive ? data.streakCount + 1 : 1
  const dayIndex = (newStreak - 1) % config.cycleDays
  const isWeekBonus = dayIndex === config.cycleDays - 1

  const coins = isWeekBonus
    ? config.dailyCoinReward + config.weekBonusCoinReward
    : config.dailyCoinReward

  const unlockCount = isWeekBonus
    ? config.dailyRandomUnlockCount + config.weekBonusRandomUnlockCount
    : config.dailyRandomUnlockCount

  const shuffled = [...lockedGameIds].sort(() => Math.random() - 0.5)
  const unlockGameIds = shuffled.slice(0, Math.min(unlockCount, shuffled.length))

  const newCheckedDays = isConsecutive ? [...data.checkedDays] : []
  while (newCheckedDays.length < config.cycleDays) newCheckedDays.push(false)
  newCheckedDays[dayIndex] = true

  saveData({
    lastCheckInDate: today,
    streakCount: newStreak,
    checkedDays: newCheckedDays,
  })

  return { coins, unlockGameIds, isWeekBonus, dayIndex }
}
