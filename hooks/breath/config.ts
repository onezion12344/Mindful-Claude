// The plugin's settings and the /breathe command that changes them. Pure: `bun test` covers it.

import { EXERCISES, exerciseOf, isExerciseKey, isSchedule, resolveExercise, type ExerciseKey, type Schedule } from './exercises.ts'
import { STYLES, isStyle, type Style } from './shapes.ts'

export type Config = {
  enabled: boolean
  exercise: ExerciseKey
  /** How the exercise for a turn is chosen: always `exercise`, or a new one each turn. */
  schedule: Schedule
  style: Style | 'random'
  /** Seconds Claude works before the band appears; 0 shows it at once. */
  delay: number
  /** Whether the spinner line reads the breath's phase too. */
  spinner: boolean
  /** Ask with Start / Skip before the breath begins; unpressed starts on its own. */
  confirm: boolean
  /** Seconds the Start / Skip buttons wait before the breath starts by itself. */
  confirmTimeout: number
  /** Ask how the breathing felt once a breath session ends. */
  review: boolean
  /** While the breath is up, draw nothing for tool calls, their output and code edits. */
  quiet: boolean
}

export const DEFAULTS: Config = {
  enabled: true,
  exercise: 'box',
  schedule: 'fixed',
  style: 'random',
  delay: 0,
  spinner: true,
  confirm: false,
  confirmTimeout: 3,
  review: false,
  quiet: false,
}

/** A config from what the store held, field by field, defaults for the rest. */
export function readConfig(saved: unknown): Config {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    exercise: isExerciseKey(s.exercise) ? s.exercise : DEFAULTS.exercise,
    schedule: isSchedule(s.schedule) ? s.schedule : DEFAULTS.schedule,
    style: s.style === 'random' || isStyle(s.style) ? s.style : DEFAULTS.style,
    delay: typeof s.delay === 'number' && s.delay >= 0 && Number.isFinite(s.delay) ? s.delay : DEFAULTS.delay,
    spinner: typeof s.spinner === 'boolean' ? s.spinner : DEFAULTS.spinner,
    confirm: typeof s.confirm === 'boolean' ? s.confirm : DEFAULTS.confirm,
    confirmTimeout:
      typeof s.confirmTimeout === 'number' && s.confirmTimeout > 0 && Number.isFinite(s.confirmTimeout)
        ? s.confirmTimeout
        : DEFAULTS.confirmTimeout,
    review: typeof s.review === 'boolean' ? s.review : DEFAULTS.review,
    quiet: typeof s.quiet === 'boolean' ? s.quiet : DEFAULTS.quiet,
  }
}

export function statusLine(c: Config): string {
  const ex = exerciseOf(c.exercise)
  const how = c.schedule === 'fixed' ? ex.name : `${c.schedule} of ${c.schedule === 'day' ? 'the week' : EXERCISES.map(e => e.name).join(' / ')}`
  return `breathe: ${c.enabled ? 'on' : 'off'} · ${how} · style ${c.style} · delay ${c.delay}s · spinner ${c.spinner ? 'on' : 'off'} · confirm ${c.confirm ? `on (${c.confirmTimeout}s)` : 'off'} · review ${c.review ? 'on' : 'off'} · quiet ${c.quiet ? 'on' : 'off'}`
}

export const HELP = [
  '/breathe               status',
  '/breathe on | off      show or hide the breathing band while Claude works',
  ...EXERCISES.map(e => `/breathe ${e.key.padEnd(14)}${e.name}: ${e.pattern}`),
  '/breathe schedule fixed  always use the exercise above',
  '/breathe schedule random  a different exercise each turn',
  '/breathe schedule day     the exercise this weekday calls for',
  `/breathe style <name>  ${STYLES.join(', ')} or random`,
  '/breathe delay <s>     seconds Claude works before the band appears (0 = at once)',
  '/breathe spinner on|off  read the phase in the spinner line too',
  '/breathe confirm on|off  ask Start / Skip first; unpressed starts by itself',
  '/breathe confirm <s>   seconds the Start / Skip buttons wait (default 3)',
  '/breathe review on|off  ask how the breathing felt when it ends',
  '/breathe quiet on|off  draw nothing for tool calls and edits while breathing',
  '/breathe totals        breathing time recorded so far',
].join('\n')

/** Applies one `/breathe` invocation; returns the new config and the transcript line. */
export function applyCommand(config: Config, args: string): { config: Config; text: string } {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [head, arg] = words
  if (!head || head === 'status') return { config, text: statusLine(config) }
  if (head === 'help') return { config, text: HELP }
  if (head === 'on' || head === 'off') {
    const next = { ...config, enabled: head === 'on' }
    return { config: next, text: statusLine(next) }
  }
  const exercise = resolveExercise(head)
  if (exercise) {
    const next = { ...config, exercise }
    return { config: next, text: statusLine(next) }
  }
  if (head === 'style') {
    const style: Config['style'] | undefined = arg === 'random' ? 'random' : isStyle(arg) ? arg : undefined
    if (style) {
      const next: Config = { ...config, style }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: `breathe: style is one of ${STYLES.join(', ')}, random` }
  }
  if (isStyle(head)) {
    const next = { ...config, style: head }
    return { config: next, text: statusLine(next) }
  }
  if (head === 'delay') {
    const delay = Number(arg)
    if (arg !== undefined && Number.isFinite(delay) && delay >= 0) {
      const next = { ...config, delay }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: delay takes a number of seconds, 0 or more' }
  }
  if (head === 'spinner') {
    if (arg === 'on' || arg === 'off') {
      const next = { ...config, spinner: arg === 'on' }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: spinner on or off' }
  }
  if (head === 'schedule') {
    if (isSchedule(arg)) {
      const next = { ...config, schedule: arg }
      return { config: next, text: statusLine(next) }
    }
    if (arg === 'week' || arg === 'weekly') {
      const next = { ...config, schedule: 'day' as Schedule }
      return { config: next, text: statusLine(next) }
    }
    if (arg === undefined) {
      const next = { ...config, schedule: 'random' as Schedule }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: schedule fixed | random | day' }
  }
  if (head === 'random' || head === 'day' || head === 'week' || head === 'weekly') {
    const schedule: Schedule = head === 'random' ? 'random' : 'day'
    const next = { ...config, schedule }
    return { config: next, text: statusLine(next) }
  }
  if (head === 'confirm') {
    if (arg === 'on' || arg === 'off') {
      const next = { ...config, confirm: arg === 'on' }
      return { config: next, text: statusLine(next) }
    }
    const secs = Number(arg)
    if (arg !== undefined && Number.isFinite(secs) && secs > 0) {
      const next = { ...config, confirmTimeout: secs }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: confirm on | off | <seconds>' }
  }
  if (head === 'quiet') {
    if (arg === 'on' || arg === 'off') {
      const next = { ...config, quiet: arg === 'on' }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: quiet on or off' }
  }
  if (head === 'review') {
    if (arg === 'on' || arg === 'off') {
      const next = { ...config, review: arg === 'on' }
      return { config: next, text: statusLine(next) }
    }
    return { config, text: 'breathe: review on or off' }
  }
  // `totals` is answered in register.tsx, where the store is reachable
  if (head === 'totals') return { config, text: '' }
  return { config, text: `breathe: no setting called "${head}"\n${HELP}` }
}
