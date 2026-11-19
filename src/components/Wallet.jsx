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
// The redirect rail ALWAYS continues in this same window: paying replaces the app
// for a moment, and the boot check speaks the result when the person comes back.
// The card rails render their provider fields in place (no hosted account page),
// so a card payment never leaves this sheet. The default card rail is selected
// only when the backend advertises it and supplies its public key.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { me as platformMe } from '../lib/platform/auth.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { TERMS_URL, PRIVACY_URL } from '../lib/legal.js'
import {
  fetchMovements, fetchTariffs, fetchLimits, fetchQuote, clampAmount, formatMoney,
  usdPriceLabel, usdPacks, showsCustomAmount, groupMovements,
  createOrder, createCardOrder, extractCardToken, normalizeMercadoPagoCardData,
  hasMercadoPagoRail, alternativeRailProvider, loadPaypalSdk, loadMercadoPagoSdk, paymentOutcome, goToPayment,
  saveTopupRecord, checkReturnedTopUp,
} from '../lib/platform/wallet.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const gap = { display: 'grid', gap: 10 }
// Default pack when the platform gives no limits of its own (server still re-clamps).
// 350 CLP is the smallest amount the card gateway accepts, so it is the
// smallest pack we offer: anything below it never opens the payment page.
const PRESETS = [350, 1000, 5000, 10000]
const DEFAULT_AMOUNT = 5000
// PayPal renders its card fields inside our sheet. The iframe keeps its own light
// input surface, so the text stays dark and readable on it in every app theme.
const CARD_STYLE = {
  input: { 'font-size': '16px', 'font-family': 'inherit', color: '#1c1c1e' },
  '.invalid': { color: '#d70015' },
}

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
  const userEmail = useStore(s => s.user?.email) || ''
  const [movs, setMovs] = useState(null)          // { items, hasMore } — null = loading
  const [page, setPage] = useState(1)
  const [movErr, setMovErr] = useState(false)
  const [tariffs, setTariffs] = useState(null)
  const [limits, setLimits] = useState(null)
  const [limitsErr, setLimitsErr] = useState(null)
  const [quote, setQuote] = useState(null)
  const [currency, setCurrency] = useState('CLP')
  const [variantId, setVariantId] = useState(null)
  const [amount, setAmount] = useState(DEFAULT_AMOUNT)
  const [busy, setBusy] = useState(false)
  const [topupErr, setTopupErr] = useState(null)
  const [legalAccepted, setLegalAccepted] = useState(false)
  // Mercado Pago is the primary rail when the backend advertises it. Existing
  // redirect and PayPal paths stay untouched behind the secondary control.
  const [showAlternativePayment, setShowAlternativePayment] = useState(false)
  const [mpState, setMpState] = useState('idle')
  const [mpBusy, setMpBusy] = useState(false)
  const [mpErr, setMpErr] = useState(null)
  const [mpVariantId, setMpVariantId] = useState(null)
  const mpBrick = useRef(null)
  const mpBusyRef = useRef(false)
  // Card form: idle → loading → ready (fields rendered) or unavailable (honest fallback).
  const [cardState, setCardState] = useState('idle')
  const [cardBusy, setCardBusy] = useState(false)
  const [cardErr, setCardErr] = useState(null)
  const cardFields = useRef(null)
  const cardCreateOrder = useRef(null)
  const selectedVariantRef = useRef(null)
  // Providers render into ids we own; useId keeps them unique across sheet reopens.
  const cardUid = useId().replace(/:/g, '')
  const mpUid = useId().replace(/:/g, '')

  const refreshWallet = useCallback(() => {
    platformMe()
      .then(({ balance: b }) => { if (b != null) useStore.setState({ balance: b }) })
      .catch(() => {})
    fetchMovements(1)
      .then(r => { setMovs(r); setPage(1); setMovErr(false) })
      .catch(() => {})
  }, [])

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
    // The quote enriches the recharge when the platform offers it. A missing or
    // failed quote leaves the existing CLP-only flow untouched and visible.
    fetchQuote().then(q => {
      if (!alive || !q) return
      const available = q.currencies.filter(c => c.available)
      const preferred = available.find(c => c.currency === q.defaultCurrency) || available[0] || null
      const mpAvailable = hasMercadoPagoRail(q.providers, q.mercadopago)
      const primary = mpAvailable
        ? available.find(c => c.currency === 'CLP') || preferred
        : preferred
      setQuote(q)
      setCurrency(primary ? primary.currency : '')
      setVariantId(primary && primary.currency === 'USD' && primary.variants[0]
        ? primary.variants[0].variantId
        : null)
      if (mpAvailable) {
        const mpOption = q.currencies.find(c => c.currency === 'CLP' && c.available)
        setMpVariantId(mpOption && mpOption.variants[0] ? mpOption.variants[0].variantId : null)
        setShowAlternativePayment(false)
      }
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
  selectedVariantRef.current = selectedVariant

  const paypalInfo = quote ? quote.paypal : null
  const cardWanted = currency === 'USD' && !!paypalInfo
  const cardReady = cardWanted && cardState === 'ready'

  const mpInfo = quote ? quote.mercadopago : null
  const mpAvailable = hasMercadoPagoRail(quote?.providers, mpInfo)
  const mpOption = quote ? quote.currencies.find(c => c.currency === 'CLP' && c.available) : null
  const mpVariants = mpOption ? mpOption.variants : []
  const mpVariant = mpVariants.find(v => v.variantId === mpVariantId) || mpVariants[0] || null
  const mpAmount = mpVariant?.amountClp || quote?.iva?.total || clampAmount(amount, limits) || DEFAULT_AMOUNT
  const mpWanted = mpAvailable && !showAlternativePayment
  const mpReady = mpWanted && mpState === 'ready'

  // Loads and mounts PayPal's card fields only while the USD rail is selected and
  // the API exposed a public client id. Any failure leaves the card option off and
  // the same-window gateway redirect on.
  useEffect(() => {
    if (!cardWanted) {
      setCardState('idle')
      return
    }
    let alive = true
    setCardState('loading')
    setCardErr(null)
    cardFields.current = null
    loadPaypalSdk(paypalInfo).then(paypal => {
      if (!alive) return
      if (!paypal) { setCardState('unavailable'); return }
      let fields = null
      try {
        fields = paypal.CardFields({
          style: CARD_STYLE,
          inputEvents: {
            onFocus: () => setCardErr(null),
            onError: () => setCardErr(t('Check the card details and try again.')),
          },
          // The SDK hands over a token here; only the token leaves the card iframes.
          createOrder: data => cardCreateOrder.current(data),
          // The server answer already drives the UI inside createOrder.
          onApprove: () => {},
          onError: () => setCardErr(t("The card payment couldn't be completed — nothing was charged. Try another card or continue on the payment page.")),
        })
        fields.NameField().render('#pp-card-name-' + cardUid)
        fields.NumberField().render('#pp-card-number-' + cardUid)
        fields.ExpiryField().render('#pp-card-expiry-' + cardUid)
        fields.CvvField().render('#pp-card-cvv-' + cardUid)
      } catch {
        if (alive) setCardState('unavailable')
        return
      }
      if (!alive) {
        try { if (typeof fields.teardown === 'function') fields.teardown() } catch { /* already gone */ }
        return
      }
      cardFields.current = fields
      setCardState('ready')
    }).catch(() => { if (alive) setCardState('unavailable') })
    return () => {
      alive = false
      const fields = cardFields.current
      cardFields.current = null
      try { if (fields && typeof fields.teardown === 'function') fields.teardown() } catch { /* already gone */ }
    }
  }, [cardWanted, paypalInfo?.clientId, paypalInfo?.environment, cardUid])

  // Mercado Pago's Card Payment Brick owns the card fields in its own iframes.
  // Its default submit button is hidden so the app's consent-gated button stays
  // the only way to start a payment.
  useEffect(() => {
    if (!mpWanted) {
      setMpState('idle')
      setMpErr(null)
      return
    }
    let alive = true
    setMpState('loading')
    setMpErr(null)
    mpBrick.current = null
    loadMercadoPagoSdk(mpInfo).then(async builder => {
      if (!alive) return
      if (!builder) { setMpState('unavailable'); return }
      try {
        const initialization = { amount: mpAmount }
        if (userEmail) initialization.payer = { email: userEmail, identification: { type: 'RUT' } }
        const controller = await builder.create('cardPayment', 'mp-card-' + mpUid, {
          initialization,
          callbacks: {
            onReady: () => { if (alive) setMpState('ready') },
            onSubmit: () => Promise.resolve(),
            onError: error => {
              if (!alive) return
              setMpErr(t("The card form couldn't be loaded — try another card or use another payment method."))
              if (error && error.type === 'critical') setMpState('unavailable')
            },
          },
          customization: { visual: { hidePaymentButton: true } },
          locale: 'es-CL',
        })
        if (!alive) {
          try { if (controller && typeof controller.unmount === 'function') controller.unmount() } catch { /* already gone */ }
          return
        }
        mpBrick.current = controller
        setMpState('ready')
      } catch {
        if (alive) setMpState('unavailable')
      }
    }).catch(() => { if (alive) setMpState('unavailable') })
    return () => {
      alive = false
      const controller = mpBrick.current
      mpBrick.current = null
      try { if (controller && typeof controller.unmount === 'function') controller.unmount() } catch { /* already gone */ }
    }
  }, [mpWanted, mpInfo?.publicKey, mpAmount, userEmail, mpUid])

  const chooseCurrency = option => {
    if (!option || !option.available) return
    setTopupErr(null)
    setCardErr(null)
    setCurrency(option.currency)
    setVariantId(option.currency === 'USD' && option.variants[0] ? option.variants[0].variantId : null)
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
    let orderAmount = null
    let orderOptions = { currency: 'CLP', legalConsent: { terms: true, privacy: true } }
    if (currency === 'USD') {
      if (!selectedVariant) { setTopupErr(t('Choose an option first.')); return }
      orderOptions = { currency: 'USD', variantId: selectedVariant.variantId, legalConsent: { terms: true, privacy: true } }
    } else if (currency === 'CLP') {
      const clamped = clampAmount(amount, limits)
      if (!clamped) { setTopupErr(t('Choose an amount first — pick a pack or type one.')); return }
      orderAmount = clamped
      // This is the redirect rail. Naming it keeps the server from resolving
      // the heart's default, which may be the in-app card rail and cannot be
      // paid from a redirect screen.
      orderOptions = {
        ...orderOptions,
        provider: alternativeRailProvider(selectedOption, quote),
      }
    } else {
      setTopupErr(t('No recharge options are available right now.'))
      return
    }
    setBusy(true); setTopupErr(null)
    try {
      const { order } = await createOrder(orderAmount, orderOptions)
      const url = order && (order.redirect_url || order.redirectUrl)
      if (!url) {
        setTopupErr(t("Couldn't start the payment — try again in a moment."))
        setBusy(false); return
      }
      // Breadcrumb BEFORE the gateway opens: coming back is detected even if the
      // browser threw the page state away. The voucher lookup needs the order id.
      const orderId = order && (order.id || order.order_id || order.orderId)
      if (orderId) saveTopupRecord(orderId)
      // Same window, always: the gateway replaces the app and the boot check speaks
      // the result when the person comes back.
      const went = goToPayment(url)
      setBusy(false)
      if (!went) setTopupErr(t("Couldn't open the payment page — try again in a moment."))
    } catch (e) {
      setTopupErr(errorCopy(e))
      setBusy(false)
    }
  }

  // Runs inside PayPal's createOrder callback: extract the token, post it with the
  // selected variant, and let the server answer decide what the UI says.
  cardCreateOrder.current = async data => {
    const variant = selectedVariantRef.current
    if (!legalAccepted) {
      setCardErr(t('Accept the Terms and Conditions and the Privacy Policy to continue.'))
      throw new Error('Legal consent required')
    }
    if (!variant) {
      setCardErr(t('Choose an option first.'))
      throw new Error('No USD variant selected')
    }
    const token = extractCardToken(data)
    if (!token) {
      setCardErr(t('We could not read the card details — please enter them again.'))
      throw new Error('No card token')
    }
    setCardBusy(true); setCardErr(null)
    try {
      const { order } = await createCardOrder(variant.variantId, token, {
        legalConsent: { terms: true, privacy: true },
      })
      if (!order || (!order.orderId && !order.providerOrderId)) {
        setCardErr(t("Couldn't complete the card payment — try again in a moment."))
        throw new Error('Malformed card order response')
      }
      // Drive the result from the server response, not from an SDK callback:
      // APPROVED means the capture already happened and the credits are in.
      const outcome = paymentOutcome(order.status, order.statusDetail)
      if (outcome.kind === 'approved') refreshWallet()
      useUI.getState().openSheet(c2 => <TopUpStatusSheet result={{ kind: outcome.kind, status: order.status, statusDetail: order.statusDetail }} close={c2} />)
      return order.providerOrderId || order.orderId
    } catch (e) {
      setCardErr(errorCopy(e))
      throw e
    } finally {
      setCardBusy(false)
    }
  }

  const submitCard = () => {
    if (cardBusy) return
    const fields = cardFields.current
    if (!fields || typeof fields.submit !== 'function') {
      setCardErr(t("The card form isn't available right now — you can continue on the payment page."))
      return
    }
    setCardErr(null)
    try {
      const pending = fields.submit()
      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    } catch {
      setCardErr(t("We couldn't send the card details — please try again."))
    }
  }

  const submitMercadoPago = async () => {
    if (mpBusyRef.current) return
    if (!legalAccepted) {
      setMpErr(t('Accept the Terms and Conditions and the Privacy Policy to continue.'))
      return
    }
    if (!mpVariant) {
      setMpErr(t('Card recharge options are not available right now.'))
      return
    }
    const controller = mpBrick.current
    if (!controller || typeof controller.getFormData !== 'function') {
      setMpErr(t("The card form isn't available right now — you can use another payment method."))
      return
    }
    mpBusyRef.current = true
    setMpBusy(true); setMpErr(null)
    try {
      const cardData = normalizeMercadoPagoCardData(await controller.getFormData())
      if (!cardData) {
        setMpErr(t('We could not read the card details — please enter them again.'))
        return
      }
      const { order } = await createCardOrder(mpVariant.variantId, cardData.token, {
        provider: 'mercadopago',
        issuerId: cardData.issuerId,
        paymentMethodId: cardData.paymentMethodId,
        installments: cardData.installments,
        payer: cardData.payer,
        legalConsent: { terms: true, privacy: true },
      })
      if (!order || (!order.orderId && !order.providerOrderId)) {
        setMpErr(t("Couldn't complete the card payment — try again in a moment."))
        return
      }
      const outcome = paymentOutcome(order.status, order.statusDetail)
      if (outcome.kind === 'approved') refreshWallet()
      useUI.getState().openSheet(c2 => <TopUpStatusSheet result={{ kind: outcome.kind, status: order.status, statusDetail: order.statusDetail }} close={c2} />)
    } catch (e) {
      setMpErr(errorCopy(e))
    } finally {
      mpBusyRef.current = false
      setMpBusy(false)
    }
  }

  const shown = movs ? movs.items : null
  const groups = shown ? groupMovements(shown) : []
  const usdPackList = selectedOption ? usdPacks(selectedOption) : []
  // The breakdown belongs to the price being paid: the picked card variant when
  // the card rail leads, and nothing when the buyer switches to the gateway.
  const visibleIva = mpAvailable && !showAlternativePayment
    ? (mpVariant && mpVariant.iva) || (quote ? quote.iva : null)
    : null
  const displayCurrency = currency || 'CLP'
  const fallbackTotal = mpAvailable && !showAlternativePayment
    ? mpAmount
    : currency === 'USD'
      ? selectedVariant?.priceUsd || 0
      : clampAmount(amount, limits) || 0
  const displayedTotal = visibleIva ? visibleIva.total : fallbackTotal
  const displayMoney = value => formatMoney(value, displayCurrency) + (displayCurrency === 'CLP' ? ' CLP' : '')
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
            onChange={e => { setLegalAccepted(e.target.checked); setTopupErr(null); setCardErr(null); setMpErr(null) }}
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
      {mpAvailable && !showAlternativePayment ? <>
        {mpVariants.length > 0 ? <div className="chips" style={{ marginBottom: 10 }}>
          {mpVariants.map(variant => (
            <button
              key={variant.variantId}
              className={'chip nocap' + (mpVariant?.variantId === variant.variantId ? ' on' : '')}
              aria-pressed={mpVariant?.variantId === variant.variantId}
              onClick={() => { setMpVariantId(variant.variantId); setMpErr(null) }}
            >
              {variant.amountClp != null ? fmtNum(variant.amountClp) + ' CLP' : '—'}
              {variant.credits != null ? ` · ${t('{0} credits', fmtNum(variant.credits))}` : ''}
            </button>
          ))}
        </div> : <div className="dim small" style={{ marginBottom: 10 }}>
          {t('Card recharge options are not available right now.')}
        </div>}
        <div className="muted small" style={{ margin: '0 2px 8px' }}>{t('Pay with a card — no account needed.')}</div>
        <div id={'mp-card-' + mpUid} style={{ margin: '0 2px 10px' }} />
        {mpState === 'loading' && <div className="dim small" style={{ margin: '0 2px 8px' }}>
          {t('Loading the card form…')}
        </div>}
        {mpState === 'unavailable' && <div className="dim small" style={{ margin: '0 2px 8px' }}>
          {t("The card form isn't available right now — you can use another payment method.")}
        </div>}
        <Button
          variant="primary"
          disabled={!legalAccepted || mpBusy || !mpVariant || mpState !== 'ready'}
          onClick={submitMercadoPago}
        >
          {mpBusy
            ? t('Processing the payment…')
            : mpVariant && mpVariant.credits != null
              ? t('Add {0} in credits · {1} credits', displayMoney(mpAmount), fmtNum(mpVariant.credits))
              : t('Add {0} in credits', displayMoney(mpAmount))}
        </Button>
        {mpErr && <div className="dim small" style={{ marginTop: 8 }}>{mpErr}</div>}
        <Button variant="ghost" className="dim" style={{ marginTop: 8 }} onClick={() => { setShowAlternativePayment(true); setTopupErr(null); setCardErr(null); setMpErr(null) }}>
          {t('Other payment methods')}
        </Button>
      </> : <>
      {quote && <div style={{ margin: '0 2px 12px' }}>
        {quote.detectedCountry && <div className="muted small" style={{ marginBottom: 8 }}>
          {t('Detected country: {0}', quote.detectedCountry)}
        </div>}
        <div className="row between" style={{ gap: 10 }}>
          <span className="muted small">{t('Payment currency')}</span>
          <div className="chips">
            {quote.currencies.map(option => (
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
        {quote.currencies.filter(option => !option.available).map(option => (
          <div key={option.currency} className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>{option.currency}:</span>{' '}
            {option.reason || t('Not available right now.')}
          </div>
        ))}
      </div>}
      {showsCustomAmount(currency) ? <>
        <div className="chips" style={{ marginBottom: 10 }}>
          {PRESETS.map(p => {
            const v = clampAmount(p, limits) || p
            return <button key={p} className={'chip' + (amount === v ? ' on' : '')} onClick={() => setAmount(v)}>
              {fmtNum(v)} CLP
            </button>
          })}
        </div>
        {limits && <div className="dim small" style={{ margin: '0 2px 10px' }}>
          {limits.min != null || limits.max != null
            ? t('Recharges run from {0} to {1} CLP.', limits.min != null ? fmtNum(limits.min) : '—', limits.max != null ? fmtNum(limits.max) : '—')
            : null}
        </div>}
        <Button variant="primary" disabled={busy || !legalAccepted} onClick={startTopup}>
          {busy ? t('Opening the payment site…') : t('Add {0} CLP in credits', fmtNum(amount))}
        </Button>
      </> : currency === 'USD' ? <>
        <div className="chips" style={{ marginBottom: 10 }}>
          {usdPackList.length ? usdPackList.map(pack => (
            <button
              key={pack.variantId}
              className={'chip nocap' + (variantId === pack.variantId ? ' on' : '')}
              aria-pressed={variantId === pack.variantId}
              onClick={() => { setVariantId(pack.variantId); setTopupErr(null); setCardErr(null) }}
            >
              {pack.price}{pack.credits != null ? ` · ${t('{0} credits', fmtNum(pack.credits))}` : ''}
            </button>
          )) : <div className="dim small">{t('No recharge options are available right now.')}</div>}
        </div>
        {cardWanted ? <>
          <div className="muted small" style={{ margin: '0 2px 8px' }}>{t('Pay with a card — no account needed.')}</div>
          {/* PayPal owns these iframes: the card data never enters our state. */}
          <div style={{ display: 'grid', gap: 8, margin: '0 2px 10px' }}>
            <div id={'pp-card-name-' + cardUid} />
            <div id={'pp-card-number-' + cardUid} />
            <div className="row" style={{ gap: 8 }}>
              <div id={'pp-card-expiry-' + cardUid} style={{ flex: 1 }} />
              <div id={'pp-card-cvv-' + cardUid} style={{ flex: 1 }} />
            </div>
          </div>
          {cardState === 'loading' && <div className="dim small" style={{ margin: '0 2px 8px' }}>
            {t('Loading the card form…')}
          </div>}
          {cardState === 'unavailable' && <div className="dim small" style={{ margin: '0 2px 8px' }}>
            {t("The card form isn't available right now — you can continue on the payment page.")}
          </div>}
        </> : <div className="dim small" style={{ margin: '0 2px 8px' }}>
          {t('Card payment is not available right now — you will continue on the payment page.')}
        </div>}
        <Button
          variant="primary"
          disabled={busy || cardBusy || !legalAccepted || !selectedVariant || (cardWanted && cardState === 'loading')}
          onClick={cardReady ? submitCard : startTopup}
        >
          {cardBusy
            ? t('Processing the payment…')
            : busy
              ? t('Opening the payment site…')
              : selectedVariant
                ? (selectedVariant.credits != null
                  ? t('Add {0} in credits · {1} credits', usdPriceLabel(selectedVariant) || '—', fmtNum(selectedVariant.credits))
                  : t('Add {0} in credits', usdPriceLabel(selectedVariant) || '—'))
                : t('Choose an option first.')}
        </Button>
        {cardErr && <div className="dim small" style={{ marginTop: 8 }}>{cardErr}</div>}
      </> : <div className="muted small">{t('No recharge options are available right now.')}</div>}
      {mpAvailable && showAlternativePayment ? <Button variant="ghost" className="dim" style={{ marginTop: 8 }} onClick={() => { setShowAlternativePayment(false); setTopupErr(null); setCardErr(null); setMpErr(null) }}>
        {t('Back to card payment')}
      </Button> : null}
      </>}
      {topupErr && <div className="dim small" style={{ marginTop: 8 }}>{topupErr}</div>}
      {mpAvailable && !showAlternativePayment ? null : cardReady ? null : <div className="dim small" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {t('The payment continues in this same window.')}
      </div>}
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
