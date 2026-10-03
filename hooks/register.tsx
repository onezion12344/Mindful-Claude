/* @jsx h */
import type { EngineInterface, Register } from 'claude-code'
import { DEFAULTS, applyCommand, readConfig, type Config } from './breath/config.ts'
import { cycleMs, exerciseOf, pickExercise, type ExerciseKey } from './breath/exercises.ts'
import { pickStyle, type Style } from './breath/shapes.ts'

// The hooks module. While a turn runs it mounts ./breathe.tsx above the prompt (the band's
// `isWorking` prop is the trigger, so the band appears when Claude starts and goes when Claude
// stops) and reads the breath's phase into the spinner line. /breathe changes the settings,
// kept in $.store.

const BAND_ROWS = 9 // seven rows of picture, the phase line, the exercise name
const COLOR = '#f7835d' // Claude orange, the same one the animation draws in

let config: Config = DEFAULTS
// the running turn: when it started, which style it drew, and the exercise it breathes
let turn: { startedAt: number; style: Style; exercise: ExerciseKey } | undefined
let lastStyle: Style | undefined
// the breath the band last posted, for the spinner
let phase: { word: string; exercise: string } | undefined
// a turn that ended mid-breath: kept until the cycle in progress finishes, so the
// animation is never cut off half way through an inhale
let finishing: { startedAt: number; style: Style; exercise: ExerciseKey; until: number } | undefined
// waiting on Start / Skip: the buttons are up until the timeout or a press
let awaiting: { until: number } | undefined
// the person paused the animation: the breath holds where it is until resumed
let paused = false
let pausedAt = 0
// the breath running now, and how much of it was spent paused
let session: { startedAt: number; pausedMs: number } | undefined

/** ms left in the breath cycle in progress at `elapsedMs`; 0 once a cycle has just ended. */
const cycleRemainingMs = (elapsedMs: number, exercise: ExerciseKey): number => {
  const cycle = cycleMs(exerciseOf(exercise))
  return cycle - (elapsedMs % cycle)
}

/** How long this breath has actually run, not counting time paused. */
const breathedMs = (now: number): number => (session ? now - session.startedAt - session.pausedMs : 0)

/** Shows the question; the person may dismiss it, which is not a failure. */
const askFeeling = async ($: EngineInterface, secs: number) => {
  try {
    const answer = await $.ui.ask(`Breathed for ${secs}s. How did that feel?`, ['Calmer', 'Same', 'Tense'])
    $.ui.log(`${secs}s · ${answer}`)
  } catch {
    $.ui.log(`breathed ${secs}s`)
  }
}

/** Records a finished breath in the store and reports how long it ran. */
async function closeSession($: EngineInterface, now: number): Promise<void> {
  if (!session) return
  const ms = breathedMs(now)
  session = undefined
  if (ms < 1000) return
  try {
    const t = ((await $.store.get('totals')) ?? {}) as { sessions?: number; ms?: number }
    await $.store.set('totals', { sessions: (t.sessions ?? 0) + 1, ms: (t.ms ?? 0) + ms })
  } catch {
    $.ui.log('breath not recorded')
  }
  const secs = Math.round(ms / 1000)
  if (config.review) await askFeeling($, secs)
  else $.ui.log(`breathed ${secs}s`)
}

/** What each button in the band does. Each takes `$` at its call site: the engine
 *  parses these literally and refuses `$` passed along. */
const startBreath = async (now: number) => {
  awaiting = undefined
  session = { startedAt: now, pausedMs: 0 }
}

const skipBreath = () => {
  awaiting = undefined
  session = undefined
}

/** Holds the breath where it is; the time spent held is not counted as breathing. */
const togglePause = (now: number) => {
  if (paused) {
    paused = false
    if (session) session = { ...session, pausedMs: session.pausedMs + (now - pausedAt) }
  } else {
    paused = true
    pausedAt = now
  }
}

/** True while a breath is up and should be the only thing on screen. */
const hushing = (): boolean => config.quiet && (turn !== undefined || finishing !== undefined) && !paused


