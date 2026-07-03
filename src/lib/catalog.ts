// Catalog constants — ported verbatim from the Relay prototype
// (PACKAGES / ADDONS / STAGES). Prices in whole dollars.
import type { PackageId, Stage } from './types'

export interface Package {
  id: PackageId
  name: string
  tier: string
  setup: number
  monthly: number
  popular?: boolean
  blurb: string
  features: string[]
}

export const PACKAGES: Package[] = [
  {
    id: 'one',
    name: 'One-Page',
    tier: 'Starter Brick',
    setup: 849,
    monthly: 150,
    blurb: 'A sharp single-page site that turns visitors into calls.',
    features: ['One high-converting page', 'Mobile-first design', 'Contact + click-to-call', 'Hosting & care included'],
  },
  {
    id: 'three',
    name: '3-Page Site',
    tier: 'Cornerstone',
    setup: 1499,
    monthly: 200,
    popular: true,
    blurb: 'Room to tell your story across a few focused pages.',
    features: ['Up to 3 pages', 'Custom sections per page', 'Lead form + integrations', 'Hosting & care included'],
  },
  {
    id: 'multi',
    name: 'Multi-Page',
    tier: 'Tower',
    setup: 1899,
    monthly: 200,
    blurb: 'A full site for businesses with more to show.',
    features: ['Multi-page architecture', 'Blog-ready', 'Advanced SEO structure', 'Hosting & care included'],
  },
]

export interface Addon {
  id: string
  name: string
  price: number
  monthly: number
}

export const ADDONS: Addon[] = [
  { id: 'social', name: 'Social media setup', price: 300, monthly: 0 },
  { id: 'gbp', name: 'Google Business Profile', price: 250, monthly: 0 },
  { id: 'blog', name: 'Monthly blog', price: 0, monthly: 150 },
  { id: 'logo', name: 'Logo & branding', price: 450, monthly: 0 },
  { id: 'reviews', name: 'Review generation', price: 200, monthly: 50 },
  { id: 'email', name: 'Email & domain', price: 150, monthly: 0 },
]

export interface StageDef {
  id: Stage
  name: string
  color: string
  prob: number
}

export const STAGES: StageDef[] = [
  { id: 'lead', name: 'Lead In', color: '#7A7A82', prob: 0.1 },
  { id: 'qualified', name: 'Qualified', color: '#2E9BD6', prob: 0.3 },
  { id: 'proposal', name: 'Preview Sent', color: '#7C5CFF', prob: 0.6 },
  { id: 'negotiation', name: 'Negotiation', color: '#E0932E', prob: 0.8 },
  { id: 'won', name: 'Won', color: '#3E9E6E', prob: 1 },
]

export const PACKAGE_COLOR: Record<PackageId, string> = {
  one: '#3E9E6E',
  three: '#5B4FE9',
  multi: '#E0932E',
}

export const pkg = (id: PackageId) => PACKAGES.find((p) => p.id === id)!
export const addon = (id: string) => ADDONS.find((a) => a.id === id)
export const stage = (id: Stage) => STAGES.find((s) => s.id === id)!
