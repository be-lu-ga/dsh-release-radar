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

    const zh = {
      'badge.many': '{count} 个插件可更新',
      'badge.one': '1 个插件可更新',
      'title': '插件更新',
      'subtitle.checked': '已检查 {checked} 个插件',
      'action.check': '重新检查',
      'action.update': '更新',
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
    }
    const en = {
      'badge.many': '{count} plugin updates available',
      'badge.one': '1 plugin update available',
      'title': 'Plugin updates',
      'subtitle.checked': 'Checked {checked} plugins',
      'action.check': 'Check again',
      'action.update': 'Update',
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
        React.useEffect(() => {
          let timer = null
          const load = async () => {
            let delay = POLL_MS
            if (busyRef.current === '') {
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
                  delay = body?.phase === 'checking' || body?.running === true
                    ? 2_500
                    : warm ? POLL_MS : 4_000
                }
              } catch {
                /* the host may be restarting; keep the last report but say so */
                if (alive.current) setOffline(true)
                delay = 10_000
              }
            }
            if (!alive.current) return
            timer = setTimeout(() => { void load() }, delay)
          }
          void load()
          return () => {
            if (timer !== null) clearTimeout(timer)
          }
        }, [])

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
              setFailure(`${t('note.failed')}：${name} — ${detail}`)
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
            setFailure(`${t('note.failed')}：${error.message}`)
          } finally {
            if (alive.current) setWorking('')
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

        // Nothing to say: stay mounted but invisible, so the live region and the
        // seat itself never churn. A failure always earns a badge.
        if (!open && count === 0 && !pending && notice === '' && failure === '' && !broken) {
          return h('div', { className: 'dsh-un-root', ref: rootRef }, live)
        }

        if (!open) {
          // Never render a "0": with nothing to update the badge either stays
          // hidden (above) or reports what just happened instead of a count.
          // A local failure must win over everything else — it is the only state
          // the user can act on, and pending would lock the panel shut.
          const tone = failure !== '' || (broken && count === 0)
            ? 'error'
            : count > 0
              ? 'normal'
              : notice !== ''
                ? 'ok'
                : 'pending'
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
                ? notice
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
          const working = busy === entry.name
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
              h('button', {
                className: 'dsh-un-primary',
                type: 'button',
                disabled: busy !== '',
                onClick: () => {
                  void check()
                },
              }, busy === 'check' ? t('state.checking') : t('action.check')),
              h('span', { className: 'dsh-un-hint', id: 'dsh-un-busy-note' },
                busy !== '' && busy !== 'check'
                  ? t('note.busy', { name: busy })
                  : count > 0
                    ? announcement
                    : ''),
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
