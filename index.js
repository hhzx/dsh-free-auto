/**
 * Free Auto — server half.
 *
 * Pool = our-free-model `catalog.entries` (the free-lane roster), ranked by
 * speed-first smart score (measured/probe TTFT + in-flight load). Catalog
 * index is a soft tie-break so the dock order tracks free-model priority
 * when speeds are close. Failures cool down and fall through the chain.
 *
 *   GET /api/free-auto/status
 *
 * @module dsh-free-auto
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const UPSTREAM = 'our-free-model'
const CONTEXT_WINDOW = 131072
const DEFAULT_MAX_TOKENS = 32768
const COOLDOWN_MS = 60_000
const TTFT_WINDOW = 20
/** Each concurrent stream adds this many ms to the ranking score. */
const BUSY_PENALTY_MS = 2_500
/** Soft preference for earlier catalog.entries when TTFT is within this band. */
const CATALOG_TIE_MS = 400
const POOL_REFRESH_MS = 30_000
const STICKY_SLACK_MS = 4_000

/** Display names / fallback roster when probe files are cold. */
const SEED_CHAIN = Object.freeze([
  Object.freeze({ id: 'space-bunny-free', label: 'Space Bunny' }),
  Object.freeze({ id: 'fledge-alpha-free', label: 'Fledge Alpha' }),
  Object.freeze({ id: 'nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning' }),
  Object.freeze({ id: 'exo-free', label: 'Exo' }),
  Object.freeze({ id: 'mimo-v2.6-flash-free', label: 'MiMo v2.6 Flash' }),
  Object.freeze({ id: 'longcat-2.5-preview-free', label: 'LongCat 2.5' }),
  Object.freeze({ id: 'nemotron-3-ultra-free', label: 'Nemotron 3 Ultra' }),
  Object.freeze({ id: 'ling-3.1-flash-free', label: 'Ling 3.1 Flash' }),
  Object.freeze({ id: 'kilo-auto/free', label: 'Kilo Auto Free' }),
])

const LABEL_HINTS = Object.freeze(Object.fromEntries(SEED_CHAIN.map((e) => [e.id, e.label])))

/** @type {Map<string, { failures: number, lastError: string|null, cooldownUntil: number, ttft: number[], ok: number, total: number }>} */
const stats = new Map()
/** @type {Map<string, number>} */
const inflight = new Map()
/** @type {Map<string, string>} */
const sticky = new Map()

function statFor(id) {
  let row = stats.get(id)
  if (row === undefined) {
    row = { failures: 0, lastError: null, cooldownUntil: 0, ttft: [], ok: 0, total: 0 }
    stats.set(id, row)
  }
  return row
}

function ttftMedian(id) {
  const row = statFor(id)
  if (row.ttft.length === 0) return Number.POSITIVE_INFINITY
  const copy = [...row.ttft].sort((a, b) => a - b)
  return copy[Math.floor(copy.length / 2)]
}

function inCooldown(id) {
  return statFor(id).cooldownUntil > Date.now()
}

function beginInflight(id) {
  inflight.set(id, (inflight.get(id) ?? 0) + 1)
}

function endInflight(id) {
  const next = (inflight.get(id) ?? 1) - 1
  if (next <= 0) inflight.delete(id)
  else inflight.set(id, next)
}

