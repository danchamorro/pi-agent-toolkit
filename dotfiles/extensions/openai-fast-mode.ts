/**
 * OpenAI Fast Mode Extension
 *
 * Adds `/fast on|off|status` for subscription-backed OpenAI Codex models.
 * Fast mode starts disabled and requests roughly 1.5x speed at 2.5x ChatGPT
 * credit usage for GPT-5.5/5.6, or 2x credit usage for GPT-5.4.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const FAST_MODE_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);

const supportsFastMode = (ctx: ExtensionContext) =>
  ctx.model?.provider === "openai-codex" && FAST_MODE_MODELS.has(ctx.model.id);

export default function (pi: ExtensionAPI) {
  let enabled = false;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(
      "openai-fast-mode",
      enabled && supportsFastMode(ctx) ? "fast requested" : undefined,
    );
  };

  pi.on("session_start", (_event, ctx) => updateStatus(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));

  pi.on("before_provider_request", (event, ctx) => {
    if (
      !enabled ||
      !supportsFastMode(ctx) ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      return;
    }

    return { ...event.payload, service_tier: "priority" };
  });

  pi.registerCommand("fast", {
    description: "Toggle OpenAI Codex Fast mode",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();

      if (action === "on") enabled = true;
      else if (action === "off") enabled = false;
      else if (action !== "" && action !== "status") {
        ctx.ui.notify("Usage: /fast [on|off|status]", "error");
        return;
      }

      updateStatus(ctx);
      const available = supportsFastMode(ctx);
      ctx.ui.notify(
        `Fast mode: ${enabled ? (available ? "requested" : "unavailable for current model") : "off"}`,
        enabled && !available ? "warning" : "info",
      );
    },
  });
}
