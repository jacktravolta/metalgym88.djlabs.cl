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
//
// The hosted checkout ALWAYS continues in this same window: paying replaces the app
// for a moment, and the boot check speaks the result when the person comes back.
// CLP opens Mercado Pago's hosted payment page; USD keeps the existing PayPal
// redirect flow. No provider card form is mounted inside the wallet.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { me as platformMe } from '../lib/platform/auth.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { TERMS_URL, PRIVACY_URL } from '../lib/legal.js'
import {
  fetchMovements, fetchTariffs, fetchLimits, fetchQuote, formatMoney,
  usdPriceLabel, groupMovements,
  availableProvidersForCurrency, alternativeRailProvider, paymentOutcome,
  selectWalletCurrency, walletPayButtonLabelKey, startWalletPayment,
  saveTopupRecord, checkReturnedTopUp,
} from '../lib/platform/wallet.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const gap = { display: 'grid', gap: 10 }

function TopUpStatusSheet({ result, close }) {
  // Neutral copy per status: what happened, what (if anything) to do next — never scary.
  // Provider detail codes are translated before they reach this component.
  const outcome = paymentOutcome(result.status || result.kind, result.statusDetail)
  const kind = result.kind === 'canceled' ? 'canceled' : outcome.kind
  const copy = result.kind === 'canceled'
    ? [t('The recharge was left unfinished'), t('Nothing was charged. Whenever you want, you can start it again from your wallet.')]
    : result.kind === 'approved'
      ? [t('Your recharge went through'), t('The credits are already in your balance. Nothing else to do.')]
      : result.kind === 'pending_review' && result.status !== 'pending_challenge'
        ? [t('Your recharge is being reviewed'), t('The payment is being checked. If everything matches, the credits are added to your balance — no action needed from you.')]
        : [t(outcome.titleKey), t(outcome.messageKey)]
  return <div style={{ textAlign: 'center', padding: '6px 0' }}>
    <div style={{ fontSize: 40, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
      <Icon name={kind === 'rejected' || kind === 'canceled' ? 'wallet' : 'checkCircle'} />
    </div>
    <h3 style={{ margin: '8px 0 4px' }}>{copy[0]}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>{copy[1]}</div>
    <Button variant="primary" onClick={() => { close(); openWallet() }}>{t('See my wallet')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </div>
}

const signedNum = n => (n < 0 ? '−' : '+') + fmtNum(Math.abs(n))

function MovementRow({ m }) {
  return <div className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--sep)' }}>
    <span className="tt" style={{ fontSize: 15 }}>{t(m.label)}</span>
    <span style={{ fontWeight: 600, color: m.dir < 0 ? 'var(--label)' : 'var(--acc)', fontVariantNumeric: 'tabular-nums' }}>
      {signedNum(m.dir < 0 ? -(m.amount ?? 0) : (m.amount ?? 0))}
    </span>
  </div>
}

// One header per calendar day: the date, the day's net total and — when the day
// mixes types — the signed total per type. The rows under it keep their own amount
// and type label, so the list reads as days instead of one endless column.
function MovementDay({ group }) {
  const mixed = group.types.length > 1
  return <div>
    <div style={{ padding: '12px 2px 4px', borderBottom: '1px solid var(--sep)' }}>
      <div className="row between" style={{ gap: 10 }}>
        <span className="muted small" style={{ fontWeight: 600 }}>
          {group.day ? fmtDate(group.day, true) : t('Undated')}
        </span>
        <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {t('Net')} {signedNum(group.net)}
        </span>
      </div>
      {mixed && <div className="dim small" style={{ marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {group.types.map(row => `${t(row.label)} ${signedNum(row.total)}`).join(' · ')}
      </div>}
    </div>
    {group.items.map((m, i) => <MovementRow key={i} m={m} />)}
  </div>
}

function WalletPanel({ close }) {
  const balance = useStore(s => s.balance)
  const [movs, setMovs] = useState(null)          // { items, hasMore } — null = loading
  const [page, setPage] = useState(1)
  const [movErr, setMovErr] = useState(false)
  const [tariffs, setTariffs] = useState(null)
  const [limitsErr, setLimitsErr] = useState(null)
  const [quote, setQuote] = useState(null)
  const [currency, setCurrency] = useState('CLP')
  const [variantId, setVariantId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [topupErr, setTopupErr] = useState(null)
  const [legalAccepted, setLegalAccepted] = useState(false)

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
      .catch(e => { if (alive) setLimitsErr(e) })
    // The quote owns the available currencies, providers and prices. CLP is the
    // default selection; a missing quote leaves the band visibly unavailable.
    fetchQuote().then(q => {
      if (!alive || !q) return
      const primary = selectWalletCurrency(q)
      setQuote(q)
      setCurrency(primary ? primary.currency : 'CLP')
      setVariantId(primary && primary.variants[0] ? primary.variants[0].variantId : null)
    })
    // A recharge just came back from the payment site? Say how it ended, once, kindly.
    checkReturnedTopUp()
      .then(r => { if (alive && r) useUI.getState().openSheet(c2 => <TopUpStatusSheet result={r} close={c2} />) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const loadMore = () => fetchMovements(page + 1)
    .then(r => { setMovs(prev => (prev ? { items: prev.items.concat(r.items), hasMore: r.hasMore } : r)); setPage(p => p + 1) })
    .catch(() => setMovErr(true))

  const selectedOption = quote ? quote.currencies.find(c => c.currency === currency) : null
  const selectedVariant = selectedOption
    ? selectedOption.variants.find(v => v.variantId === variantId) || null
    : null

  // Each currency has one server-owned rail and one set of server-owned prices.
  // A provider is usable only when the backend advertises it for that currency.
  const selectedProviders = availableProvidersForCurrency(selectedOption, quote)
  const expectedProvider = currency === 'USD' ? 'paypal' : 'mercadopago'
  const railAvailable = selectedProviders.includes(expectedProvider)
  // This value only controls honest fallback wording. The wallet never offers
  // another provider when the platform did not advertise one.
  const alternativeProvider = alternativeRailProvider(selectedOption, quote)

  const chooseCurrency = option => {
    if (!option || !option.available) return
    setTopupErr(null)
    setCurrency(option.currency)
    setVariantId(option.variants[0] ? option.variants[0].variantId : null)
  }

  // Neutral copy per failure: what happened and what to do next — never blame.
  const errorCopy = e => {
    if (e && e.statusDetail) {
      const outcome = paymentOutcome('rejected', e.statusDetail)
      return t(outcome.messageKey)
    }
    return e && e.status === 401 ? t('Your session has expired — sign in again and come back to your wallet.')
    : e && e.status === 402 ? t("Adding credits isn't available right now — please try again later.")
    : e && typeof e.status === 'number' ? t('The recharge could not be started: {0}', e.message)
    : t("We couldn't reach the payment service — check your connection and try again.")
  }

  const startTopup = async () => {
    if (busy) return
    if (!legalAccepted) {
      setTopupErr(t('Accept the Terms and Conditions and the Privacy Policy to continue.'))
      return
    }
    if (!selectedVariant) {
      setTopupErr(t('Choose an option first.'))
      return
    }
    setBusy(true); setTopupErr(null)
    try {
      const result = await startWalletPayment({
        currency,
        variantId: selectedVariant.variantId,
        legalAccepted,
        // Breadcrumb BEFORE the hosted page opens: coming back is detected even if
        // the browser threw the page state away.
        onOrderCreated: orderId => saveTopupRecord(orderId),
      })
      if (!result.navigated) {
        setTopupErr(t("Couldn't open the payment page — try again in a moment."))
      }
    } catch (e) {
      setTopupErr(errorCopy(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = movs ? movs.items : null
  const groups = shown ? groupMovements(shown) : []
  const quoteCurrencies = quote ? quote.currencies : []
  // The recharge rails are CLP (Mercado Pago) and USD (PayPal). A quote that
  // advertises another currency is never offered: the pay button would have no
  // honest label and no rail behind it.
  const currencyRows = ['CLP', 'USD'].map(code => (
    quoteCurrencies.find(option => option.currency === code) || {
      currency: code,
      available: false,
      reason: t('Not available right now.'),
      variants: [],
      providers: [],
    }
  ))
  const variantList = selectedOption ? selectedOption.variants : []
  const visibleIva = selectedVariant?.iva || (currency === 'CLP' && quote ? quote.iva : null)
  const displayCurrency = currency || 'CLP'
  const displayedTotal = visibleIva
    ? visibleIva.total
    : displayCurrency === 'USD'
      ? selectedVariant?.priceUsd || 0
      : selectedVariant?.amountClp || 0
  const displayMoney = value => formatMoney(value, displayCurrency) + (displayCurrency === 'CLP' ? ' CLP' : '')
  const canPay = railAvailable && !!selectedVariant
  const unavailableCopy = !railAvailable && alternativeProvider
    ? t('This payment method is not available right now — you can choose another currency.')
    : !railAvailable
      ? t('This payment method is not available right now — please try again in a moment.')
      : t('No recharge options are available right now.')
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
      <div className="list" style={{ margin: '0 2px 12px' }}>
        {visibleIva && <>
          <div className="row between" style={{ padding: '7px 0' }}>
            <span className="muted small">{t('Net')}</span>
            <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{displayMoney(visibleIva.net)}</span>
          </div>
          <div className="row between" style={{ padding: '7px 0' }}>
            <span className="muted small">IVA</span>
            <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{displayMoney(visibleIva.iva)}</span>
          </div>
        </>}
        <div className="row between" style={{ padding: '9px 0', borderTop: visibleIva ? '1px solid var(--sep)' : 'none' }}>
          <span style={{ fontWeight: 600 }}>{t('Total (IVA included)')}</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{displayMoney(displayedTotal)}</strong>
        </div>
      </div>
      <div style={{ margin: '0 2px 12px' }}>
        <label className="dim small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={legalAccepted}
            onChange={e => { setLegalAccepted(e.target.checked); setTopupErr(null) }}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span>
            {t('I accept the Terms and Conditions and the Privacy Policy')} ·{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{t('Terms and Conditions')}</a>
            {' · '}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{t('Privacy Policy')}</a>
          </span>
        </label>
      </div>
      <div style={{ margin: '0 2px 12px' }}>
        {quote?.detectedCountry && <div className="muted small" style={{ marginBottom: 8 }}>
          {t('Detected country: {0}', quote.detectedCountry)}
        </div>}
        <div className="row between" style={{ gap: 10 }}>
          <span className="muted small">{t('Payment currency')}</span>
          <div className="chips">
            {currencyRows.map(option => (
              <button
                key={option.currency}
                className={'chip' + (currency === option.currency ? ' on' : '')}
                disabled={!option.available}
                aria-pressed={currency === option.currency}
                onClick={() => chooseCurrency(option)}
              >
                {option.currency}
              </button>
            ))}
          </div>
        </div>
        {quote && currencyRows.filter(option => !option.available).map(option => (
          <div key={option.currency} className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>{option.currency}:</span>{' '}
            {option.reason || t('Not available right now.')}
          </div>
        ))}
      </div>
      {railAvailable && variantList.length > 0 ? <div className="chips" style={{ marginBottom: 10 }}>
        {variantList.map(variant => {
          const price = displayCurrency === 'USD'
            ? usdPriceLabel(variant) || '—'
            : variant.amountClp != null ? fmtNum(variant.amountClp) + ' CLP' : '—'
          return <button
            key={variant.variantId}
            className={'chip nocap' + (selectedVariant?.variantId === variant.variantId ? ' on' : '')}
            aria-pressed={selectedVariant?.variantId === variant.variantId}
            onClick={() => { setVariantId(variant.variantId); setTopupErr(null) }}
          >
            {price}{variant.credits != null ? ` · ${t('{0} credits', fmtNum(variant.credits))}` : ''}
          </button>
        })}
      </div> : <div className="dim small" style={{ marginBottom: 10 }}>
        {unavailableCopy}
      </div>}
      {canPay ? <Button variant="primary" disabled={busy || !legalAccepted} onClick={startTopup}>
        {t(walletPayButtonLabelKey(currency))}
      </Button> : null}
      {topupErr && <div className="dim small" style={{ marginTop: 8 }}>{topupErr}</div>}
      {canPay ? <div className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {t('The payment continues in this same window.')}
      </div> : null}
    </>}

    {/* ---------- cost per operation ---------- */}
    {tariffs === null
      ? <>
        <h4 className="sec">{t('Cost per operation')}</h4>
        <div className="dim small">…</div>
      </>
      : tariffs.length > 0
        ? <>
          <h4 className="sec">{t('Cost per operation')}</h4>
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
        </>
        : null}

    {/* ---------- movements ---------- */}
    <h4 className="sec">{t('Movements')}</h4>
    {movErr && shown && shown.length > 0
      ? <div className="dim small">{t("Couldn't load the next page — check your connection and try again.")}</div>
      : null}
    {shown === null && !movErr
      ? <div className="dim small">…</div>
      : shown && shown.length === 0
        ? <div className="dim small">{t('No movements yet — your credits live here.')}</div>
        : <div className="list">{groups.map(group => <MovementDay key={group.day || 'undated'} group={group} />)}</div>}
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
// The wallet is a singleton: opening it again replaces the open one instead of
// stacking a second copy on top of it (the balance is re-read on mount anyway).
let walletSheetId = null
export function openWallet() {
  if (MOBILE || DEMO) return null
  if (!useStore.getState().user) return null
  const ui = useUI.getState()
  if (walletSheetId && ui.sheets.some(s => s.id === walletSheetId)) ui.closeSheet(walletSheetId)
  const h = ui.openSheet(close => <WalletPanel close={close} />)
  walletSheetId = h.id
  return h
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
