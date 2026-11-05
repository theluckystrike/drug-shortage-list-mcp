// Pure core for drug-shortage-list-mcp. The only I/O is keyless reads of the openFDA drug shortages
// endpoint (api.fda.gov/drug/shortages.json, the FDA Drug Shortages database), done through an injected fetchText.
import type { FetchText } from './types.js';

export const REPO = 'drug-shortage-list-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const API = 'https://api.fda.gov/drug/shortages.json';
export const FDA_PAGE = 'https://dps.fda.gov/drugshortages';
export const DOCS_PAGE = 'https://open.fda.gov/apis/drug/drugshortages/';
export const DISCLAIMER = 'openFDA data are not validated for clinical use. Confirm with a pharmacist or the FDA Drug Shortages database before acting.';
export const MAX_LIMIT = 100;

export class InputError extends Error {}
export class UpstreamError extends Error {}

export const more = () => `${SITE}/servers/?${UTM}`;

// ---------------------------------------------------------------- inputs

export const STATUS: Record<string, string> = { current: 'Current', to_be_discontinued: 'To Be Discontinued', resolved: 'Resolved' };
export type StatusKey = 'current' | 'to_be_discontinued' | 'resolved' | 'all';

/** Lucene-safe phrase for openFDA: keep letters, digits, space, hyphen, period, slash. */
export function cleanTerm(s: string): string {
  const t = s.replace(/[^A-Za-z0-9 .\/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2) throw new InputError('Give a drug name of at least 2 letters, for example "amoxicillin", "Adderall" or "semaglutide".');
  return t;
}

/** "0641-6059-01", "0641-6059" or 10/11 digits without dashes -> dashed form as typed (openFDA stores dashed NDCs). */
export function cleanNdc(s: string): string {
  const t = s.trim();
  if (!/^\d{4,5}-\d{3,4}(-\d{1,2})?$/.test(t)) throw new InputError(`"${s}" is not an NDC in dashed form. Use for example 0641-6059-01 (package) or 0641-6059 (product), as printed on the label.`);
  return t;
}

const q = (s: string) => `"${s}"`;

export function searchUrl(drug: string, status: StatusKey = 'all', limit = MAX_LIMIT): string {
  const t = q(cleanTerm(drug));
  let s = `(generic_name:${t}+openfda.brand_name:${t}+openfda.generic_name:${t}+openfda.substance_name:${t})`;
  if (status !== 'all') s += `+AND+status:${q(STATUS[status])}`;
  return `${API}?search=${encodeURI(s)}&limit=${limit}`;
}

/** Every listing whose generic name is exactly one of the given names (used after a brand-name match). */
export function expandUrl(generics: string[], status: StatusKey = 'all'): string {
  let s = '(' + generics.map((g) => `generic_name.exact:${q(g.replace(/"/g, ''))}`).join('+') + ')';
  if (status !== 'all') s += `+AND+status:${q(STATUS[status])}`;
  return `${API}?search=${encodeURIComponent(s).replace(/%2B/g, '+')}&limit=${MAX_LIMIT}`;
}

export function ndcUrl(ndc: string): string {
  const t = q(cleanNdc(ndc));
  return `${API}?search=${encodeURI(`(package_ndc:${t}+openfda.package_ndc:${t}+openfda.product_ndc:${t})`)}&limit=${MAX_LIMIT}`;
}

export function recentUrl(status: StatusKey, category: string | undefined, limit: number): string {
  const parts: string[] = [];
  if (status !== 'all') parts.push(`status:${q(STATUS[status])}`);
  if (category) parts.push(`therapeutic_category:${q(cleanTerm(category))}`);
  const search = parts.length ? `search=${encodeURI(parts.join('+AND+'))}&` : '';
  return `${API}?${search}sort=update_date:desc&limit=${limit}`;
}

export const COUNT_FIELDS = { status: 'status', therapeutic_category: 'therapeutic_category', shortage_reason: 'shortage_reason.exact', drug: 'generic_name.exact' } as const;
export type CountBy = keyof typeof COUNT_FIELDS;

export function countUrl(by: CountBy, status: StatusKey): string {
  const search = status !== 'all' && by !== 'status' ? `search=${encodeURI(`status:${q(STATUS[status])}`)}&` : '';
  return `${API}?${search}count=${COUNT_FIELDS[by]}&limit=1000`;
}

// ---------------------------------------------------------------- parsing

/** "11/03/2026" -> "2026-11-03" */
export function isoDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** FDA free-text availability has typos ("Unvailable", "Limited Availalbility"); map to three values plus the raw text. */
export function normalizeAvailability(s: unknown): 'Available' | 'Limited Availability' | 'Unavailable' | 'Not stated' {
  if (typeof s !== 'string' || !s.trim()) return 'Not stated';
  const t = s.toLowerCase();
  if (t.startsWith('limited')) return 'Limited Availability';
  if (t.startsWith('un')) return 'Unavailable';
  if (t.startsWith('available')) return 'Available';
  return 'Not stated';
}

export function parseBody(body: string, notFound: string): { total: number; results: any[] } {
  let j: any;
  try { j = JSON.parse(body); } catch { throw new UpstreamError('openFDA returned a response that is not JSON'); }
  if (j?.error) {
    if (j.error.code === 'NOT_FOUND') return { total: 0, results: [] };
    throw new UpstreamError(`openFDA error ${j.error.code}: ${j.error.message}`);
  }
  if (!Array.isArray(j?.results)) throw new UpstreamError(notFound);
  return { total: Number(j.meta?.results?.total ?? j.results.length), results: j.results };
}

export interface Listing {
  presentation: string; package_ndc: string | null; company: string | null; status: string; availability: string; availability_text: string | null;
  shortage_reason: string | null; related_info: string | null; discontinued_date: string | null; resolved_note: string | null;
  initial_posting_date: string | null; update_date: string | null; update_type: string | null; contact: string | null;
}

export function toListing(r: any): Listing {
  return {
    presentation: r.presentation ?? r.generic_name ?? 'unknown',
    package_ndc: r.package_ndc ?? null,
    company: r.company_name ?? null,
    status: r.status ?? 'unknown',
    availability: normalizeAvailability(r.availability),
    availability_text: r.availability ?? null,
    shortage_reason: r.shortage_reason ?? null,
    related_info: r.related_info ?? null,
    discontinued_date: isoDate(r.discontinued_date),
    resolved_note: r.resolved_note ?? null,
    initial_posting_date: isoDate(r.initial_posting_date),
    update_date: isoDate(r.update_date),
    update_type: r.update_type ?? null,
    contact: r.contact_info ?? null,
  };
}

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((o, x) => { o[x] = (o[x] ?? 0) + 1; return o; }, {});
const latest = (xs: (string | null)[]) => xs.filter(Boolean).sort().at(-1) ?? null;

export interface Product {
  generic_name: string; brand_names: string[]; therapeutic_category: string[]; listings: number;
  by_status: Record<string, number>; by_availability: Record<string, number>; shortage_reasons: string[]; companies: string[];
  first_posted: string | null; last_updated: string | null; presentations: Listing[];
}

export function groupProducts(results: any[]): Product[] {
  const map = new Map<string, any[]>();
  for (const r of results) { const k = r.generic_name ?? 'unknown'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); }
  const out: Product[] = [];
  for (const [name, rs] of map) {
    const ls = rs.map(toListing).sort((a, b) => (b.update_date ?? '').localeCompare(a.update_date ?? ''));
    out.push({
      generic_name: name,
      brand_names: [...new Set(rs.flatMap((r) => r.openfda?.brand_name ?? []))].sort(),
      therapeutic_category: [...new Set(rs.flatMap((r) => r.therapeutic_category ?? []))].sort(),
      listings: rs.length,
      by_status: tally(ls.map((l) => l.status)),
      by_availability: tally(ls.map((l) => l.availability)),
      shortage_reasons: [...new Set(ls.map((l) => l.shortage_reason).filter(Boolean) as string[])],
      companies: [...new Set(ls.map((l) => l.company).filter(Boolean) as string[])].sort(),
      first_posted: ls.map((l) => l.initial_posting_date).filter(Boolean).sort()[0] ?? null,
      last_updated: latest(ls.map((l) => l.update_date)),
      presentations: ls,
    });
  }
  return out.sort((a, b) => (b.by_status.Current ?? 0) - (a.by_status.Current ?? 0) || b.listings - a.listings);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- tools

export async function searchDrugShortages(fetchText: FetchText, a: { drug: string; status?: StatusKey; max_presentations?: number }, nowMs = Date.now()) {
  const status = a.status ?? 'all';
  const url = searchUrl(a.drug, status);
  const first = parseBody(await fetchText(url, { cacheTtl: 3600 }), 'openFDA returned no results array');
  let { total, results } = first;
  const term = cleanTerm(a.drug);
  // A brand name (Adderall) only matches packages whose label carries that brand. Widen to every listing
  // of the matched generic products, so the answer covers the generic packages from all makers.
  const viaBrand = [...new Set(results.map((r) => r.generic_name as string).filter((g) => g && !g.toLowerCase().includes(term.toLowerCase())))].slice(0, 3);
  let widenedUrl: string | null = null;
  if (viaBrand.length) {
    widenedUrl = expandUrl(viaBrand, status);
    const wide = parseBody(await fetchText(widenedUrl, { cacheTtl: 3600 }), 'openFDA returned no results array');
    const key = (r: any) => `${r.package_ndc}|${r.company_name}|${r.presentation}`;
    const seen = new Set(results.map(key));
    for (const r of wide.results) if (!seen.has(key(r))) { seen.add(key(r)); results.push(r); }
    total = Math.max(results.length, wide.total);
  }
  const products = groupProducts(results);
  const cap = a.max_presentations ?? 10;
  const current = products.reduce((n, p) => n + (p.by_status.Current ?? 0), 0);
  let summary: string;
  if (!results.length) {
    summary = `The FDA Drug Shortages database has no ${status === 'all' ? '' : `${STATUS[status]} `}listing that matches "${term}". That means FDA does not list it as a shortage, not that every pharmacy has it in stock.`;
  } else {
    const lead = products[0];
    summary =
      `FDA lists ${plural(total, 'shortage listing')} matching "${term}" across ${plural(products.length, 'product')}, ${current} with status Current. ` +
      `${lead.generic_name}: ${Object.entries(lead.by_status).map(([k, v]) => `${v} ${k}`).join(', ')}; availability ${Object.entries(lead.by_availability).map(([k, v]) => `${v} ${k}`).join(', ')}` +
      `${lead.shortage_reasons.length ? `; reason ${lead.shortage_reasons.join(', ')}` : ''}; last updated ${lead.last_updated}.`;
  }
  return {
    summary,
    query: term,
    widened_to_generic: viaBrand.length ? viaBrand : null,
    status_filter: status,
    total_listings: total,
    listings_returned: results.length,
    current_listings: current,
    in_shortage_now: current > 0,
    products: products.map((p) => ({ ...p, presentations: p.presentations.slice(0, cap), presentations_omitted: Math.max(0, p.presentations.length - cap) })),
    note: 'Each listing is one package (NDC) from one company. FDA status Current means an active shortage; To Be Discontinued means the maker is stopping the product; Resolved means the shortage ended.',
    disclaimer: DISCLAIMER,
    as_of: new Date(nowMs).toISOString(),
    source: url,
    widened_source: widenedUrl,
    fda_page: FDA_PAGE,
    more: more(),
  };
}

export async function getDrugShortageByNdc(fetchText: FetchText, a: { ndc: string }, nowMs = Date.now()) {
  const ndc = cleanNdc(a.ndc);
  const url = ndcUrl(ndc);
  const { results } = parseBody(await fetchText(url, { cacheTtl: 3600 }), 'openFDA returned no results array');
  const listings = results.map(toListing).map((l) => ({ ...l, exact_match: l.package_ndc === ndc || (l.package_ndc ?? '').startsWith(ndc + '-') }));
  listings.sort((x, y) => Number(y.exact_match) - Number(x.exact_match));
  const hit = listings.find((l) => l.exact_match) ?? null;
  const summary = !listings.length
    ? `NDC ${ndc} is not in the FDA Drug Shortages database, so FDA does not list it as a shortage.`
    : hit
      ? `NDC ${ndc} (${hit.presentation}, ${hit.company}) is listed by FDA with status ${hit.status}, availability ${hit.availability}${hit.shortage_reason ? `, reason ${hit.shortage_reason}` : ''}, last updated ${hit.update_date}.${hit.resolved_note ? ` Resolved note: ${hit.resolved_note}.` : ''}`
      : `NDC ${ndc} has no listing of its own, but ${plural(listings.length, 'related package')} of the same product ${listings.length === 1 ? 'is' : 'are'} listed; the latest is ${listings[0].presentation} with status ${listings[0].status}.`;
  return {
    summary,
    ndc,
    listed: listings.length > 0,
    exact_listing: hit,
    related_listings: listings.filter((l) => l !== hit),
    disclaimer: DISCLAIMER,
    as_of: new Date(nowMs).toISOString(),
    source: url,
    fda_page: FDA_PAGE,
    more: more(),
  };
}

export async function listRecentDrugShortages(fetchText: FetchText, a: { status?: StatusKey; therapeutic_category?: string; limit?: number }, nowMs = Date.now()) {
  const status = a.status ?? 'current';
  const limit = a.limit ?? 25;
  const url = recentUrl(status, a.therapeutic_category, limit);
  const { total, results } = parseBody(await fetchText(url, { cacheTtl: 1800 }), 'openFDA returned no results array');
  const listings = results.map((r) => ({ generic_name: r.generic_name ?? 'unknown', therapeutic_category: r.therapeutic_category ?? [], ...toListing(r) }));
  const scope = `${status === 'all' ? '' : `${STATUS[status]} `}FDA drug shortage listings${a.therapeutic_category ? ` in ${cleanTerm(a.therapeutic_category)}` : ''}`;
  return {
    summary: listings.length
      ? `${total} ${scope}. The ${listings.length} most recently updated, newest first, start with ${listings[0].generic_name} (${listings[0].presentation}), updated ${listings[0].update_date}.`
      : `No ${scope} found.`,
    status_filter: status,
    therapeutic_category: a.therapeutic_category ?? null,
    total_listings: total,
    listings,
    disclaimer: DISCLAIMER,
    as_of: new Date(nowMs).toISOString(),
    source: url,
    fda_page: FDA_PAGE,
    more: more(),
  };
}

export async function countDrugShortages(fetchText: FetchText, a: { by?: CountBy; status?: StatusKey }, nowMs = Date.now()) {
  const by = a.by ?? 'therapeutic_category';
  const status = by === 'status' ? 'all' : (a.status ?? 'current');
  const url = countUrl(by, status);
  const { results } = parseBody(await fetchText(url, { cacheTtl: 3600 }), 'openFDA returned no count results');
  const rows = results.map((r: any) => ({ term: String(r.term), listings: Number(r.count) }));
  const totalListings = rows.reduce((n: number, r: any) => n + r.listings, 0);
  const scope = status === 'all' ? 'all FDA drug shortage listings' : `${STATUS[status]} FDA drug shortage listings`;
  const top = rows.slice(0, 5).map((r: any) => `${r.term} ${r.listings}`).join(', ');
  const summary = by === 'drug'
    ? `${rows.length} distinct products have ${scope.replace('FDA drug shortage listings', 'FDA shortage listings')} (${totalListings} package listings). Most listings: ${top}.`
    : by === 'therapeutic_category'
      ? `${scope} by therapeutic category (a listing can carry several categories): ${top}.`
      : `${scope} by ${by.replace('_', ' ')}: ${top}.`;
  return {
    summary,
    by,
    status_filter: status,
    rows,
    distinct_terms: rows.length,
    note: by === 'therapeutic_category' ? 'Category counts add up to more than the listing total because one listing can have several categories.' : null,
    disclaimer: DISCLAIMER,
    as_of: new Date(nowMs).toISOString(),
    source: url,
    fda_page: FDA_PAGE,
    more: more(),
  };
}
