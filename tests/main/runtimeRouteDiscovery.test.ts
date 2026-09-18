import { describe, expect, test } from 'bun:test'
import {
  discoverFromPathSegments,
  runtimeRouteKey,
  runtimeRoutePath,
} from '../../src/main/ipc/handlers/runtimeRouteDiscovery'

describe('runtime route discovery', () => {
  test('infers dynamic routes only from repeated examples of one static shape', () => {
    expect(
      [...discoverFromPathSegments([
        'http://localhost:3000/products/101',
        'http://localhost:3000/products/202',
        'http://localhost:3000/orders/303',
      ])],
    ).toEqual([
      ['/products/:id', ['/products/101', '/products/202']],
    ])
    expect(
      discoverFromPathSegments([
        'http://localhost:3000/products/101',
        'http://localhost:3000/orders/202',
      ]).size,
    ).toBe(0)
  })

  test('distinguishes hash-router pages while ignoring ordinary anchors', () => {
    expect(runtimeRoutePath('http://localhost:3000/#/settings')).toBe(
      '/settings',
    )
    expect(runtimeRouteKey('http://localhost:3000/#section')).toBe('/')
  })
})
