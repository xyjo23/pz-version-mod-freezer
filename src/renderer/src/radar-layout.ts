export type RadarLayoutItem = {
  key: string
  version: string
  created?: string
  current: boolean
}

export type RadarPosition = {
  left: number
  top: number
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

export const versionScore = (value: string): number => {
  const parts = value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0]
  return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0)
}

const timestamp = (value?: string): number | null => {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const buildRadarSlots = (count: number): RadarPosition[] => {
  if (count <= 0) return []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const ratio = Math.sqrt((index + 0.65) / count)
    const radius = 7 + ratio * 30
    const angle = -Math.PI / 2 + index * goldenAngle
    return {
      left: 50 + Math.cos(angle) * radius,
      top: 50 + Math.sin(angle) * radius
    }
  })
}

const distanceSquared = (left: RadarPosition, right: RadarPosition): number => (
  (left.left - right.left) ** 2 + (left.top - right.top) ** 2
)

/**
 * Places versions on a bounded set of approximate radar slots. The slots keep
 * close identities visible as separate blips and reserve a safe edge margin.
 */
export const layoutRadarItems = (items: RadarLayoutItem[]): RadarPosition[] => {
  if (!items.length) return []

  const anchorIndex = Math.max(0, items.findIndex((item) => item.current))
  const anchor = items[anchorIndex]
  const knownTimes = items.map((item) => timestamp(item.created)).filter((value): value is number => value !== null)
  const anchorTime = timestamp(anchor.created) ?? knownTimes[0] ?? 0
  const anchorVersion = versionScore(anchor.version)
  const maxTimeDelta = Math.max(1, ...knownTimes.map((value) => Math.abs(value - anchorTime)))
  const maxVersionDelta = Math.max(1, ...items.map((item) => Math.abs(versionScore(item.version) - anchorVersion)))
  const available = buildRadarSlots(items.length - 1)
  const positions: RadarPosition[] = new Array(items.length)
  positions[anchorIndex] = { left: 50, top: 50 }

  items.forEach((item, index) => {
    if (index === anchorIndex) return
    const itemTime = timestamp(item.created) ?? anchorTime
    const target = {
      left: clamp(50 + ((itemTime - anchorTime) / maxTimeDelta) * 34, 14, 86),
      top: clamp(50 - ((versionScore(item.version) - anchorVersion) / maxVersionDelta) * 34, 14, 86)
    }
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    available.forEach((slot, slotIndex) => {
      const nextDistance = distanceSquared(slot, target)
      if (nextDistance < bestDistance) {
        bestDistance = nextDistance
        bestIndex = slotIndex
      }
    })
    positions[index] = available.splice(bestIndex, 1)[0] ?? target
  })

  return positions
}
