// Fixtures: openFDA drug shortage payloads saved 2026-11-05 (meta.last_updated 2026-11-05). Expected values were
// tallied from the saved payloads with jq (see DATA_SOURCES.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  cleanTerm, cleanNdc, searchUrl, ndcUrl, recentUrl, countUrl, isoDate, normalizeAvailability, parseBody, groupProducts,
  searchDrugShortages, getDrugShortageByNdc, listRecentDrugShortages, countDrugShortages, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const fake = (over = {}) => async (url) => {
  const u = decodeURIComponent(url);
  for (const [k, v] of Object.entries(over)) if (u.includes(k)) { if (v instanceof Error) throw v; return v; }
  if (u.includes('generic_name:"amphetamine"')) return fx('search-amphetamine.json');
  if (u.includes('generic_name:"Adderall"')) return fx('search-adderall.json');
  if (u.includes('generic_name.exact:"Amphetamine Aspartate Monohydrate')) return fx('search-amphetamine.json');
  if (u.includes('generic_name:"clonazepam"')) return fx('search-clonazepam.json');
  if (u.includes('package_ndc:"59651-723-01"')) return fx('ndc-59651-723-01.json');
  if (u.includes('package_ndc:"59651-723-77"')) return fx('ndc-59651-723-01.json');
  if (u.includes('count=status')) return fx('count-status.json');
  if (u.includes('count=therapeutic_category')) return fx('count-category-current.json');
  if (u.includes('count=shortage_reason.exact')) return fx('count-reason-current.json');
  if (u.includes('count=generic_name.exact')) return fx('count-generic-current.json');
  if (u.includes('sort=update_date:desc')) return fx('recent-current.json');
  if (u.includes('search=')) return fx('search-notfound.json');
  throw new Error('unexpected url ' + url);
};

