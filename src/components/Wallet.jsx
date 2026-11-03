// Wallet panel — balance, movements, per-operation costs and the credit top-up flow.
//
// Lives as a sheet (like the account panels in AuthForms.jsx) because that is where this
// app puts settings-like flows: reachable from Settings while signed in, from the
// returned-from-payment screen, and from anywhere a low-balance state later wants to
// point at it (openWallet() — the AI panel takes it in T5). The tone follows the platform
// principle: explain what happens and what to do next. Never urgency, never blame.
//
// The payment gateway is provider-agnostic and deliberately unnamed in every string.
// Boleta (document_type 46) is the only document type here; factura + fiscal fields come
// in a later task (the seam is in wallet.js createOrder).
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { me as platformMe } from '../lib/platform/auth.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import {
  fetchMovements, fetchTariffs, fetchLimits, clampAmount,
  createOrder, goToPayment, saveTopupRecord, checkReturnedTopUp,
} from '../lib/platform/wallet.js'
import Icon from './Icon.jsx'
import { Button, NumberField } from './ui.jsx'

const gap = { display: 'grid', gap: 10 }
// Default pack when the platform gives no limits of its own (server still re-clamps).
const PRESETS = [1000, 5000, 10000]
const DEFAULT_AMOUNT = 5000

// server movement rows carry full ISO timestamps; the app's fmtDate wants a YYYY-MM-DD.
const dayOf = iso => {
  if (!iso) return null
  const s = String(iso).slice(0, 10)
  return isNaN(new Date(s + 'T12:00:00')) ? null : s
}

