/**
 * Client half of dsh-release-radar.
 *
 * Shows a compact floating badge when the host reports newer releases for
 * installed plugins and opens a small panel that lists them. Nothing installs
 * without an explicit click; the host performs the work and re-reports.
 */
window.__ModuleLoader__.load({
  id: 'dsh-release-radar',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/dsh-release-radar/state'
    const NS = 'dsh-release-radar'
    const POLL_MS = 60_000
    const SLOT = 'shell.overlay'
    // Sentinel for "the batch is running". A real plugin name can never collide
    // with it, so `busy === ALL` is unambiguous.
    const ALL = '@all'

    const zh = {
      'badge.many': '{count} 个插件可更新',
      'badge.one': '1 个插件可更新',
      'badge.current': '已是最新',
      'title': '插件更新',
      'subtitle.checked': '已检查 {checked} 个插件',
      'action.check': '重新检查',
      'action.update': '更新',
      'action.updateAll': '全部更新（{count}）',
      'action.working': '更新中…',
      'action.close': '关闭',
      'state.checking': '正在检查…',
      'state.idle': '暂无更新',
      'state.failed': '检查失败',
      'note.done': '{name} 已更新到 {version}。',
      'note.failed': '更新失败',
      'note.restart': '更新完成，可能需要重启 DSH 才会生效。',
      'note.git': '来自 Git，需手动处理',
      'note.blocked': '来源不支持自动更新',
      'note.busy': '正在更新 {name}，其余项已暂停',
      'note.bulkWorking': '正在更新 {name}（{done}/{total}）',
      'note.bulkStart': '正在逐个更新…',
      'note.bulkDone': '{ok} 个插件已全部更新完成。',
      'note.bulkNone': '没有可自动更新的插件。',
      'note.bulkPart': '{failed}/{total} 个更新失败',
      'note.bulkMore': '，另有 {rest} 个失败',
      'note.bulkLost': '批量更新被中断（DSH 可能重启过），请重新检查后再试。',
      'note.needRestart': '当前运行的宿主还没有批量更新接口，重启 DSH 后这个按钮才能用。',
    }
    const en = {
      'badge.many': '{count} plugin updates available',
      'badge.one': '1 plugin update available',
      'badge.current': 'Up to date',
      'title': 'Plugin updates',
      'subtitle.checked': 'Checked {checked} plugins',
      'action.check': 'Check again',
      'action.update': 'Update',
      'action.updateAll': 'Update all ({count})',
      'action.working': 'Updating…',
      'action.close': 'Close',
      'state.checking': 'Checking…',
      'state.idle': 'Everything is current',
      'state.failed': 'Check failed',
      'note.done': '{name} updated to {version}.',
      'note.failed': 'Update failed',
      'note.restart': 'Done. A restart may be required before it takes effect.',
      'note.git': 'Installed from Git — update manually',
      'note.blocked': 'This source cannot be updated here',
      'note.busy': 'Updating {name}; the rest are paused',
      'note.bulkWorking': 'Updating {name} ({done}/{total})',
      'note.bulkStart': 'Updating them one by one…',
      'note.bulkDone': 'All {ok} plugins are up to date.',
      'note.bulkNone': 'Nothing to update automatically.',
      'note.bulkPart': '{failed} of {total} updates failed',
      'note.bulkMore': '; {rest} more failed',
      'note.bulkLost': 'The batch was interrupted (DSH may have restarted). Check again and retry.',
      'note.needRestart': 'The running host has no batch endpoint yet. Restart DSH to enable this button.',
    }

    const STYLE = `
.dsh-un-root { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; z-index: 30; }
.dsh-un-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

/* Compact pill: dot plus count, small enough to stay clear of the composer. */
.dsh-un-badge { pointer-events: auto; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 4px 14px rgba(0,0,0,.16); font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; }
.dsh-un-badge:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-un-badge[data-tone="error"] { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsh-un-badge[data-tone="ok"] { border-color: var(--dsw-alias-state-success-primary); }
.dsh-un-badge[data-tone="ok"] .dsh-un-dot { background: var(--dsw-alias-state-success-primary); }
.dsh-un-badge[data-tone="ok"] .dsh-un-count { color: var(--dsw-alias-state-success-primary); }
.dsh-un-badge[data-tone="pending"] { cursor: progress; }
.dsh-un-badge[data-tone="pending"] .dsh-un-dot { background: var(--dsw-alias-label-tertiary); }
.dsh-un-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-error-primary); flex: none; }
.dsh-un-badge[data-tone="error"] .dsh-un-dot,
.dsh-un-badge[data-tone="pending"] .dsh-un-dot { animation: dsh-un-pulse 1.6s ease-in-out infinite; }
@keyframes dsh-un-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
.dsh-un-count { font-variant-numeric: tabular-nums; }

.dsh-un-panel { pointer-events: auto; width: 360px; max-width: calc(100vw - 32px); max-height: min(60vh, 460px); display: flex; flex-direction: column; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 18px 48px rgba(0,0,0,.22); overflow: hidden; font-family: inherit; font-size: 13px; line-height: 1.5; outline: none; }
.dsh-un-panel:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.dsh-un-head { display: flex; align-items: baseline; gap: 8px; padding: 14px 16px 10px; }
.dsh-un-title { font-size: 14px; font-weight: 600; }
.dsh-un-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-un-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 16px; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.dsh-un-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-un-list { overflow: auto; padding: 0 8px 8px; }
.dsh-un-row { display: flex; align-items: center; gap: 8px; padding: 9px 8px; border-radius: 9px; }
.dsh-un-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dsh-un-ver { flex: none; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-un-arrow { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-un-new { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.dsh-un-note { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-un-rowbtn { flex: none; height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; cursor: pointer; }
.dsh-un-rowbtn:hover:not([disabled]) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-un-rowbtn[disabled] { opacity: .55; cursor: default; }
.dsh-un-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
.dsh-un-primary { height: 28px; padding: 0 12px; border-radius: 7px; border: 1px solid transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted, #fff); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; cursor: pointer; }
.dsh-un-primary:hover:not([disabled]) { background: var(--dsw-alias-button-primary-hover); }
.dsh-un-primary[disabled] { opacity: .55; cursor: default; }
.dsh-un-ghost { height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; cursor: pointer; }
.dsh-un-ghost:hover:not([disabled]) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-un-ghost[disabled] { opacity: .55; cursor: default; }
.dsh-un-hint { margin-left: auto; color: var(--dsw-alias-label-tertiary); }
.dsh-un-banner { padding: 9px 16px; font-size: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dsh-un-banner[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
.dsh-un-banner[data-tone="err"] { color: var(--dsw-alias-state-error-primary); }
`

    /** Two-dialect translator with `{name}` placeholders; zh is the fallback. */
    function translate(dict, key, params) {
      const raw = dict?.[key] ?? zh[key] ?? key
      if (typeof raw !== 'string') return String(raw)
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (whole, name) =>
        params[name] === undefined ? whole : String(params[name]),
      )
    }

    /** The live locale id, tolerating both the snapshot and legacy shapes. */
    function readActiveLocale(locale) {
      try {
        const snapshot = typeof locale?.getSnapshot === 'function' ? locale.getSnapshot() : undefined
        if (typeof snapshot?.active === 'string') return snapshot.active
        const legacy = typeof locale?.getLocale === 'function' ? locale.getLocale() : undefined
        if (typeof legacy?.active === 'string') return legacy.active
      } catch {
        /* fall through to the default dialect */
      }
      return ''
    }

    /**
     * Verdict for a finished batch, or undefined while it is still running.
     *
     * Kept outside the component because the batch finishes in a *later* poll
     * than the click that started it: the panel has to read the host's
     * `bulk.results` and turn it into one line, and that mapping is worth
     * testing on its own. `mark` is the `finishedAt` already reported, so a
     * verdict is produced once per run.
     */
    function bulkVerdict(t, bulk, mark) {
      if (bulk === undefined || bulk.running === true) return undefined
      if (typeof bulk.finishedAt !== 'string' || bulk.finishedAt === mark) return undefined
      const results = Array.isArray(bulk.results) ? bulk.results : []
      if (results.length === 0) return { notice: t('note.bulkNone') }
      const failed = results.filter((item) => item.ok !== true)
      if (failed.length === 0) {
        return { notice: `${t('note.bulkDone', { ok: results.length })} ${t('note.restart')}` }
      }
      // Naming only the first failure keeps the banner to one line; the count
      // says how many others are behind it.
      const first = failed[0] ?? {}
      const detail = typeof first.error === 'string' && first.error !== ''
        ? first.error
        : t('note.failed')
      const where = typeof first.code === 'string' && first.code !== '' ? ` [${first.code}]` : ''
      const rest = failed.length > 1 ? t('note.bulkMore', { rest: failed.length - 1 }) : ''
      const total = typeof bulk.total === 'number' ? bulk.total : results.length
      return {
        failure: `${t('note.bulkPart', { failed: failed.length, total })}：`
          + `${first.name ?? ''} — ${detail}${where}${rest}`,
      }
    }

    function createBadge(locale) {
      return function UpdateBadge() {
        const [state, setState] = React.useState(null)
        const [open, setOpen] = React.useState(false)
        const [busy, setBusy] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [failure, setFailure] = React.useState('')
        const [offline, setOffline] = React.useState(false)
        const [localeId, setLocaleId] = React.useState(() => readActiveLocale(locale))
        const alive = React.useRef(true)
        const rootRef = React.useRef(null)
        const panelRef = React.useRef(null)
        const badgeRef = React.useRef(null)
        const busyRef = React.useRef('')
        const wasOpen = React.useRef(false)
        // `bulk.finishedAt` of the run that was already reported when the button
        // was pressed, so this batch is retired exactly once, and only by its own
        // completion.
        const bulkMark = React.useRef(undefined)
        // True once a report has actually shown this batch running. A report
        // from before the click (or a poll that left too early) has no `bulk`
        // at all, and that must not be mistaken for a batch that died.
        const bulkSeen = React.useRef(false)

        const dict = String(localeId).toLowerCase().startsWith('zh') ? zh : en
        const t = (key, params) => translate(dict, key, params)

        React.useEffect(() => {
          alive.current = true
          return () => {
            alive.current = false
          }
        }, [])

        // Re-render when the user switches language in Settings.
        React.useEffect(() => {
          if (typeof locale?.subscribe !== 'function') return undefined
          const off = locale.subscribe(() => setLocaleId(readActiveLocale(locale)))
          return () => {
            if (typeof off === 'function') off()
          }
        }, [])

        // Poll the host report; never overwrite an in-flight operation. The next
        // delay is adaptive: after a restart the host has not swept yet, so a
        // flat 60s poll leaves the badge missing for over a minute on an idle
        // screen. Poll quickly while a sweep is pending or running, then relax.
        // The chain restarts whenever a batch begins or ends, so the first
        // progress frame does not sit in a 60s wait left over from idle polling.
        React.useEffect(() => {
          let timer = null
          let active = true
          const load = async () => {
            let delay = POLL_MS
            // A batch answers only once at the end, so its progress is readable
            // only from the host report: keep polling through it. A single
            // in-flight install still holds the panel, since that write is local.
            if (busyRef.current === '' || busyRef.current === ALL) {
              try {
                const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
                if (!response.ok) {
                  if (alive.current) setOffline(true)
                  delay = 10_000
                } else {
                  const body = await response.json()
                  if (!alive.current) return
                  setOffline(false)
                  setState(body)
                  // checked === 0 means the host has not completed a first sweep
                  // yet (fresh boot, or a reload just reset the interval).
                  const warm = typeof body?.checked === 'number' && body.checked > 0
                  delay = body?.phase === 'checking' || body?.running === true || body?.bulk?.running === true
                    ? 2_500
                    : warm ? POLL_MS : 4_000
                }
              } catch {
                /* the host may be restarting; keep the last report but say so */
                if (alive.current) setOffline(true)
                delay = 10_000
              }
            }
            // A superseded chain must not schedule another one: the cleanup only
            // clears the timer it knows about, not one a late fetch creates.
            if (!alive.current || !active) return
            timer = setTimeout(() => { void load() }, delay)
          }
          void load()
          return () => {
            active = false
            if (timer !== null) clearTimeout(timer)
          }
        }, [busy === ALL])

        // Focus the panel when it opens, and close on Escape. Focus returns to
        // the badge via the effect below, not from inside this handler.
        React.useEffect(() => {
          if (!open) return undefined
          panelRef.current?.focus?.()
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('keydown', onKey)
          return () => document.removeEventListener('keydown', onKey)
        }, [open])

        // Clicking outside closes the panel.
        React.useEffect(() => {
          if (!open) return undefined
          const onPointer = (event) => {
            if (rootRef.current?.contains?.(event.target) === true) return
            setOpen(false)
          }
          document.addEventListener('pointerdown', onPointer)
          return () => document.removeEventListener('pointerdown', onPointer)
        }, [open])

        // A finished update is worth a moment of attention, not a permanent
        // badge: retire the success notice so the pill can fade away.
        React.useEffect(() => {
          if (notice === '') return undefined
          const id = setTimeout(() => {
            if (alive.current) setNotice('')
          }, 10_000)
          return () => clearTimeout(id)
        }, [notice])

        // A batch is started by one request but finishes in a later report, so
        // its verdict is settled here rather than in applyAll(): the host stores
        // every result in `bulk.results` and flips `running` on the way out.
        React.useEffect(() => {
          if (busy !== ALL) return
          // The host stopped answering: whichever install was in flight cannot
          // report back through this host, and the last report will keep saying
          // "running" forever. Release instead of staying locked.
          if (offline) {
            bulkSeen.current = false
            setFailure(t('note.bulkLost'))
            setWorking('')
            return
          }
          const bulk = state?.bulk
          if (bulk === undefined) {
            // Seen running, now gone: the profile was restarted mid-batch, so the
            // serial loop no longer exists. Before the first report that shows it
            // running, though, an absent `bulk` is just the previous state.
            if (bulkSeen.current) {
              bulkSeen.current = false
              setFailure(t('note.bulkLost'))
              setWorking('')
            }
            return
          }
          if (bulk.running === true) {
            bulkSeen.current = true
            return
          }
          const verdict = bulkVerdict(t, bulk, bulkMark.current)
          if (verdict === undefined) return
          bulkMark.current = bulk.finishedAt
          bulkSeen.current = false
          if (verdict.failure !== undefined) setFailure(verdict.failure)
          else setNotice(verdict.notice)
          setWorking('')
        }, [state, busy, offline])

        // The badge is not rendered while the panel is open, so its ref is null
        // exactly when a close handler runs. Restore focus here instead, one
        // frame after the badge comes back.
        React.useEffect(() => {
          if (open) {
            wasOpen.current = true
            return
          }
          if (!wasOpen.current) return
          wasOpen.current = false
          const id = requestAnimationFrame(() => badgeRef.current?.focus?.())
          return () => cancelAnimationFrame(id)
        }, [open])

        // Report what this component actually sees, so a badge that is mounted
        // but invisible can be told apart from one that never got data. Opt-in:
        // the host only sets `diagnostics` when the plugin Config asks for it,
        // so a normal session sends nothing.
        React.useEffect(() => {
          if (state?.diagnostics !== true) return
          const probe = {
            mounted: true,
            stateLoaded: state !== null,
            phase: state?.phase ?? null,
            updates: Array.isArray(state?.updates) ? state.updates.length : -1,
            actionable: Array.isArray(state?.updates)
              ? state.updates.filter((entry) => entry.actionable === true).length
              : -1,
            offline,
            open,
            failure,
            notice,
            localeId,
            // Computed box of the root, so a zero size or an off-screen position
            // shows up here instead of being guessed at.
            box: (() => {
              const node = rootRef.current
              if (node === null || typeof node.getBoundingClientRect !== 'function') return null
              const rect = node.getBoundingClientRect()
              const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null
              // The decisive test: every element stacked at the badge centre, in
              // paint order. elementFromPoint alone skips pointer-events:none
              // layers, which can still cover the pill visually.
              let hit = null
              let stack = null
              if (typeof document.elementsFromPoint === 'function' && rect.width > 0) {
                const cx = rect.x + rect.width / 2
                const cy = rect.y + rect.height / 2
                const layers = document.elementsFromPoint(cx, cy)
                stack = layers.slice(0, 6).map((layer) => {
                  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(layer) : null
                  return `${layer.tagName}.${String(layer.className ?? '').slice(0, 46)}|z=${cs?.zIndex ?? '?'}|pe=${cs?.pointerEvents ?? '?'}|bg=${cs?.backgroundColor ?? '?'}`
                })
                const top = layers[0] ?? null
                hit = top === null
                  ? 'none'
                  : `${top.tagName}.${String(top.className ?? '')}`.slice(0, 80)
              }
              return {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
                display: style?.display ?? null,
                visibility: style?.visibility ?? null,
                opacity: style?.opacity ?? null,
                zIndex: style?.zIndex ?? null,
                hitAtCentre: hit,
                isOurs: typeof document.elementFromPoint === 'function'
                  ? node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
                  : null,
                stack,
                // What the pill actually looks like. A theme token that resolves
                // to the page background makes a perfectly positioned badge
                // invisible, which no geometry probe can catch.
                paint: (() => {
                  const badge = node.querySelector('.dsh-un-badge')
                  if (badge === null || typeof getComputedStyle !== 'function') return null
                  const bs = getComputedStyle(badge)
                  const mark = badge.querySelector('.dsh-un-count')
                  const dot = badge.querySelector('.dsh-un-dot')
                  const ms = mark === null ? null : getComputedStyle(mark)
                  const ds = dot === null ? null : getComputedStyle(dot)
                  return {
                    bg: bs.backgroundColor,
                    color: bs.color,
                    border: bs.borderTopColor,
                    text: String(badge.textContent ?? ''),
                    markColor: ms?.color ?? null,
                    dotBg: ds?.backgroundColor ?? null,
                    dotW: ds?.width ?? null,
                  }
                })(),
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                parentChain: (() => {
                  const out = []
                  let cursor = node.parentElement
                  for (let depth = 0; cursor !== null && depth < 5; depth += 1) {
                    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(cursor) : null
                    out.push(`${cursor.tagName}.${String(cursor.className ?? '').slice(0, 40)}|${cs?.display ?? '?'}|${cs?.position ?? '?'}|${cs?.zIndex ?? '?'}|${cs?.overflow ?? '?'}`)
                    cursor = cursor.parentElement
                  }
                  return out
                })(),
              }
            })(),
          }
          void fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'probe', probe }),
          }).catch(() => {})
        }, [state, offline, open, failure, notice, localeId])

        const setWorking = (value) => {
          busyRef.current = value
          setBusy(value)
        }

        const post = async (payload) => {
          const response = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            const detail = typeof body.error === 'string' && body.error !== '' ? body.error : `HTTP ${response.status}`
            throw new Error(detail)
          }
          return response.json()
        }

        const check = async () => {
          if (busyRef.current !== '') return
          setWorking('check')
          setFailure('')
          setNotice('')
          try {
            const body = await post({ action: 'check' })
            if (alive.current) setState(body)
          } catch (error) {
            if (alive.current) setFailure(`${t('state.failed')}：${error.message}`)
          } finally {
            if (alive.current) setWorking('')
          }
        }

        const applyOne = async (name) => {
          if (busyRef.current !== '') return
          setWorking(name)
          setFailure('')
          setNotice('')
          try {
            const body = await post({ action: 'update', name })
            if (!alive.current) return
            // The host re-sweeps after every attempt, so the fresh report is
            // authoritative; the pre-request entry is only a fallback.
            if (body.state !== undefined) setState(body.state)
            // A refusal resolves normally on the host, which is why the outcome
            // is inspected here instead of trusting the HTTP status alone.
            if (body.ok === false) {
              const detail = typeof body.error === 'string' && body.error !== '' ? body.error : t('note.failed')
              const where = typeof body.code === 'string' && body.code !== '' ? ` [${body.code}]` : ''
              setFailure(`${t('note.failed')}：${name} — ${detail}${where}`)
              return
            }
            const before = (Array.isArray(state?.updates) ? state.updates : [])
              .find((item) => item.name === name)
            const raw = before?.version
            const sha = String(before?.commit ?? '').slice(0, 7)
            const version = typeof raw === 'string' && raw !== ''
              ? raw
              : sha !== ''
                ? sha
                : '—'
            const done = t('note.done', { name, version })
            setNotice(body.restartReason === undefined ? done : `${done} ${t('note.restart')}`)
          } catch (error) {
            if (!alive.current) return
            // Naming the plugin matters here: this branch also covers a dropped
            // connection, where the banner is the only clue to what was attempted.
            setFailure(`${t('note.failed')}：${name} — ${error.message}`)
          } finally {
            if (alive.current) setWorking('')
          }
        }

        /**
         * Install every pending update in one click.
         *
         * The host starts the batch and answers immediately, so this call only
         * hands over the request; the run's progress and verdict arrive through
         * the normal poll (see the `busy === ALL` effect above), because a batch
         * of installs can outlast a single HTTP response.
         */
        const applyAll = async () => {
          if (busyRef.current !== '') return
          // Baseline: the effect below retires the batch when `finishedAt`
          // moves past this, so a previous run's report cannot end it early.
          bulkMark.current = state?.bulk?.finishedAt
          setWorking(ALL)
          setFailure('')
          setNotice('')
          try {
            const body = await post({ action: 'updateAll' })
            if (!alive.current) return
            if (body.state !== undefined) setState(body.state)
            if (body.skipped === true) {
              setNotice(t('note.bulkNone'))
              setWorking('')
              return
            }
            // A host from before this feature answers with the plain report and
            // no `started` flag. Staying busy would hang the button forever, so
            // say what happened instead of waiting for progress that never comes.
            if (body.started !== true) {
              setFailure(t('note.needRestart'))
              setWorking('')
            }
            // Success is deliberately silent here: the poll below sees the run
            // finish (or go missing) and settles the outcome once. Announcing
            // from both places would double-report the same batch.
          } catch (error) {
            if (!alive.current) return
            setFailure(`${t('note.failed')}：${error.message}`)
            setWorking('')
          }
        }

        const updates = Array.isArray(state?.updates) ? state.updates : []
        const ready = updates.filter((entry) => entry.actionable === true)
        const count = ready.length
        const pending = state?.phase === 'checking'
        const broken = offline || state?.phase === 'failed'
        const announcement = count > 0 ? t(count > 1 ? 'badge.many' : 'badge.one', { count }) : ''
        // The banner owns its own announcement (role=alert / role=status), so the
        // live region stays on the one thing it alone can report: the count.
        const live = h('span', {
          className: 'dsh-un-sr',
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
        }, announcement)

        // Before the first report there is nothing to say, so stay mounted but
        // invisible: the live region and the seat itself must not churn. Once a
        // report exists the badge stays on screen even with zero updates, so
        // "nothing to update" is a visible state instead of a vanished control —
        // a disappearing badge is indistinguishable from a broken one.
        const known = state !== null && typeof state === 'object'
        if (!open && !known) {
          return h('div', { className: 'dsh-un-root', ref: rootRef }, live)
        }

        if (!open) {
          // Never render a "0": with nothing to update the badge reports the
          // standing state instead of a count. A local failure must win over
          // everything else — it is the only state the user can act on, and
          // pending would lock the panel shut.
          const tone = failure !== '' || (broken && count === 0)
            ? 'error'
            : count > 0
              ? 'normal'
              : notice !== ''
                ? 'ok'
                : pending
                  ? 'pending'
                  : 'ok'
          const mark = tone === 'error'
            ? '!'
            : tone === 'normal'
              ? String(count)
              : tone === 'ok'
                ? '✓'
                : '…'
          const label = tone === 'error'
            ? failure !== ''
              ? failure
              : t('state.failed')
            : tone === 'normal'
              ? announcement
              : tone === 'ok'
                ? notice !== ''
                  ? notice
                  : t('badge.current')
                : t('state.checking')
          return h('div', { className: 'dsh-un-root', ref: rootRef },
            live,
            h('button', {
              ref: badgeRef,
              className: 'dsh-un-badge',
              type: 'button',
              'data-tone': tone,
              title: label,
              'aria-label': label,
              onClick: () => {
                // Only a check in flight has nothing to show yet.
                if (tone === 'pending' && failure === '') return
                setOpen(true)
              },
            },
              h('span', { className: 'dsh-un-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'dsh-un-count' }, mark),
            ),
          )
        }

        const rows = updates.map((entry) => {
          const actionable = entry.actionable === true
          const version = entry.kind === 'git'
            ? String(entry.commit ?? '').slice(0, 7)
            : String(entry.version ?? '')
          // During a batch `busy` is the sentinel, so the row actually being
          // installed has to come from the host's progress record.
          const working = busy === entry.name
            || (busy === ALL && state?.bulk?.current === entry.name)
          // Only a pending install locks the other rows; a re-check does not.
          const locked = busy !== '' && busy !== 'check' && !working
          return h('div', {
            className: 'dsh-un-row',
            key: entry.name,
            'aria-busy': working ? 'true' : undefined,
          },
            h('span', { className: 'dsh-un-name', title: entry.name }, entry.name),
            h('span', { className: 'dsh-un-ver' }, String(entry.installedVersion ?? '')),
            h('span', { className: 'dsh-un-arrow', 'aria-hidden': 'true' }, '→'),
            h('span', { className: 'dsh-un-ver dsh-un-new' }, version),
            actionable
              ? h('button', {
                className: 'dsh-un-rowbtn',
                type: 'button',
                disabled: busy !== '',
                'aria-label': working
                  ? `${t('action.working')} ${entry.name}`
                  : `${t('action.update')} ${entry.name}`,
                'aria-describedby': locked ? 'dsh-un-busy-note' : undefined,
                onClick: () => {
                  void applyOne(entry.name)
                },
              }, working ? t('action.working') : t('action.update'))
              : h('span', { className: 'dsh-un-note' }, t(entry.kind === 'git' ? 'note.git' : 'note.blocked')),
          )
        })

        const banner = failure !== ''
          ? h('div', { className: 'dsh-un-banner', 'data-tone': 'err', role: 'alert' }, failure)
          : notice !== ''
            ? h('div', { className: 'dsh-un-banner', 'data-tone': 'ok', role: 'status' }, notice)
            : broken
              ? h('div', { className: 'dsh-un-banner', 'data-tone': 'err' }, state?.error ?? t('state.failed'))
              : null

        // Progress for the batch comes from the host (`state.bulk`), because only
        // the host knows which install is in flight; the local `busy` flag just
        // says a batch was requested. Without that, the button would look frozen
        // for the whole run.
        const bulk = state?.bulk
        const hint = busy === ALL
          ? (bulk?.running === true && typeof bulk.current === 'string' && bulk.current !== ''
            ? t('note.bulkWorking', {
              name: bulk.current,
              done: bulk.done ?? 0,
              total: bulk.total ?? count,
            })
            : t('note.bulkStart'))
          : busy !== '' && busy !== 'check'
            ? t('note.busy', { name: busy })
            : count > 0
              ? announcement
              : ''

        return h('div', { className: 'dsh-un-root', ref: rootRef },
          live,
          h('div', {
            className: 'dsh-un-panel',
            ref: panelRef,
            // A non-modal popover: announcing aria-modal would tell screen
            // readers the rest of the app is inert, and this panel does not
            // trap focus.
            role: 'dialog',
            tabIndex: -1,
            'aria-labelledby': 'dsh-un-title',
            'aria-busy': busy !== '',
          },
            h('div', { className: 'dsh-un-head' },
              h('span', { className: 'dsh-un-title', id: 'dsh-un-title' }, t('title')),
              h('span', { className: 'dsh-un-sub' },
                (state?.checked ?? 0) > 0 ? t('subtitle.checked', { checked: state.checked }) : ''),
              h('button', {
                className: 'dsh-un-close',
                type: 'button',
                'aria-label': t('action.close'),
                onClick: () => setOpen(false),
              }, h('span', { 'aria-hidden': 'true' }, '×')),
            ),
            banner,
            h('div', { className: 'dsh-un-list' },
              updates.length === 0
                ? h('div', { className: 'dsh-un-row' },
                  h('span', { className: 'dsh-un-note' }, pending ? t('state.checking') : t('state.idle')))
                : rows,
            ),
            h('div', { className: 'dsh-un-foot' },
              count > 0
                ? h('button', {
                  className: 'dsh-un-primary',
                  type: 'button',
                  disabled: busy !== '',
                  onClick: () => {
                    void applyAll()
                  },
                }, busy === ALL
                  ? t('action.working')
                  : t('action.updateAll', { count }))
                : null,
              h('button', {
                className: 'dsh-un-ghost',
                type: 'button',
                disabled: busy !== '',
                onClick: () => {
                  void check()
                },
              }, busy === 'check' ? t('state.checking') : t('action.check')),
              h('span', { className: 'dsh-un-hint', id: 'dsh-un-busy-note' }, hint),
            ),
          ),
        )
      }
    }

    return {
      name: 'dsh-release-radar',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-release-radar'
          style.textContent = STYLE
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        })

        // The dictionaries are a convenience: the component falls back to its
        // built-in copy, so a rejected namespace must never cost us the seat.
        // NOTE: effect() invokes its callback immediately and keeps the RETURN
        // value as the cleanup — so the register() call must be inside the
        // arrow, never passed as the effect callback itself.
        const locale = ctx.get?.('locale')
        if (locale !== undefined && typeof locale.register === 'function') {
          ctx.effect(() => {
            try {
              return locale.register(NS, { zh, en })
            } catch (error) {
              console.warn('[dsh-release-radar] locale registration skipped:', error)
              return undefined
            }
          })
        }

        const slots = ctx.slots
        if (slots === undefined || typeof slots.inject !== 'function') return
        const Component = createBadge(locale)
        ctx.effect(() =>
          slots.inject(SLOT, () =>
            slots.register({ name: SLOT, id: 'dsh-release-radar-badge', label: () => 'dsh-release-radar' }, Component),
          ),
        )
      },
    }
  },
})
