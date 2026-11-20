import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import es from '../locales/es.js'
import {
  normalizeQuote,
  selectWalletCurrency,
  startWalletPayment,
  walletPayButtonLabelKey,
} from '../lib/platform/wallet.js'

const source = readFileSync(new URL('./Wallet.jsx', import.meta.url), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wallet hosted checkout', () => {
  const quote = normalizeQuote({
    default_currency: 'USD',
    currencies: [
      {
        currency: 'CLP',
        available: true,
        providers: ['mercadopago'],
        variants: [{ variant_id: 'mp_5000', amount_clp: 5000, credits: 5000 }],
      },
      {
        currency: 'USD',
        available: true,
        providers: ['paypal'],
        variants: [{ variant_id: 'pp_5', price_usd_cents: 500, credits: 5000 }],
      },
    ],
  })

  it('selects CLP by default and keeps USD as the second choice', () => {
    expect(selectWalletCurrency(quote).currency).toBe('CLP')
  })

  it('labels the one primary action with the selected currency and payment method', () => {
    expect(walletPayButtonLabelKey('CLP')).toBe('Pay in CLP with Mercado Pago')
    expect(walletPayButtonLabelKey('USD')).toBe('Pay in USD with PayPal')
    expect(es['Pay in CLP with Mercado Pago']).toBe('Pagar en CLP con Mercado Pago')
    expect(es['Pay in USD with PayPal']).toBe('Pagar en USD con PayPal')
  })

  it('creates the Mercado Pago hosted order and opens its returned URL in this window', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const createCheckoutOrder = vi.fn(async () => ({
      orderId: 'o-mp',
      status: 'PENDING',
      redirectUrl: 'https://pay.example/mp-hosted',
    }))
    const createRedirectOrder = vi.fn()
    const onOrderCreated = vi.fn()

    const result = await startWalletPayment({
      currency: 'CLP',
      variantId: 'mp_5000',
      legalAccepted: true,
      createCheckoutOrder,
      createRedirectOrder,
      onOrderCreated,
    })

    expect(createCheckoutOrder).toHaveBeenCalledWith({
      variantId: 'mp_5000',
      legalConsent: { terms: true, privacy: true },
      heart: 'metalgym88',
    })
    expect(createRedirectOrder).not.toHaveBeenCalled()
    expect(onOrderCreated).toHaveBeenCalledWith('o-mp')
    expect(assign).toHaveBeenCalledWith('https://pay.example/mp-hosted')
    expect(result.navigated).toBe(true)
  })

  it('keeps USD on the existing PayPal order endpoint and redirect', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const createCheckoutOrder = vi.fn()
    const createRedirectOrder = vi.fn(async () => ({
      order: { order_id: 'o-paypal', redirect_url: 'https://pay.example/paypal' },
    }))

    const result = await startWalletPayment({
      currency: 'USD',
      variantId: 'pp_5',
      legalAccepted: true,
      createCheckoutOrder,
      createRedirectOrder,
    })

    expect(createCheckoutOrder).not.toHaveBeenCalled()
    expect(createRedirectOrder).toHaveBeenCalledWith(null, {
      currency: 'USD',
      variantId: 'pp_5',
      legalConsent: { terms: true, privacy: true },
    })
    expect(assign).toHaveBeenCalledWith('https://pay.example/paypal')
    expect(result.navigated).toBe(true)
  })

  it('does not create an order before legal consent is accepted', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const createCheckoutOrder = vi.fn()
    const createRedirectOrder = vi.fn()

    await expect(startWalletPayment({
      currency: 'CLP',
      variantId: 'mp_5000',
      legalAccepted: false,
      createCheckoutOrder,
      createRedirectOrder,
    })).rejects.toMatchObject({ code: 'LEGAL_CONSENT_REQUIRED' })

    expect(createCheckoutOrder).not.toHaveBeenCalled()
    expect(createRedirectOrder).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('does not mount a Mercado Pago or PayPal card form in the wallet', () => {
    expect(source).not.toMatch(/mp-card-|MercadoPago.*Brick|CardFields|loadMercadoPagoSdk|createCardOrder|iframe/i)
    expect(source).toContain('startWalletPayment')
    expect(source).toContain("['CLP', 'USD']")
    expect(source).toContain('walletPayButtonLabelKey(currency)')
  })
})