function TopUpStatusSheet({ result, close }) {
  // Neutral copy per status: what happened, what (if anything) to do next — never scary.
  // Anything unmapped lands on the pending wording: honest, calm, no action demanded.
  const copy = {
    approved: [t('Your recharge went through'), t('The credits are already in your balance. Nothing else to do.')],
    rejected: [t('The payment could not be completed'), t('Your balance was not touched. You can start this recharge again whenever you like.')],
    canceled: [t('The recharge was left unfinished'), t('Nothing was charged. Whenever you want, you can start it again from your wallet.')],
    pending_review: [t('Your recharge is being reviewed'), t('The payment is being checked. If everything matches, the credits are added to your balance — no action needed from you.')],
  }[result.kind]
    || [t('Your recharge is registered'), t('The payment is being confirmed — the credits appear in your balance as soon as it clears, usually within minutes.')]
  return <div style={{ textAlign: 'center', padding: '6px 0' }}>
    <div style={{ fontSize: 40, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
      <Icon name={result.kind === 'rejected' || result.kind === 'canceled' ? 'wallet' : 'checkCircle'} />
    </div>
    <h3 style={{ margin: '8px 0 4px' }}>{copy[0]}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>{copy[1]}</div>
    <Button variant="primary" onClick={() => { close(); openWallet() }}>{t('See my wallet')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </div>
}

function MovementRow({ m }) {
  const day = dayOf(m.date)
  const signed = m.dir < 0 ? '−' : '+'
  const value = fmtNum(m.amount ?? 0)
  return <div className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--sep)' }}>
    <span>
      <span className="tt" style={{ fontSize: 15 }}>{m.label}</span>
      {day && <div className="ss dim">{fmtDate(day, true)}</div>}
    </span>
    <span style={{ fontWeight: 600, color: m.dir < 0 ? 'var(--label)' : 'var(--acc)', fontVariantNumeric: 'tabular-nums' }}>
      {signed}{value}
    </span>
  </div>
}

function WalletPanel({ close }) {
  const balance = useStore(s => s.balance)
  const [movs, setMovs] = useState(null)          // { items, hasMore } — null = loading
  const [page, setPage] = useState(1)
  const [movErr, setMovErr] = useState(false)
  const [tariffs, setTariffs] = useState(null)
  const [limits, setLimits] = useState(null)
  const [limitsErr, setLimitsErr] = useState(null)
  const [amount, setAmount] = useState(DEFAULT_AMOUNT)
  const [busy, setBusy] = useState(false)
  const [topupErr, setTopupErr] = useState(null)

  useEffect(() => {
    let alive = true
    // Balance comes from the store (set at boot); the wallet re-asks /auth/me on open so
    // returning from the payment gateway always shows the freshest number.
    platformMe()
      .then(({ balance: b }) => { if (alive && b != null) useStore.setState({ balance: b }) })
      .catch(() => {})
    const load = (p, replace) => fetchMovements(p)
      .then(r => {
        if (!alive) return
        setMovs(prev => (!replace && prev ? { items: prev.items.concat(r.items), hasMore: r.hasMore } : r))
        setPage(p)
      })
      .catch(() => { if (alive) setMovErr(true) })
    load(1, true)
    fetchTariffs().then(r => { if (alive) setTariffs(r) }).catch(() => { if (alive) setTariffs([]) })
    fetchLimits()
      .then(r => { if (alive) setLimits(r) })
      .catch(e => { if (alive) setLimitsErr(e) })
    // A recharge just came back from the payment site? Say how it ended, once, kindly.
    checkReturnedTopUp()
      .then(r => { if (alive && r) useUI.getState().openSheet(c2 => <TopUpStatusSheet result={r} close={c2} />) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const loadMore = () => fetchMovements(page + 1)
    .then(r => { setMovs(prev => (prev ? { items: prev.items.concat(r.items), hasMore: r.hasMore } : r)); setPage(p => p + 1) })
    .catch(() => setMovErr(true))

  const startTopup = async () => {
    if (busy) return
    const clamped = clampAmount(amount, limits)
    if (!clamped) { setTopupErr(t('Choose an amount first — pick a pack or type one.')); return }
    setBusy(true); setTopupErr(null)
    try {
      const { order } = await createOrder(clamped)
      const url = order && (order.redirect_url || order.redirectUrl)
      if (!url) { setTopupErr(t("Couldn't start the payment — try again in a moment.")); setBusy(false); return }
      // Breadcrumb BEFORE navigating away: coming back is detected even if the browser
      // threw the page state away. The voucher lookup needs the order id.
      const orderId = order && (order.id || order.order_id || order.orderId)
      if (orderId) saveTopupRecord(orderId)
      goToPayment(url)
    } catch (e) {
      setTopupErr(
        e.status === 401 ? t('Your session has expired — sign in again and come back to your wallet.')
        : e.status === 402 ? t("Adding credits isn't available right now — please try again later.")
        : typeof e.status === 'number' ? t('The recharge could not be started: {0}', e.message)
        : t("We couldn't reach the payment service — check your connection and try again.")
      )
      setBusy(false)
    }
  }

  const shown = movs ? movs.items : null
  return <>
    <h3>{t('Wallet')}</h3>

    {/* ---------- balance ---------- */}
    <div style={{ textAlign: 'center', margin: '4px 0 6px' }}>
      <div style={{ fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--acc)' }}>
        {balance != null ? fmtNum(balance) : '…'}
      </div>
      <div className="muted small">{t('credits available')}</div>
    </div>
    <div className="dim small" style={{ textAlign: 'center', lineHeight: 1.5, marginBottom: 8 }}>
      {t('Credits pay for the AI assistant. Everything else in the app — your plan, your history — stays free and works offline.')}
    </div>

    {/* ---------- top-up ---------- */}
    {limitsErr && limitsErr.status === 401 ? (
      <p className="muted small" style={{ textAlign: 'center' }}>{t('Sign in again to add credits.')}</p>
    ) : (limitsErr && limitsErr.status === 402) ? (
      <p className="muted small" style={{ textAlign: 'center' }}>{t("Adding credits isn't available right now — please try again later.")}</p>
    ) : <>
      <h4 className="sec">{t('Add credits')}</h4>
      <div className="chips" style={{ marginBottom: 10 }}>
        {PRESETS.map(p => {
          const v = clampAmount(p, limits) || p
          return <button key={p} className={'chip' + (amount === v ? ' on' : '')} onClick={() => setAmount(v)}>
            {fmtNum(v)} CLP
          </button>
        })}
      </div>
      <div className="row between" style={{ padding: '8px 2px', gap: 10 }}>
        <span className="muted small">{t('Other amount (CLP)')}</span>
        <NumberField value={amount} decimal={false} style={{ width: 110, textAlign: 'right' }}
          onChange={v => setAmount(v)} onBlur={() => setAmount(clampAmount(amount, limits))} />
      </div>
      {limits && <div className="dim small" style={{ margin: '0 2px 10px' }}>
        {limits.min != null || limits.max != null
          ? t('Recharges run from {0} to {1} CLP.', limits.min != null ? fmtNum(limits.min) : '—', limits.max != null ? fmtNum(limits.max) : '—')
          : null}
      </div>}
      <Button variant="primary" disabled={busy} onClick={startTopup}>
        {busy ? t('Opening the payment site…') : t('Add {0} CLP in credits', fmtNum(amount))}
      </Button>
      {topupErr && <div className="dim small" style={{ marginTop: 8 }}>{topupErr}</div>}
      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {t('You go to the payment site and come back here by yourself — your recharge is checked automatically on return.')}
      </div>
    </>}

    {/* ---------- cost per operation ---------- */}
    <h4 className="sec">{t('Cost per operation')}</h4>
    {tariffs === null
      ? <div className="dim small">…</div>
      : tariffs.length === 0
        ? <div className="dim small">{t('Costs show up here as soon as the assistant is configured.')}</div>
        : <>
          <div className="list">
            {tariffs.map(op => <div key={op.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
              <span className="tt" style={{ fontSize: 15 }}>{op.label}</span>
              <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {op.cost != null ? t('{0} credits', op.cost) : '—'}
              </span>
            </div>)}
          </div>
          <div className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {t('The cost is always shown before an AI action starts — you decide each time, nothing runs on its own.')}
          </div>
        </>}

    {/* ---------- movements ---------- */}
    <h4 className="sec">{t('Movements')}</h4>
    {movErr && shown && shown.length > 0
      ? <div className="dim small">{t("Couldn't load the next page — check your connection and try again.")}</div>
      : null}
    {shown === null && !movErr
      ? <div className="dim small">…</div>
      : shown && shown.length === 0
        ? <div className="dim small">{t('No movements yet — your credits live here.')}</div>
        : <div className="list">{shown.map((m, i) => <MovementRow key={i} m={m} />)}</div>}
    {!movErr && movs && movs.hasMore && <Button style={{ marginTop: 10 }} onClick={loadMore}>{t('Show more')}</Button>}
    {movErr && (!shown || shown.length === 0) && <div style={gap}>
      <div className="dim small">{t("Couldn't load your movements right now — no rush, everything is kept.")}</div>
      <Button onClick={() => { setMovErr(false); setMovs(null); fetchMovements(1).then(r => { setMovs(r); setPage(1) }).catch(() => setMovErr(true)) }}>
        {t('Try again')}
      </Button>
    </div>}
    <div style={{ height: 10 }} />
  </>
}

// Signed-in platform build only: guests, demo and mobile have no platform wallet.
export function openWallet() {
  if (MOBILE || DEMO) return null
  if (!useStore.getState().user) return null
  return useUI.getState().openSheet(close => <WalletPanel close={close} />)
}

// Boot check: an order that came back from the payment site since the last visit speaks
// up once, right after sign-in, with neutral copy — the wallet opens on "See my wallet".
export function ReturnedTopUpCheck() {
  useEffect(() => {
    // Platform users only — guests, demo and mobile builds have no wallet to check.
    const st = useStore.getState()
    if (MOBILE || DEMO || !st.user || st.isGuest()) return
    let alive = true
    checkReturnedTopUp()
      .then(r => {
        if (!alive || !r) return
        useUI.getState().openSheet(close => <TopUpStatusSheet result={r} close={close} />)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return null
}
