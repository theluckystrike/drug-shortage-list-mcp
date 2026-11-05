# drug-shortage-list-mcp

The FDA drug shortage list for AI assistants. Ask whether a drug is in shortage right now, by generic name, brand name or NDC, and get the live FDA status, availability and reason.

This is a Model Context Protocol (MCP) server. It reads the FDA Drug Shortages database through the openFDA API at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `search_drug_shortages` | FDA shortage listings for a generic name, brand name or active ingredient, grouped by product, with counts by status and availability, shortage reasons, companies, package presentations and dates. A brand name match is widened to every listing of the same generic product. |
| `get_drug_shortage_by_ndc` | FDA shortage status for one package NDC or product NDC, with related packages of the same product. |
| `list_recent_drug_shortages` | The FDA drug shortage list, most recently updated first, by status and therapeutic category. |
| `count_drug_shortages` | How many shortage listings there are now, by status, therapeutic category, shortage reason or distinct product. |

Every result has structured JSON, a one-paragraph summary, `as_of`, `source` (the exact openFDA request), the FDA database page and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=drug-shortage-list-mcp)).

## What it knows that your model does not

- Which drugs FDA lists as in shortage today. Shortages start and end every week, and openFDA refreshes the list daily.
- Package level detail. Each listing is one NDC from one company, with its own availability and update date.
- Whether a shortage was resolved or the product is being discontinued, with the date and the FDA note.

## Install

### Hosted (Claude.ai custom connector, ChatGPT developer mode)

Paste this URL. No token, no sign-up. It works now.

```
https://drug-shortage-list-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http drug-shortages https://drug-shortage-list-mcp.lipmichal.workers.dev/mcp
```

### Claude Desktop

Claude Desktop adds remote servers under Settings, Connectors, Add custom connector. Paste the URL above.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "drug-shortages": { "url": "https://drug-shortage-list-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "drug-shortages": { "type": "http", "url": "https://drug-shortage-list-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio (after npm release)

The npm package is not published yet. After it is, run it locally with Node 20 or newer:

```
claude mcp add drug-shortages -- npx -y drug-shortage-list-mcp
```

## Example prompts

- "Is Adderall still in shortage?"
- "Which oncology drugs are on the FDA shortage list right now?"
- "Is NDC 0641-6059-01 in shortage?"
- "How many drugs are in shortage in the US today?"
- "Was the clonazepam shortage resolved?"

## Data sources

Full list with fetch dates in [DATA_SOURCES.md](DATA_SOURCES.md).

- Shortage listings from the [openFDA drug shortages endpoint](https://open.fda.gov/apis/drug/drugshortages/), which publishes the [FDA Drug Shortages database](https://dps.fda.gov/drugshortages).

## Limitations

- FDA lists shortages it has confirmed. A drug can be hard to find at one pharmacy without being on the FDA list, and the answer says so.
- openFDA states that its data are not validated for clinical use. Check with a pharmacist before changing any medication.
- Without a key, openFDA allows 240 requests per minute and 1,000 per day per IP address. The tool returns a clear error when the limit is reached.
- A search returns at most 100 listings per call. Totals still come from the full database.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=drug-shortage-list-mcp).

Part of the Zovo MCP collection: https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

## License

MIT
