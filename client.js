/**
 * Free Auto — browser half.
 *
 * Draggable dock: 本月用量 + Free Auto switch + speed-ranked free lines.
 * Switch ON → select free-auto; OFF → restore the previous model.
 *
 * @module dsh-free-auto/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-free-auto',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const { createElement: h, useState, useEffect, useCallback, useRef } = react

    const NS = 'dsh-free-auto'
    const POLL_MS = 15_000
    const POS_KEY = 'dsh-free-auto:dockPos:v1'
    const PREV_KEY = 'dsh-free-auto:prevModel:v1'
    const FREE_SEL = Object.freeze({ provider: 'free-auto', model: 'free-auto' })
    const DOCK_W = 228
    const MARGIN = 8

    const DICT = {
      zh: {
        title: '免费池自动',
        month: '本月用量',
        monthHit: '本月命中',
        ttft: '首字',
        cooling: '冷却',
        refresh: '刷新',
        loading: '…',
        offline: '离线',
        drag: '拖动位置',
        collapse: '收起线路',
        expand: '展开线路',
        switchOn: 'Free Auto 开',
        switchOff: 'Free Auto 关',
        switchBusy: '切换中…',
        switchErr: '切换失败',
        noSession: '无活动对话',
      },
      en: {
        title: 'Free Auto',
        month: 'This month',
        monthHit: 'Month hit',
        ttft: 'TTFT',
        cooling: 'Cool',
        refresh: 'Refresh',
        loading: '…',
        offline: 'Offline',
        drag: 'Drag',
        collapse: 'Collapse',
        expand: 'Expand',
        switchOn: 'Free Auto on',
        switchOff: 'Free Auto off',
        switchBusy: 'Switching…',
        switchErr: 'Switch failed',
        noSession: 'No active chat',
      },
    }

    const css = [
      /* Hide the old dsh-usage floating dock — stats live in Free Auto now. */
      '[data-dsh-usage-dock]{display:none!important}',
      '.u_railBtn{display:none!important}',
      '.fa_dock{position:fixed;z-index:31;box-sizing:border-box;width:228px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;align-items:stretch;pointer-events:auto}',
      '.fa_dockFrame{position:relative;box-sizing:border-box;width:100%;padding:32px 12px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.3));display:flex;flex-direction:column;gap:2px}',
      '.fa_grip{position:absolute;top:7px;left:9px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;border:none;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;padding:0;touch-action:none}',
      '.fa_grip:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.fa_grip:active{cursor:grabbing}',
      '.fa_refresh{position:absolute;top:7px;right:9px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}',
      '.fa_refresh:hover{color:var(--dsw-alias-label-primary)}',
      '.fa_refresh[data-busy=true]{opacity:.55;pointer-events:none}',
      '.fa_toggle{position:absolute;top:7px;right:36px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;font-size:11px;line-height:1}',
      '.fa_stats{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:6px;flex-wrap:nowrap}',
      '.fa_statPair{display:flex;align-items:baseline;gap:5px;min-width:0}',
      '.fa_statLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);flex:none}',
      '.fa_statValue{font-size:13px;line-height:16px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);letter-spacing:-0.02em;white-space:nowrap}',
      '.fa_switchRow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:6px}',
      '.fa_switchLabel{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      /* Explicit track/knob colors — theme fill vars often collapse to near-white in dark UI. */
      '.fa_switch{position:relative;width:40px;height:22px;border-radius:999px;border:1px solid rgba(255,255,255,.14);padding:0;cursor:pointer;flex:none;background:#3a3f46;box-sizing:border-box;transition:background .15s ease,border-color .15s ease}',
      '.fa_switch[data-on=true]{background:#238636;border-color:#2ea043}',
      '.fa_switch[data-busy=true]{opacity:.55;pointer-events:none}',
      '.fa_switchKnob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#e8eaed;box-shadow:0 1px 3px rgba(0,0,0,.45);transition:transform .15s ease,background .15s ease;pointer-events:none}',
      '.fa_switch[data-on=true] .fa_switchKnob{transform:translateX(18px);background:#fff}',
      '.fa_title{display:flex;align-items:center;gap:7px;padding:2px 0 4px;font-size:13px;font-weight:600;line-height:17px;color:var(--dsw-alias-label-primary)}',
      '.fa_dot{width:9px;height:9px;border-radius:50%;background:#2ea043;box-shadow:0 0 5px rgba(46,160,67,.7);flex:none}',
      '.fa_dot[data-state=warn]{background:#f5b942;box-shadow:0 0 5px rgba(245,185,66,.75)}',
      '.fa_dot[data-state=bad]{background:#e5484d;box-shadow:0 0 5px rgba(229,72,77,.75)}',
      '.fa_dot[data-state=idle]{background:var(--dsw-alias-label-tertiary);box-shadow:none}',
      '.fa_sub{font-size:11px;line-height:14px;font-weight:400;color:var(--dsw-alias-label-tertiary);margin-left:auto;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px}',
      '.fa_row{display:flex;align-items:center;gap:5px;padding:3.5px 0;font-size:12px;line-height:16px;width:100%;min-width:0}',
      '.fa_rank{width:14px;flex:none;text-align:center;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px}',
      '.fa_rank[data-active=true]{color:var(--dsw-alias-state-success-primary,#2ea043);font-weight:700}',
      '.fa_label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.fa_row[data-active=true] .fa_label{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.fa_cell{flex:none;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;width:40px}',
      '.fa_cell[data-warn=true]{color:var(--dsw-alias-state-warning-primary,#d29922)}',
      '.fa_cell[data-bad=true]{color:var(--dsw-alias-state-error-primary)}',
      '.fa_cell[data-busy=true]{color:var(--dsw-alias-state-warning-primary,#d29922);font-weight:600}',
      '.fa_note{padding:4px 0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.fa_err{padding:2px 0 4px;font-size:11px;line-height:14px;color:var(--dsw-alias-state-error-primary)}',
      '.fa_hdr{display:flex;gap:5px;padding:2px 0;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
      '.fa_hdr .fa_label{font-weight:400}',
    ].join('\n')

    function fmtMs(value) {
      if (value === null || value === undefined) return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      if (n >= 10000) return `${Math.round(n / 1000)}s`
      return `${Math.round(n)}ms`
    }

    function fmtCooldown(ms) {
      if (ms <= 0) return ''
      return `${Math.ceil(ms / 1000)}s`
    }

    function fmtCompact(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      const sign = n < 0 ? '-' : ''
      if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`
      if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`
      if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`
      return `${sign}${Math.round(abs)}`
    }

    function todayKey() {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    function monthStatsFromUsage(payload) {
      if (payload?.ok !== true || !Array.isArray(payload.days)) return null
      const month = todayKey().slice(0, 7)
      let tokens = 0
      let input = 0
      let cacheRead = 0
      for (const day of payload.days) {
        if (typeof day?.date !== 'string' || !day.date.startsWith(month)) continue
        const dayInput = Number(day.inputTokens ?? 0) || 0
        const dayOutput = Number(day.outputTokens ?? 0) || 0
        const dayCacheRead = Number(day.cacheReadTokens ?? 0) || 0
        const dayCacheWrite = Number(day.cacheWriteTokens ?? 0) || 0
        const sum = dayInput + dayOutput + dayCacheRead + dayCacheWrite
        tokens += Number.isFinite(Number(day.tokens)) ? Number(day.tokens) : sum
        input += dayInput
        cacheRead += dayCacheRead
      }
      const denom = input + cacheRead
      const hitRate = denom > 0 ? (cacheRead / denom) * 100 : null
      return {
        tokens,
        hitRate,
        partial: payload.coverage?.status === 'partial',
      }
    }

    function fmtHit(rate) {
      if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
      return `${rate.toFixed(1)}%`
    }

    function loadPos() {
      try {
        const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? '')
        if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.bottom)) {
          return { left: raw.left, bottom: raw.bottom }
        }
      } catch { /* defaults */ }
      return { left: 12, bottom: 72 }
    }

    function savePos(pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
    }

    function loadPrevModel() {
      try {
        const raw = JSON.parse(localStorage.getItem(PREV_KEY) ?? '')
        if (raw && typeof raw.provider === 'string' && typeof raw.model === 'string') return raw
      } catch { /* ignore */ }
      return null
    }

    function savePrevModel(selection) {
      try {
        if (selection?.provider && selection?.model) {
          localStorage.setItem(PREV_KEY, JSON.stringify({
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
          }))
        }
      } catch { /* ignore */ }
    }

    function clampPos(left, bottom, width, height) {
      const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN)
      const maxBottom = Math.max(MARGIN, window.innerHeight - height - MARGIN)
      return {
        left: Math.min(Math.max(MARGIN, left), maxLeft),
        bottom: Math.min(Math.max(MARGIN, bottom), maxBottom),
      }
    }

    function isFreeSel(sel) {
      return sel?.provider === FREE_SEL.provider && sel?.model === FREE_SEL.model
    }

    function mainSessionId(sessions) {
      if (!sessions?.list?.getSnapshot) return null
      const state = sessions.list.getSnapshot()
      const hit = Object.values(state.byId ?? {}).find((s) => (s?.retainedBy?.mainView ?? 0) > 0)
      return hit?.id ?? null
    }

    function currentSelection(rootCtx) {
      const sessions = rootCtx.get?.('sessions')
      const dirs = rootCtx.get?.('modelDirectories')
      const sid = mainSessionId(sessions)
      if (!sid || !dirs?.directoryFor) return { sessionId: sid, selection: null }
      try {
        const dir = dirs.directoryFor(sid)
        const selection = dir?.store?.getSnapshot?.()?.current ?? null
        return { sessionId: sid, selection, directory: dir }
      } catch {
        return { sessionId: sid, selection: null }
      }
    }

    async function selectVia(rootCtx, sessionId, selection) {
      const dirs = rootCtx.get?.('modelDirectories')
      if (dirs?.directoryFor) {
        const dir = dirs.directoryFor(sessionId)
        if (typeof dir?.select === 'function') {
          const result = await dir.select(selection)
          if (result?.ok === false) {
            throw new Error(result.error?.message ?? result.error?.code ?? 'select failed')
          }
          return
        }
      }
      const remote = rootCtx.get?.('remote')
      const api = remote?.session
      if (typeof api?.selectModel !== 'function') throw new Error('model switch unavailable')
      const result = await api.selectModel({
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
      })
      if (result?.ok === false) {
        throw new Error(result.error?.message ?? result.error?.code ?? 'selectModel failed')
      }
    }

    async function fetchStatus() {
      const response = await fetch('/api/free-auto/status', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    async function fetchMonthUsage() {
      const response = await fetch('/api/usage/usage', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return monthStatsFromUsage(await response.json())
    }

    function GripIcon() {
      return h('svg', {
        width: 12, height: 12, viewBox: '0 0 12 12', fill: 'currentColor', 'aria-hidden': 'true',
      },
      h('rect', { x: 2, y: 3, width: 8, height: 1.4, rx: 0.7 }),
      h('rect', { x: 2, y: 5.3, width: 8, height: 1.4, rx: 0.7 }),
      h('rect', { x: 2, y: 7.6, width: 8, height: 1.4, rx: 0.7 }))
    }

    function RefreshIcon() {
      return h('svg', {
        width: 11, height: 11, viewBox: '0 0 14 14', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true',
      },
      h('path', { d: 'M11.7 4.3A5.4 5.4 0 1 0 12.4 8', strokeLinecap: 'round' }),
      h('path', { d: 'M12.4 2.4v3.2H9.2', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function FreeAutoDock(props) {
      const t = props.t
      const rootCtx = props.rootCtx
      const [status, setStatus] = useState(null)
      const [month, setMonth] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [expanded, setExpanded] = useState(true)
      const [pos, setPos] = useState(loadPos)
      const [freeOn, setFreeOn] = useState(false)
      const [switching, setSwitching] = useState(false)
      const [switchErr, setSwitchErr] = useState(null)
      const frameRef = useRef(null)
      const dragRef = useRef(null)

      const syncSwitch = useCallback(() => {
        try {
          const { selection } = currentSelection(rootCtx)
          setFreeOn(isFreeSel(selection))
        } catch {
          setFreeOn(false)
        }
      }, [rootCtx])

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const [data, monthData] = await Promise.all([
            fetchStatus(),
            fetchMonthUsage().catch(() => null),
          ])
          setStatus(data)
          if (monthData !== null) setMonth(monthData)
          setError(null)
          syncSwitch()
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy(false)
        }
      }, [syncSwitch])

      useEffect(() => { load() }, [load])
      useEffect(() => {
        const timer = setInterval(load, POLL_MS)
        return () => clearInterval(timer)
      }, [load])
      useEffect(() => {
        const timer = setInterval(syncSwitch, 1500)
        return () => clearInterval(timer)
      }, [syncSwitch])

      useEffect(() => {
        const onResize = () => {
          const el = frameRef.current
          const hgt = el?.offsetHeight ?? 220
          setPos((prev) => {
            const next = clampPos(prev.left, prev.bottom, DOCK_W, hgt)
            savePos(next)
            return next
          })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      const onGripDown = (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        const el = frameRef.current
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originLeft: pos.left,
          originBottom: pos.bottom,
          height: el?.offsetHeight ?? 220,
        }
      }

      const onGripMove = (event) => {
        const drag = dragRef.current
        if (drag === null || event.pointerId !== drag.pointerId) return
        const next = clampPos(
          drag.originLeft + (event.clientX - drag.startX),
          drag.originBottom - (event.clientY - drag.startY),
          DOCK_W,
          drag.height,
        )
        setPos(next)
      }

      const onGripUp = (event) => {
        const drag = dragRef.current
        if (drag === null || event.pointerId !== drag.pointerId) return
        dragRef.current = null
        setPos((prev) => { savePos(prev); return prev })
      }

      const onSwitch = async () => {
        if (switching) return
        setSwitching(true)
        setSwitchErr(null)
        try {
          const { sessionId, selection } = currentSelection(rootCtx)
          if (!sessionId) throw new Error(t('noSession'))
          if (!freeOn) {
            if (selection && !isFreeSel(selection)) savePrevModel(selection)
            await selectVia(rootCtx, sessionId, { ...FREE_SEL })
            setFreeOn(true)
          } else {
            const prev = loadPrevModel() ?? {
              provider: 'sglang-local',
              model: 'Qwen3.8-27B-Abliterated-NVFP4',
            }
            await selectVia(rootCtx, sessionId, prev)
            setFreeOn(false)
          }
          syncSwitch()
        } catch (err) {
          setSwitchErr(String(err?.message ?? err))
        } finally {
          setSwitching(false)
        }
      }

      let dotState = 'idle'
      let subText = ''
      const chain = status?.chain ?? []
      const models = status?.models ?? {}
      const activeId = status?.active
      const active = activeId != null ? models[activeId] : undefined
      if (status !== null) {
        const cooledCount = chain.filter((id) => (models[id]?.cooldownMs ?? 0) > 0).length
        const busyTotal = status.inflightTotal ?? 0
        if (active !== undefined && active.cooldownMs > 0) {
          dotState = 'warn'
          subText = `${t('cooling')} ${fmtCooldown(active.cooldownMs)}`
        } else if (cooledCount === chain.length && chain.length > 0) {
          dotState = 'bad'
          subText = t('cooling')
        } else {
          dotState = 'ok'
          subText = busyTotal > 0 ? `${busyTotal}` : ''
        }
      }

      const monthText = month === null
        ? '—'
        : `${month.partial ? '≥' : ''}${fmtCompact(month.tokens)}`
      const monthHitText = month === null ? '—' : fmtHit(month.hitRate)

      const visible = expanded ? chain.slice(0, 6) : chain.slice(0, 1)
      const rows = status !== null
        ? visible.map((id, index) => {
          const model = models[id] ?? {}
          const isActive = id === activeId
          const cooling = (model.cooldownMs ?? 0) > 0
          const failed = (model.failures ?? 0) > 0
          const loadN = model.inflight ?? 0
          return h('div', {
            key: id,
            className: 'fa_row',
            'data-active': isActive || undefined,
            title: `${id} · #${(model.catalogIndex ?? 0) + 1} in catalog`,
          },
          h('span', { className: 'fa_rank', 'data-active': isActive || undefined }, String(index + 1)),
          h('span', { className: 'fa_label' }, status.labels?.[id] ?? id),
          h('span', { className: 'fa_cell' }, fmtMs(model.ttftMedianMs)),
          h('span', {
            className: 'fa_cell',
            'data-busy': loadN > 0 || undefined,
            'data-bad': failed || undefined,
            'data-warn': cooling || undefined,
          }, cooling ? fmtCooldown(model.cooldownMs) : loadN > 0 ? String(loadN) : failed ? String(model.failures) : '·'))
        })
        : null

      return h('div', {
        className: 'fa_dock',
        style: { left: `${pos.left}px`, bottom: `${pos.bottom}px`, width: `${DOCK_W}px` },
      },
      h('style', null, css),
      h('div', { className: 'fa_dockFrame', ref: frameRef },
        h('button', {
          type: 'button',
          className: 'fa_grip',
          'aria-label': t('drag'),
          title: t('drag'),
          onPointerDown: onGripDown,
          onPointerMove: onGripMove,
          onPointerUp: onGripUp,
          onPointerCancel: onGripUp,
        }, h(GripIcon)),
        h('button', {
          type: 'button',
          className: 'fa_toggle',
          title: expanded ? t('collapse') : t('expand'),
          onClick: () => setExpanded((v) => !v),
        }, expanded ? '▴' : '▾'),
        h('button', {
          type: 'button',
          className: 'fa_refresh',
          'data-busy': busy || undefined,
          'aria-label': t('refresh'),
          title: t('refresh'),
          onClick: () => load(),
        }, h(RefreshIcon)),

        h('div', { className: 'fa_stats' },
          h('div', { className: 'fa_statPair', title: t('month') },
            h('span', { className: 'fa_statLabel' }, t('month')),
            h('span', { className: 'fa_statValue' }, monthText)),
          h('div', { className: 'fa_statPair', title: t('monthHit') },
            h('span', { className: 'fa_statLabel' }, t('monthHit')),
            h('span', { className: 'fa_statValue' }, monthHitText))),

        h('div', { className: 'fa_switchRow' },
          h('span', { className: 'fa_switchLabel' },
            switching ? t('switchBusy') : (freeOn ? t('switchOn') : t('switchOff'))),
          h('button', {
            type: 'button',
            className: 'fa_switch',
            'data-on': freeOn || undefined,
            'data-busy': switching || undefined,
            role: 'switch',
            'aria-checked': freeOn,
            title: freeOn ? t('switchOff') : t('switchOn'),
            onClick: () => { void onSwitch() },
          }, h('span', { className: 'fa_switchKnob', 'aria-hidden': 'true' }))),

        switchErr !== null
          ? h('div', { className: 'fa_err' }, `${t('switchErr')}: ${switchErr}`)
          : null,

        h('div', { className: 'fa_title' },
          h('span', { className: 'fa_dot', 'data-state': dotState, 'aria-hidden': 'true' }),
          h('span', null, t('title')),
          subText !== '' ? h('span', { className: 'fa_sub' }, subText) : null),

        status === null && error !== null
          ? h('div', { className: 'fa_note' }, `${t('offline')} · ${error}`)
          : null,
        status === null && error === null
          ? h('div', { className: 'fa_note' }, t('loading'))
          : null,

        status !== null && expanded
          ? h('div', { className: 'fa_hdr' },
            h('span', { className: 'fa_rank' }, '#'),
            h('span', { className: 'fa_label' }, '线路'),
            h('span', { className: 'fa_cell' }, t('ttft')),
            h('span', { className: 'fa_cell' }, '态'))
          : null,
        rows,
      ))
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'free-auto: dictionaries')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'free-auto',
        locale: NS,
        order: 20,
      }, (slotProps) => h(FreeAutoDock, { ...slotProps, t, rootCtx: ctx })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.FreeAutoDock = FreeAutoDock
    return module.exports
  },
})
