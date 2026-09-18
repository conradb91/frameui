import { describe, expect, test } from 'bun:test'
import { applyTextStyle, normalizeTextRuns, textSegments } from './richText'

describe('rich text ranges', () => {
  test('applies weight and colour only to the highlighted characters', () => {
    let runs = applyTextStyle('Create a blank new Screen', [], 15, 18, { fontWeight: '700' })
    runs = applyTextStyle('Create a blank new Screen', runs, 19, 25, { color: '#149d91' })
    expect(runs).toEqual([
      { start: 15, end: 18, fontWeight: '700' },
      { start: 19, end: 25, color: '#149d91' },
    ])
    expect(textSegments('Create a blank new Screen', runs).map((segment) => segment.text)).toEqual(['Create a blank ', 'new', ' ', 'Screen'])
  })

  test('overlapping formatting preserves the other property and merges equal neighbours', () => {
    const runs = normalizeTextRuns('Welcome back', [
      { start: 0, end: 7, fontWeight: '700' },
      { start: 4, end: 12, color: '#ff0000' },
    ])
    expect(runs).toEqual([
      { start: 0, end: 4, fontWeight: '700' },
      { start: 4, end: 7, fontWeight: '700', color: '#ff0000' },
      { start: 7, end: 12, color: '#ff0000' },
    ])
  })
})
