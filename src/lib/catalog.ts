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

// Suggestions only — the industry field stays free text, this just speeds up typing
// and keeps spelling consistent so "show me all the roofers" actually returns them all.
export const INDUSTRIES = [
  'HVAC', 'Roofing', 'Plumbing', 'Electrical', 'Landscaping / Lawn', 'Pest control',
  'Cleaning', 'Painting', 'Flooring', 'Remodeling / General contractor', 'Concrete / Paving',
  'Pressure washing', 'Tree service', 'Pool service', 'Garage doors', 'Fencing',
  'Auto repair', 'Towing', 'Moving / Storage', 'Real estate', 'Insurance', 'Legal',
  'Medical / Dental', 'Chiropractic', 'Salon / Barber', 'Spa / Massage', 'Fitness / Gym',
  'Restaurant / Food', 'Catering', 'Events / Photography', 'Retail / E-commerce',
  'Church / Nonprofit', 'Firearms / Outdoors', 'Other',
]

// Live search is always fenced to one state — see supabase/functions/lead-search.
export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
]

export const pkg = (id: PackageId) => PACKAGES.find((p) => p.id === id)!
export const addon = (id: string) => ADDONS.find((a) => a.id === id)
export const stage = (id: Stage) => STAGES.find((s) => s.id === id)!