function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function prettyLabel(id) {
  if (LABEL_HINTS[id]) return LABEL_HINTS[id]
  return id
    .replace(/-free$/i, '')
    .replace(/[/:]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── pool: catalog.entries only, speed-first ──────────────────────────────────

let poolCache = { at: 0, entries: /** @type {Array<{id:string,label:string,catalogIndex:number,probeState:string,probeTtft:number|null}>} */ ([]) }

function refreshPool(force = false) {
  if (!force && Date.now() - poolCache.at < POOL_REFRESH_MS && poolCache.entries.length > 0) {
    return poolCache.entries
  }
  const dir = path.join(dshHome(), 'our-free-model')
  const availability = readJson(path.join(dir, 'availability.json'))
  const catalog = readJson(path.join(dir, 'catalog.json'))
  const results = availability?.results && typeof availability.results === 'object' ? availability.results : {}

  /** Free-lane roster in plugin priority order. */
  let ids = Array.isArray(catalog?.entries) ? catalog.entries.filter((id) => typeof id === 'string') : []
  // Always offer kilo-auto as a last-resort router if present in kiloRows.
  const hasKiloAuto = Array.isArray(catalog?.kiloRows)
    && catalog.kiloRows.some((row) => row?.id === 'kilo-auto/free')
  if (hasKiloAuto && !ids.includes('kilo-auto/free')) ids = [...ids, 'kilo-auto/free']
  if (ids.length === 0) ids = SEED_CHAIN.map((e) => e.id)

  const blocked = new Set(['unavailable', 'region-blocked'])
  const entries = []
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    const probe = results[id]
    const state = String(probe?.state ?? (id === 'kilo-auto/free' ? 'unknown' : 'unknown'))
    if (blocked.has(state)) continue
    // Deprecated / dead unknowns stay out of the hot path unless they're the kilo router.
    if (state === 'unknown' && id !== 'kilo-auto/free' && probe?.detail && /deprecated|unavailable/i.test(String(probe.detail))) {
      continue
    }
    entries.push({
      id,
      label: prettyLabel(id),
      catalogIndex: index,
      probeState: state,
      probeTtft: Number.isFinite(probe?.ttftMs) ? Number(probe.ttftMs) : null,
    })
  }

  if (entries.length === 0) {
    for (let index = 0; index < SEED_CHAIN.length; index += 1) {
      const row = SEED_CHAIN[index]
      entries.push({
        id: row.id,
        label: row.label,
        catalogIndex: index,
        probeState: 'unknown',
        probeTtft: null,
      })
    }
  }

  poolCache = { at: Date.now(), entries }
  return entries
}

/**
 * Speed-first smart score. Lower is better.
 *   TTFT (measured > probe > default) + busy×penalty + state penalties
 *   − soft boost for earlier catalog.entries (free-model priority tie-break)
 */
function scoreOf(entry) {
  if (inCooldown(entry.id)) return Number.POSITIVE_INFINITY
  const measured = ttftMedian(entry.id)
  const baseline = Number.isFinite(measured)
    ? measured
    : (entry.probeTtft ?? (entry.id === 'kilo-auto/free' ? 1_400 : 3_500))
  const busy = inflight.get(entry.id) ?? 0
  const throttle = entry.probeState === 'throttled' ? 6_000 : 0
  const unknown = entry.probeState === 'unknown' ? 2_000 : 0
  const catalogSoft = Math.min(entry.catalogIndex ?? 0, 20) * (CATALOG_TIE_MS / 20)
  return baseline + busy * BUSY_PENALTY_MS + throttle + unknown + catalogSoft
}

function rankedChain(sessionId) {
  const pool = refreshPool()
  const ranked = pool
    .map((entry) => ({ ...entry, score: scoreOf(entry), busy: inflight.get(entry.id) ?? 0 }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.catalogIndex - b.catalogIndex || a.id.localeCompare(b.id))

  // Available before throttled/unknown when scores are otherwise close — already
  // encoded in score penalties. Sticky session bias:
  if (sessionId && sticky.has(sessionId)) {
    const prefer = sticky.get(sessionId)
    const idx = ranked.findIndex((e) => e.id === prefer)
    if (idx > 0) {
      const best = ranked[0]
      const stick = ranked[idx]
      if (stick.score <= best.score + STICKY_SLACK_MS) {
        ranked.splice(idx, 1)
        ranked.unshift(stick)
      }
    }
  }
  return ranked
}

// ── adapter ──────────────────────────────────────────────────────────────────

class FreeAutoAdapter {
  /** @param {{ llm: any }} deps */
  constructor(deps) {
    this.llm = deps.llm
  }

  providerInfo(provider) {
    return { id: provider, name: 'Free Auto' }
  }

  providerRetryPolicy() {
    return Object.freeze({
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: Object.freeze(['EMPTY_RESPONSE', 'TIMEOUT']),
      initialDelayMs: 500,
      maxDelayMs: 2000,
      jitterRatio: 0.2,
    })
  }

  imageRequestPricing() {
    return undefined
  }

  async listModels(provider) {
    return [{
      provider,
      id: 'free-auto',
      name: 'Free Auto',
      description: '速度优先自动选线；多对话分散负载，失败自动降级',
      inputModalities: ['text'],
    }]
  }

  async resolveModel(provider, model) {
    return {
      provider,
      id: 'free-auto',
      name: 'Free Auto',
      inputModalities: ['text'],
      context: { contextWindow: CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
    }
  }

  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  stream(options) {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const iterator = this.runChain({ ...options, signal: controller.signal })
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const step = async (method, value) => {
      try {
        const row = await iterator[method](value)
        if (row.done) cleanup()
        return row
      } catch (error) {
        cleanup()
        throw error
      }
    }
    return {
      [Symbol.asyncIterator]() { return this },
      next: (value) => step('next', value),
      return: (value) => { controller.abort(); return step('return', value) },
      throw: (error) => { controller.abort(error); return step('throw', error) },
    }
  }

  async * runChain(options) {
    refreshPool(true)
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId : ''
    const chain = rankedChain(sessionId)
    let lastError

    if (chain.length === 0) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'free-auto: no free-pool models available on this egress', code: 'SERVER' },
        },
      }
      return
    }

    for (const entry of chain) {
      if (inCooldown(entry.id)) continue
      const row = statFor(entry.id)
      row.total += 1
      beginInflight(entry.id)
      const started = Date.now()
      let firstTokenMs
      let terminalError = null
      try {
        const callConfig = {
          provider: UPSTREAM,
          model: entry.id,
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          ...(options.reasoningEffort !== undefined ? { reasoningEffort: options.reasoningEffort } : {}),
        }
        const prepared = await this.llm.prepareCall(callConfig, options.signal)
        const dispatchOptions = {
          ...options,
          provider: prepared.config.provider,
          model: prepared.config.model,
          ...(prepared.config.maxTokens !== undefined ? { maxTokens: prepared.config.maxTokens } : {}),
          ...(prepared.config.reasoningEffort !== undefined ? { reasoningEffort: prepared.config.reasoningEffort } : {}),
        }

        for await (const chunk of prepared.stream(dispatchOptions)) {
          if (
            firstTokenMs === undefined
            && (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta'
              || chunk?.type === 'block-start')
          ) {
            firstTokenMs = Date.now() - started
          }
          if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
            terminalError = chunk.reason.failure ?? { message: 'upstream finish error' }
            break
          }
          yield chunk
        }

        if (terminalError === null) {
          row.ok += 1
          row.lastError = null
          if (Number.isFinite(firstTokenMs)) {
            row.ttft.push(firstTokenMs)
            if (row.ttft.length > TTFT_WINDOW) row.ttft.shift()
          }
          if (sessionId) sticky.set(sessionId, entry.id)
          return
        }

        row.failures += 1
        row.lastError = String(terminalError.message ?? terminalError).slice(0, 160)
        const code = String(terminalError.code ?? '')
        if (code === 'RATE_LIMIT' || /429|quota|rate.?limit/i.test(row.lastError)) {
          row.cooldownUntil = Date.now() + COOLDOWN_MS
        }
        lastError = terminalError
        if (sessionId && sticky.get(sessionId) === entry.id) sticky.delete(sessionId)
      } catch (error) {
        row.failures += 1
        row.lastError = String(error?.message ?? error).slice(0, 160)
        const status = error?.status ?? error?.failure?.status
        const code = String(error?.code ?? error?.failure?.code ?? '')
        if (status === 429 || code === 'RATE_LIMIT' || /429|quota|rate.?limit/i.test(row.lastError)) {
          row.cooldownUntil = Date.now() + COOLDOWN_MS
        }
        lastError = error
        if (error?.name === 'AbortError' || options.signal?.aborted === true) {
          yield {
            type: 'finish',
            reason: { kind: 'error', failure: { message: 'free-auto aborted', code: 'ABORTED' } },
          }
          return
        }
        if (sessionId && sticky.get(sessionId) === entry.id) sticky.delete(sessionId)
      } finally {
        endInflight(entry.id)
      }
    }

    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: `free-auto: whole chain refused — ${lastError?.message ?? 'all routes cooling or down'}`,
          code: lastError?.code === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'SERVER',
        },
      },
    }
  }
}

