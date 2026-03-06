const STORAGE_KEY = 'pungak-attendance'

// ── Reward Types (확장 가능) ──
export type RewardItem =
  | { type: 'coins'; amount: number }
  | { type: 'unlock-random'; count: number }

export interface DayRewardConfig {
  day: number
  rewards: RewardItem[]
  label: string
}

export interface AttendanceConfig {
  cycleDays: number
  dayRewards: DayRewardConfig[]
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  cycleDays: 7,
  dayRewards: [
    { day: 1, label: 'Day 1', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 2, label: 'Day 2', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 3, label: 'Day 3', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 4, label: 'Day 4', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 5, label: 'Day 5', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 6, label: 'Day 6', rewards: [{ type: 'coins', amount: 100 }, { type: 'unlock-random', count: 1 }] },
    { day: 7, label: 'BONUS', rewards: [{ type: 'coins', amount: 400 }, { type: 'unlock-random', count: 3 }] },
  ],
}

export interface AttendanceData {
  lastCheckInDate: string | null
  streakCount: number
  checkedDays: boolean[]
}

export interface CheckInReward {
  totalCoins: number
  unlockedGameIds: string[]
  unlockedGameNames: string[]
  rewards: RewardItem[]
  isBonus: boolean
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

export function resolveRewardsForDay(
  dayIndex: number,
  config: AttendanceConfig,
): { totalCoins: number; totalUnlockCount: number; rewards: RewardItem[] } {
  const dayConfig = config.dayRewards[dayIndex] ?? config.dayRewards[0]
  let totalCoins = 0
  let totalUnlockCount = 0

  for (const r of dayConfig.rewards) {
    if (r.type === 'coins') totalCoins += r.amount
    if (r.type === 'unlock-random') totalUnlockCount += r.count
  }

  return { totalCoins, totalUnlockCount, rewards: dayConfig.rewards }
}

export function performCheckIn(
  lockedGameIds: string[],
  lockedGameNames: Record<string, string>,
  config: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG,
): CheckInReward | null {
  const data = loadData()
  const today = todayKey()

  if (data.lastCheckInDate === today) return null

  const isConsecutive = data.lastCheckInDate === yesterdayKey()
  const newStreak = isConsecutive ? data.streakCount + 1 : 1
  const dayIndex = (newStreak - 1) % config.cycleDays
  const isBonus = dayIndex === config.cycleDays - 1

  const { totalCoins, totalUnlockCount, rewards } = resolveRewardsForDay(dayIndex, config)

  const shuffled = [...lockedGameIds].sort(() => Math.random() - 0.5)
  const unlockedGameIds = shuffled.slice(0, Math.min(totalUnlockCount, shuffled.length))
  const unlockedGameNames = unlockedGameIds.map((id) => lockedGameNames[id] ?? id)

  const newCheckedDays = isConsecutive ? [...data.checkedDays] : []
  while (newCheckedDays.length < config.cycleDays) newCheckedDays.push(false)
  newCheckedDays[dayIndex] = true

  saveData({
    lastCheckInDate: today,
    streakCount: newStreak,
    checkedDays: newCheckedDays,
  })

  return { totalCoins, unlockedGameIds, unlockedGameNames, rewards, isBonus, dayIndex }
}
