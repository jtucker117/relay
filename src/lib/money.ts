// Money math — ported verbatim from the Relay prototype (pkgTotals, invoiceTotals,
// pipeline aggregates). Keep these formulas identical to the prototype.
import { PACKAGES, ADDONS, STAGES } from './catalog'
import type { Deal, Invoice, InvoiceLine, PackageId } from './types'

export interface DealTotals {
  setup: number
  monthly: number
  acv: number // first-year value = setup + monthly * 12
}

/** setup = pkg.setup + Σ addon.price ; monthly = pkg.monthly + Σ addon.monthly ; acv = setup + monthly*12 */
export function pkgTotals(packageId: PackageId, addonIds: string[]): DealTotals {
  const p = PACKAGES.find((x) => x.id === packageId)!
  let setup = p.setup
  let monthly = p.monthly
  for (const id of addonIds) {
    const a = ADDONS.find((x) => x.id === id)
    if (a) {
      setup += a.price
      monthly += a.monthly
    }
  }
  return { setup, monthly, acv: setup + monthly * 12 }
}

export const dealTotals = (d: Deal) => pkgTotals(d.package_id, d.addons)

/** Open pipeline = Σ acv of non-won deals. */
export function pipelineTotal(deals: Deal[]): number {
  return deals.filter((d) => d.stage !== 'won').reduce((s, d) => s + dealTotals(d).acv, 0)
}

/** Weighted forecast = Σ(acv × stage.prob), EXCLUDING won (won is realized, not forecast). */
export function weightedPipeline(deals: Deal[]): number {
  return deals.reduce((s, d) => {
    if (d.stage === 'won') return s
    const prob = STAGES.find((x) => x.id === d.stage)?.prob ?? 0
    return s + dealTotals(d).acv * prob
  }, 0)
}

export const wonMrr = (deals: Deal[]) =>
  deals.filter((d) => d.stage === 'won').reduce((s, d) => s + dealTotals(d).monthly, 0)

export const wonSetup = (deals: Deal[]) =>
  deals.filter((d) => d.stage === 'won').reduce((s, d) => s + dealTotals(d).setup, 0)

export function winRate(deals: Deal[]): number {
  if (deals.length === 0) return 0
  const won = deals.filter((d) => d.stage === 'won').length
  return Math.round((won / deals.length) * 100)
}

export interface InvoiceTotals {
  setup: number
  monthly: number
  tax: number
  total: number
  deposit: number
  balance: number
}

/** Tax applies to SETUP ONLY (not recurring). total = setup + tax. */
export function invoiceTotals(inv: Pick<Invoice, 'tax_pct' | 'deposit_pct'>, lines: InvoiceLine[]): InvoiceTotals {
  const setup = lines.filter((l) => !l.recurring).reduce((s, l) => s + Number(l.amount), 0)
  const monthly = lines.filter((l) => l.recurring).reduce((s, l) => s + Number(l.amount), 0)
  const tax = Math.round((setup * Number(inv.tax_pct)) / 100)
  const total = setup + tax
  const deposit = Math.round((total * Number(inv.deposit_pct)) / 100)
  return { setup, monthly, tax, total, deposit, balance: total - deposit }
}

export const money = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US')
