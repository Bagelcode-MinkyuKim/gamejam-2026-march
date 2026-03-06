import { describe, expect, it } from 'vitest'
import {
  applyWindTunnelForce,
  createLaunchVelocity,
  createShotLayout,
  resolvePortalTeleport,
} from './gameplay'

describe('cannon-shot gameplay helpers', () => {
  it('launches forward and upward from the cannon', () => {
    const velocity = createLaunchVelocity(52, 280)

    expect(velocity.x).toBeGreaterThan(0)
    expect(velocity.y).toBeLessThan(0)
  })

  it('introduces new gimmicks as shots progress', () => {
    const earlyLayout = createShotLayout(1, () => 0)
    const midLayout = createShotLayout(6, () => 0)
    const lateLayout = createShotLayout(10, () => 0)

    expect(earlyLayout.portalPair).toBeNull()
    expect(midLayout.portalPair).not.toBeNull()
    expect(midLayout.gimmicks).toContain('PORTAL')
    expect(lateLayout.windTunnel).toBeNull()
    expect(lateLayout.bomb).not.toBeNull()
    expect(lateLayout.gimmicks).toContain('BOMB')
  })

  it('keeps the projectile from bouncing back and forth inside a portal pair', () => {
    const portal = {
      entry: { x: 200, y: 180 },
      exit: { x: 300, y: 320 },
      radius: 18,
    }

    const firstPass = resolvePortalTeleport(
      { x: 200, y: 180, vx: 120, vy: -80 },
      portal,
      null,
    )

    expect(firstPass.didTeleport).toBe(true)
    expect(firstPass.lockedSide).toBe('exit')
    expect(firstPass.projectile.x).toBeGreaterThan(300)

    const secondPass = resolvePortalTeleport(firstPass.projectile, portal, firstPass.lockedSide)

    expect(secondPass.didTeleport).toBe(false)
    expect(secondPass.lockedSide).toBe('exit')
  })

  it('accelerates projectiles inside the wind tunnel only', () => {
    const unaffected = applyWindTunnelForce(
      { x: 120, y: 120, vx: 90, vy: -40 },
      { x: 200, y: 160, width: 88, height: 64, force: 50 },
      0.5,
    )
    const affected = applyWindTunnelForce(
      { x: 230, y: 190, vx: 90, vy: -40 },
      { x: 200, y: 160, width: 88, height: 64, force: 50 },
      0.5,
    )

    expect(unaffected.vx).toBe(90)
    expect(affected.vx).toBeGreaterThan(90)
    expect(affected.vy).toBeLessThan(-40)
  })
})