// ── web routes ───────────────────────────────────────────────────────────────

function isLoopback(req) {
  const host = String(req.headers.host ?? '').trim().toLowerCase()
  if (host === 'localhost' || host.startsWith('localhost:')) return true
  const bare = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const octets = bare.split('.')
  return octets.length === 4 && octets[0] === '127'
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

function statusPayload() {
  const chain = rankedChain('')
  const pool = refreshPool()
  const byId = {}
  for (const entry of pool) {
    const row = statFor(entry.id)
    byId[entry.id] = {
      failures: row.failures,
      ok: row.ok,
      total: row.total,
      lastError: row.lastError,
      cooldownMs: Math.max(0, row.cooldownUntil - Date.now()),
      ttftMedianMs: Number.isFinite(ttftMedian(entry.id)) ? Math.round(ttftMedian(entry.id)) : entry.probeTtft,
      recentTtftMs: row.ttft.slice(-5),
      inflight: inflight.get(entry.id) ?? 0,
      probeState: entry.probeState,
      catalogIndex: entry.catalogIndex,
      score: Math.round(scoreOf(entry)),
    }
  }
  return {
    ok: true,
    active: chain[0]?.id ?? null,
    chain: chain.map((entry) => entry.id),
    models: byId,
    labels: Object.fromEntries(pool.map((e) => [e.id, e.label])),
    stickySessions: sticky.size,
    inflightTotal: [...inflight.values()].reduce((a, b) => a + b, 0),
    rankMode: 'speed-first',
  }
}

export const name = 'free-auto'
export const inject = ['llm']

export function apply(ctx) {
  refreshPool(true)
  const poolTimer = setInterval(() => { refreshPool(true) }, POOL_REFRESH_MS)
  poolTimer.unref?.()

  const adapter = new FreeAutoAdapter({ llm: ctx.llm })
  const registration = ctx.llm.registerAdapter(['free-auto'], adapter)
  ctx.llm.registerConfigurableProviders?.([{
    provider: 'free-auto',
    displayName: 'Free Auto',
    settingsNs: 'free-auto',
    settingsPath: [],
  }])

  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    scoped.effect(() => server.register({
      kind: 'exact',
      path: '/api/free-auto/status',
      handler: (req, res) => {
        if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'foreign-caller' }); return }
        json(res, 200, statusPayload())
      },
    }), 'free-auto: status route')
  })

  ctx.on?.('dispose', () => {
    clearInterval(poolTimer)
    registration?.()
  })
}
