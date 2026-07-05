// Invoice helpers — line generation from the package stack + numbering.
// Ported from the prototype's createInvoice / regenerateInvoiceLines.
import { pkg, addon } from './catalog'
import type { Deal } from './types'

export interface DraftLine {
  descr: string
  amount: number
  recurring: boolean
  custom: boolean
  sort: number
}

/** Build invoice lines from a deal's package + add-ons. */
export function linesForDeal(deal: Deal): DraftLine[] {
  const p = pkg(deal.package_id)
  const lines: DraftLine[] = []
  let sort = 0
  lines.push({ descr: `${p.name} website (${p.tier}) — setup`, amount: p.setup, recurring: false, custom: false, sort: sort++ })
  for (const id of deal.addons) {
    const a = addon(id)
    if (a && a.price > 0) lines.push({ descr: a.name, amount: a.price, recurring: false, custom: false, sort: sort++ })
  }
  lines.push({ descr: `${p.name} hosting & care plan`, amount: p.monthly, recurring: true, custom: false, sort: sort++ })
  for (const id of deal.addons) {
    const a = addon(id)
    if (a && a.monthly > 0) lines.push({ descr: `${a.name} (monthly)`, amount: a.monthly, recurring: true, custom: false, sort: sort++ })
  }
  return lines
}

/** INV-YYYY-NNNNN (last 5 digits of the unix seconds). */
export function invoiceNumber(): string {
  const now = new Date()
  const n = String(Math.floor(now.getTime() / 1000) % 100000).padStart(5, '0')
  return `INV-${now.getFullYear()}-${n}`
}
