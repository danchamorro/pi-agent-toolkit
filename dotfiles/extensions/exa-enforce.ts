/**
 * Exa Enforce Extension
 *
 * Blocks ad-hoc web fetching (curl, wget, python requests, axios, fetch, etc.)
 * and redirects the model to use the exa-search skill instead.
 */

import type { ExtensionAPI, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Patterns that indicate ad-hoc web fetching
  const fetchPatterns = [
    /\bcurl\s/i,
    /\bwget\s/i,
    /\bhttpie\b/i,
    /\bhttp\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\b/i,
    /\brequests\.(get|post|put|delete|patch|head)\b/i,
    /\burllib\.request/i,
    /\bimport\s+requests\b/i,
    /\bfrom\s+requests\s+import\b/i,
    /\baxios[\.(]/i,
    /\bnode-fetch\b/i,
    /\bfetch\s*\(\s*['"`]https?:/i,
    /\bgot\s*\(\s*['"`]https?:/i,
    /\bscraping\b.*\bimport\b|\bimport\b.*\b(scrapy|beautifulsoup|bs4|cheerio|puppeteer|playwright)\b/i,
    /\bSelenium\b/i,
    /\blynx\s+-dump/i,
    /\bpython3?\s+-c\b[^\n]*\burllib\b/i,
    /\bpython3?\s+-c\b[^\n]*\brequests\b/i,
  ];

  const BLOCK_REASON =
    "Direct web fetching is not allowed. Use the exa-search skill instead.\n\n" +
    "Load it with: /skill:exa-search\n\n" +
    "Exa supports: semantic search, find-similar, content extraction, answers, and structured research.";

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    // Check bash commands
    if (isToolCallEventType("bash", event)) {
      const cmd = String(event.input.command ?? "");
      const matched = fetchPatterns.some((p) => p.test(cmd));
      if (matched) {
        ctx.ui.notify("Blocked: use exa-search skill for web lookups", "error");
        return { block: true, reason: BLOCK_REASON };
      }
    }

    return undefined;
  });
}
