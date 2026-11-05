// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, MAX_LIMIT, REPO, SITE, countDrugShortages, getDrugShortageByNdc, listRecentDrugShortages, searchDrugShortages } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const TOOL_INFO = [
  { name: 'search_drug_shortages', blurb: 'Is a drug in shortage right now? FDA Drug Shortages listings for a generic or brand name, grouped by product, with status, availability, reason, companies and last update.' },
  { name: 'get_drug_shortage_by_ndc', blurb: 'FDA shortage status for one NDC package or product code, as printed on the label.' },
  { name: 'list_recent_drug_shortages', blurb: 'The current FDA drug shortage list, most recently updated first, optionally for one therapeutic category such as Oncology or Pediatric.' },
  { name: 'count_drug_shortages', blurb: 'How many FDA drug shortage listings there are now, by status, therapeutic category, shortage reason or product.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream openFDA error'}: ${msg}` }] };
}

const status = z.enum(['current', 'to_be_discontinued', 'resolved', 'all']);

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Live US drug shortage status read at call time from the FDA Drug Shortages database through openFDA (api.fda.gov/drug/shortages.json), which FDA updates daily. ' +
      'Shortages start and end every week; never answer whether a drug is in shortage from memory. Use search_drug_shortages with a generic or brand name.',
  });

  server.registerTool('search_drug_shortages', {
    title: 'Search drug shortages',
    description:
      'Is a drug in shortage now? Searches the FDA Drug Shortages database (via openFDA, updated daily) by generic name, brand name or active ingredient, for example "amoxicillin", "Adderall", "semaglutide", "lidocaine". ' +
      'Returns listings grouped by product with counts by status (Current, To Be Discontinued, Resolved) and availability (Available, Limited, Unavailable), shortage reasons, companies, presentations and dates. Your training data cannot know today\'s shortage list.',
    inputSchema: {
      drug: z.string().min(2).max(80).describe('Generic name, brand name or active ingredient, for example "amphetamine", "Adderall", "cefazolin".'),
      status: status.optional().describe('current, to_be_discontinued, resolved or all. Default all.'),
      max_presentations: z.number().int().min(1).max(MAX_LIMIT).optional().describe('Package listings to show per product, 1 to 100. Default 10.'),
    },
    annotations: { title: 'Search drug shortages', ...RO },
  }, async (a) => {
    try { return ok(await searchDrugShortages(fetchText, a) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('get_drug_shortage_by_ndc', {
    title: 'Get drug shortage by NDC',
    description: 'FDA shortage status for one National Drug Code, either a package NDC (0641-6059-01) or a product NDC (0641-6059), in the dashed form printed on the label. Returns the exact listing and related packages of the same product.',
    inputSchema: { ndc: z.string().min(8).max(14).describe('Dashed NDC, for example "0641-6059-01" or "0641-6059".') },
    annotations: { title: 'Drug shortage by NDC', ...RO },
  }, async (a) => {
    try { return ok(await getDrugShortageByNdc(fetchText, a) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('list_recent_drug_shortages', {
    title: 'List recent drug shortages',
    description:
      'The FDA drug shortage list, most recently updated listings first. Defaults to status Current. Filter by therapeutic category, for example Anesthesia, Oncology, Pediatric, Psychiatry, Cardiovascular, Infectious Disease.',
    inputSchema: {
      status: status.optional().describe('current, to_be_discontinued, resolved or all. Default current.'),
      therapeutic_category: z.string().min(2).max(60).optional().describe('FDA therapeutic category, for example "Oncology".'),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('Listings to return, 1 to 100. Default 25.'),
    },
    annotations: { title: 'Recent drug shortages', ...RO },
  }, async (a) => {
    try { return ok(await listRecentDrugShortages(fetchText, a) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('count_drug_shortages', {
    title: 'Count drug shortages',
    description: 'How many FDA drug shortage listings there are now, grouped by status, therapeutic_category, shortage_reason or drug (distinct products). Defaults to Current listings by therapeutic category.',
    inputSchema: {
      by: z.enum(['status', 'therapeutic_category', 'shortage_reason', 'drug']).optional().describe('Grouping. Default therapeutic_category.'),
      status: status.optional().describe('Status to count within, ignored when by is status. Default current.'),
    },
    annotations: { title: 'Count drug shortages', ...RO },
  }, async (a) => {
    try { return ok(await countDrugShortages(fetchText, a) as any); } catch (e) { return fail(e); }
  });

  return server;
}
