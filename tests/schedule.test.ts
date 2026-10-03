import { describe, expect, test } from 'bun:test'
import { pickExercise, isSchedule, WEEK, EXERCISES, exerciseOf } from '../hooks/breath/exercises.ts'
import { DEFAULTS, applyCommand, statusLine } from '../hooks/breath/config.ts'

describe('schedule', () => {
  test('fixed always uses the configured exercise', () => {
    for (const e of EXERCISES) expect(pickExercise('fixed', e.key)).toBe(e.key)
  })

  test('random covers every exercise and never leaves the set', () => {
    const keys = new Set(EXERCISES.map(e => e.key))
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const k = pickExercise('random', 'box')
      expect(keys.has(k)).toBe(true)
      seen.add(k)
    }
    expect(seen.size).toBe(EXERCISES.length)
  })

  test('random maps the draw across the whole set, ends included', () => {
    const keys = EXERCISES.map(e => e.key)
    expect(pickExercise('random', 'box', () => 0)).toBe(keys[0])
    expect(pickExercise('random', 'box', () => 0.999999)).toBe(keys[keys.length - 1])
  })

  test('day reads the week, Sunday first', () => {
    expect(WEEK).toHaveLength(7)
    for (let d = 0; d < 7; d++) expect(pickExercise('day', 'box', undefined, d)).toBe(WEEK[d])
  })

  test('day wraps for any day number', () => {
    expect(pickExercise('day', 'box', undefined, 7)).toBe(WEEK[0])
    expect(pickExercise('day', 'box', undefined, -1)).toBe(WEEK[6])
  })

  test('every weekday names a real exercise', () => {
    for (const key of WEEK) expect(EXERCISES.some(e => e.key === key)).toBe(true)
  })

  test('isSchedule accepts only the three names', () => {
    expect(['fixed', 'random', 'day'].every(isSchedule)).toBe(true)
    expect(isSchedule('nope')).toBe(false)
    expect(isSchedule(undefined)).toBe(false)
  })
})

describe('config with a schedule', () => {
  test('the default is box breathing', () => {
    expect(DEFAULTS.exercise).toBe('box')
    expect(exerciseOf(DEFAULTS.exercise).name).toBe('Box Breathing')
  })

  test('the default schedule is fixed', () => {
    expect(DEFAULTS.schedule).toBe('fixed')
  })

  test('/breathe schedule sets it, and rejects nothing valid', () => {
    expect(applyCommand(DEFAULTS, 'schedule random').config.schedule).toBe('random')
    expect(applyCommand(DEFAULTS, 'schedule day').config.schedule).toBe('day')
    expect(applyCommand(DEFAULTS, 'schedule fixed').config.schedule).toBe('fixed')
    expect(applyCommand(DEFAULTS, 'schedule nonsense').config).toBe(DEFAULTS)
  })

  test('/breathe random and /breathe day are shorthands', () => {
    expect(applyCommand(DEFAULTS, 'random').config.schedule).toBe('random')
    expect(applyCommand(DEFAULTS, 'day').config.schedule).toBe('day')
    expect(applyCommand(DEFAULTS, 'week').config.schedule).toBe('day')
  })

  test('the status line names the exercise when fixed, the rule when not', () => {
    expect(statusLine(DEFAULTS)).toContain('Box Breathing')
    expect(statusLine({ ...DEFAULTS, schedule: 'day' })).toContain('the week')
    expect(statusLine({ ...DEFAULTS, schedule: 'random' })).toContain('random')
  })
})