test('inputs: drug names cleaned, NDC forms checked', () => {
  assert.equal(cleanTerm('  Adderall XR!! '), 'Adderall XR');
  assert.throws(() => cleanTerm('*'), InputError);
  assert.equal(cleanNdc('0641-6059-01'), '0641-6059-01'); assert.equal(cleanNdc('0641-6059'), '0641-6059');
  assert.throws(() => cleanNdc('064160590'), InputError); assert.throws(() => cleanNdc('abc'), InputError);
});
test('URLs: OR across name fields, AND status, sort and count fields', () => {
  const s = decodeURI(searchUrl('amphetamine', 'current'));
  assert.ok(s.startsWith('https://api.fda.gov/drug/shortages.json?search=(generic_name:"amphetamine"+openfda.brand_name:"amphetamine"+openfda.generic_name:"amphetamine"+openfda.substance_name:"amphetamine")+AND+status:"Current"&limit=100'));
  assert.ok(decodeURI(ndcUrl('0641-6059-01')).includes('package_ndc:"0641-6059-01"+openfda.package_ndc:"0641-6059-01"'));
  assert.ok(decodeURI(recentUrl('current', 'Oncology', 5)).endsWith('search=status:"Current"+AND+therapeutic_category:"Oncology"&sort=update_date:desc&limit=5'));
  assert.equal(countUrl('status', 'current'), 'https://api.fda.gov/drug/shortages.json?count=status&limit=1000');
  assert.ok(countUrl('shortage_reason', 'current').includes('count=shortage_reason.exact'));
});
test('dates and FDA availability typos', () => {
  assert.equal(isoDate('11/03/2026'), '2026-11-03'); assert.equal(isoDate('2026-11-03'), null); assert.equal(isoDate(undefined), null);
  assert.equal(normalizeAvailability('Unvailable'), 'Unavailable'); assert.equal(normalizeAvailability('Limited Availalbility'), 'Limited Availability');
  assert.equal(normalizeAvailability('Limited Supply Available. Next Delivery and Estimated Recovery: June 2027'), 'Limited Availability');
  assert.equal(normalizeAvailability('Available'), 'Available'); assert.equal(normalizeAvailability(null), 'Not stated');
});
test('parseBody: NOT_FOUND is zero results, other errors and HTML throw', () => {
  assert.deepEqual(parseBody(fx('search-notfound.json'), 'x'), { total: 0, results: [] });
  assert.throws(() => parseBody('{"error":{"code":"SERVER_ERROR","message":"boom"}}', 'x'), UpstreamError);
  assert.throws(() => parseBody('<html>', 'x'), UpstreamError);
});
test('group amphetamine: 73 listings, one product, all Current, 44 available 10 limited 19 unavailable', () => {
  const { total, results } = parseBody(fx('search-amphetamine.json'), 'x');
  assert.equal(total, 73);
  const p = groupProducts(results);
  assert.equal(p.length, 1); assert.equal(p[0].listings, 73);
  assert.deepEqual(p[0].by_status, { Current: 73 });
  assert.deepEqual(p[0].by_availability, { Available: 44, 'Limited Availability': 10, Unavailable: 19 });
});
test('search_drug_shortages amphetamine: in shortage now, capped presentations, links', async () => {
  const r = await searchDrugShortages(fake(), { drug: 'amphetamine', max_presentations: 5 });
  assert.equal(r.in_shortage_now, true); assert.equal(r.current_listings, 73); assert.equal(r.total_listings, 73);
  assert.equal(r.products[0].presentations.length, 5); assert.equal(r.products[0].presentations_omitted, 68);
  assert.ok(r.more.includes(UTM)); assert.ok(r.source.startsWith('https://api.fda.gov/drug/shortages.json?search='));
  assert.match(r.summary, /73 shortage listings matching "amphetamine" across 1 product, 73 with status Current/);
});
test('search_drug_shortages Adderall: 7 brand-labelled listings widened to all 73 generic listings', async () => {
  const r = await searchDrugShortages(fake(), { drug: 'Adderall' });
  assert.equal(r.total_listings, 73); assert.equal(r.current_listings, 73); assert.equal(r.products.length, 1);
  assert.equal(r.widened_to_generic.length, 1); assert.ok(decodeURIComponent(r.widened_source).includes('generic_name.exact:"Amphetamine Aspartate Monohydrate, Amphetamine Sulfate'));
});
test('search_drug_shortages clonazepam: 40 listings, all Resolved, not in shortage now', async () => {
  const r = await searchDrugShortages(fake(), { drug: 'clonazepam' });
  assert.equal(r.total_listings, 40); assert.equal(r.in_shortage_now, false); assert.deepEqual(r.products[0].by_status, { Resolved: 40 });
});
test('search_drug_shortages unknown drug: clear not listed answer', async () => {
  const r = await searchDrugShortages(fake(), { drug: 'zzqx' });
  assert.equal(r.total_listings, 0); assert.equal(r.in_shortage_now, false); assert.match(r.summary, /no listing that matches "zzqx"/);
});
test('get_drug_shortage_by_ndc 59651-723-01: exact Resolved listing plus 5 related packages', async () => {
  const r = await getDrugShortageByNdc(fake(), { ndc: '59651-723-01' });
  assert.equal(r.listed, true); assert.equal(r.exact_listing.package_ndc, '59651-723-01'); assert.equal(r.exact_listing.status, 'Resolved');
  assert.equal(r.related_listings.length, 5); assert.equal(r.exact_listing.update_date, '2026-11-04');
});
test('get_drug_shortage_by_ndc: product NDC prefix counts as exact', async () => {
  const r = await getDrugShortageByNdc(fake({ 'package_ndc:"59651-723"': fx('ndc-59651-723-01.json') }), { ndc: '59651-723' });
  assert.equal(r.exact_listing.package_ndc, '59651-723-01');
});
test('get_drug_shortage_by_ndc: no exact match reports related packages', async () => {
  const r = await getDrugShortageByNdc(fake(), { ndc: '59651-723-77' });
  assert.equal(r.exact_listing, null); assert.equal(r.related_listings.length, 6); assert.match(r.summary, /no listing of its own/);
});
test('list_recent_drug_shortages: 1113 Current, newest first, dates ISO', async () => {
  const r = await listRecentDrugShortages(fake(), { limit: 10 });
  assert.equal(r.total_listings, 1113); assert.equal(r.listings.length, 10);
  const d = r.listings.map((l) => l.update_date); assert.deepEqual(d, [...d].sort().reverse());
});
test('count_drug_shortages: status totals 1113/425/59; 68 distinct current products summing to 1113', async () => {
  const s = await countDrugShortages(fake(), { by: 'status' });
  assert.deepEqual(s.rows, [{ term: 'Current', listings: 1113 }, { term: 'To Be Discontinued', listings: 425 }, { term: 'Resolved', listings: 59 }]);
  const g = await countDrugShortages(fake(), { by: 'drug' });
  assert.equal(g.distinct_terms, 68); assert.equal(g.rows.reduce((n, r) => n + r.listings, 0), 1113);
  const reason = await countDrugShortages(fake(), { by: 'shortage_reason' });
  assert.deepEqual(reason.rows[1], { term: 'Demand increase for the drug', listings: 125 });
});
test('upstream failure surfaces as an error, not a guess', async () => {
  await assert.rejects(searchDrugShortages(fake({ 'generic_name:"lidocaine"': new Error('HTTP 503') }), { drug: 'lidocaine' }), /HTTP 503/);
});
test('stdio: initialize and tools/list over JSON-RPC', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'drug-shortage-list-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  assert.deepEqual((await got(2)).result.tools.map((t) => t.name), ['search_drug_shortages', 'get_drug_shortage_by_ndc', 'list_recent_drug_shortages', 'count_drug_shortages']);
  send({ id: 3, method: 'tools/call', params: { name: 'get_drug_shortage_by_ndc', arguments: { ndc: 'bad' } } });
  assert.equal((await got(3)).result.isError, true);
  child.kill();
});