const log = ($: { ui: { log: (text: string) => void } }, what: string) => (err: unknown) => $.ui.log(`mindful-claude: ${what}: ${err}`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get('config').catch(log($, 'store read failed'))
    config = readConfig(saved)
    await $.command.register({
      name: 'breathe',
      description: 'Breathing exercises above the prompt while Claude works: on, off, hrv, sigh, box, 478, style, delay (mindful-claude)',
      argumentHint: '[on | off | hrv | sigh | box | 478 | style <name> | delay <s> | help]',
      immediate: true,
    }).catch(log($, '/breathe not registered'))
    return r
  })

  on('command.run', { command: 'breathe' }, async ($, e) => {
    const applied = applyCommand(config, e.args)
    // `totals` needs the store, so it is answered here rather than in applyCommand
    if (e.args.trim().toLowerCase() === 'totals') {
      const t = (await $.store.get('totals')) as { sessions?: number; ms?: number } | undefined
      const mins = Math.round(((t?.ms ?? 0) / 60000) * 10) / 10
      return { text: `breathe: ${mins} min over ${t?.sessions ?? 0} sessions` }
    }
    if (applied.config !== config) {
      config = applied.config
      await $.store.set('config', config).catch(log($, 'store write failed'))
      $.ui.invalidate('ui.render')
    }
    return { text: applied.text }
  })

  on('turn.start', async ($, e, next) => {
    const style = pickStyle(config.style, lastStyle)
    lastStyle = style
    // the exercise is settled once per turn, so the tail after it finishes breathes the same one
    turn = { startedAt: await $.clock.now(), style, exercise: pickExercise(config.schedule, config.exercise) }
    phase = undefined
    finishing = undefined
    paused = false
    // the band is drawn from a delay on: wake the render hook when it has passed
    if (config.delay > 0) $.clock.after(config.delay * 1000, () => $.ui.invalidate('ui.render'))
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()
    // a turn can end in the middle of a breath: hold the band until the cycle finishes,
    // so the animation completes rather than stopping part way through an inhale
    if (turn) {
      const elapsedMs = now - turn.startedAt
      // only worth finishing if the band is actually up and the turn ran past the delay
      const wasVisible = elapsedMs >= config.delay * 1000 && !awaiting && !paused
      const left = cycleRemainingMs(elapsedMs, turn.exercise)
      if (wasVisible && left > 250) {
        finishing = { ...turn, until: now + left }
        $.clock.after(left, async () => {
          if (finishing?.until !== now + left) return
          finishing = undefined
          await closeSession($, await $.clock.now())
          $.ui.invalidate('ui.render')
        })
      } else if (wasVisible) {
        await closeSession($, now)
      }
    }
    turn = undefined
    phase = undefined
    awaiting = undefined
    paused = false
    $.ui.invalidate('ui.render')
    return r
  })

  // the band posts its phase whenever the line changes (once a second): the spinner reads it
  on('ui.message', async ($, e, next) => {
    const data = e.data as { word?: unknown; exercise?: unknown } | null
    if (typeof data?.word === 'string' && typeof data.exercise === 'string') {
      phase = { word: data.word, exercise: data.exercise }
      if (config.spinner) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the band needs a Client, which only the terminal draws; a survey keeps the band
    if (e.surface !== 'terminal' || !config.enabled || e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    // a turn the hook saw start; else one that is working anyway (started before the plugin loaded)
    const running = turn ?? (turn = {
      startedAt: now,
      style: pickStyle(config.style, lastStyle),
      exercise: pickExercise(config.schedule, config.exercise),
    })
    const elapsedMs = now - running.startedAt
    if (elapsedMs < config.delay * 1000) return next(e)
    // past the turn's end the band keeps drawing while the breath cycle finishes
    const tailing = !e.props.isWorking && finishing !== undefined && finishing.until > now
    if (!e.props.isWorking && !tailing) return next(e)
    const shown = tailing ? finishing! : running

    // first time the band is up this turn: offer Start / Skip, and start it either way
    if (config.confirm && !tailing && !awaiting && !session) {
      awaiting = { until: now + config.confirmTimeout * 1000 }
      // nobody pressed: the breath starts by itself, which is what "no choice" means
      $.clock.after(config.confirmTimeout * 1000, async () => {
        if (!awaiting) return
        awaiting = undefined
        session = { startedAt: await $.clock.now(), pausedMs: 0 }
        $.ui.invalidate('ui.render')
      })
    }

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = Math.min(BAND_ROWS, e.props.maxRows)
    if (rows < 1) return next(e)

    // waiting on a choice: the buttons, and no animation yet
    if (awaiting) {
      const left = Math.max(0, Math.ceil((awaiting.until - now) / 1000))
      return (
        <Box flexDirection="column">
          <Text color={COLOR}>Breath for this turn? Starting in {left}s</Text>
          <Button key="breathe:start" label="Start now" hotkey="s" plain
            onPress={async () => { startBreath(await $.clock.now()); $.ui.invalidate('ui.render') }} />
          <Button key="breathe:skip" label="Skip" hotkey="k" plain
            onPress={async () => { skipBreath(); $.ui.invalidate('ui.render') }} />
          {await next(e)}
        </Box>
      )
    }

    // the key names the turn: one instance per turn, remounted when the settings change mid-turn
    const key = `breathe:${shown.startedAt}:${shown.exercise}:${shown.style}`
    return (
      <Box flexDirection="column">
        <Client key={key} module="./breathe.tsx" width={e.viewport?.columns ?? 80} height={rows}
          props={{ exercise: shown.exercise, style: shown.style, elapsedMs: now - shown.startedAt, paused }} />
        {paused ? <Text color={COLOR}>Paused — the breath is held where it was</Text> : null}
        <Button key="breathe:pause" label={paused ? 'Resume' : 'Pause'} hotkey="p" plain
          onPress={async () => { togglePause(await $.clock.now()); $.ui.invalidate('ui.render') }} />
        {await next(e)}
      </Box>
    )
  })

  // the spinner's word becomes the breath: `✻ Breathe in 4s…`
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!config.enabled || !config.spinner || !phase) return next(e)
    return next({ ...e, props: { ...e.props, message: phase.word } })
  })

  // with `/breathe quiet on`, a breath in progress draws nothing for the work going on:
  // no tool rows, no command output, no assistant text. The rows are not gone — they
  // redraw as they were once the breath is over, and the turn's own record is untouched.
  // `on` resolves its event per component, so each row gets its own hook
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!hushing()) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!hushing()) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!hushing()) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!hushing()) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!hushing()) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
