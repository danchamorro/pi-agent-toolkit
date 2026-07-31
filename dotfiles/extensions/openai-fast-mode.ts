/**
 * OpenAI Fast Mode Extension
 *
 * Adds `/fast on|off|status` for subscription-backed OpenAI Codex models.
 * Fast mode starts disabled and sends `service_tier: "priority"` only for
 * documented GPT-5.4 through GPT-5.6 model families.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const supportsFastMode = (ctx: ExtensionContext) =>
  ctx.model?.provider === "openai-codex" &&
  /^gpt-5\.(?:4|5|6)(?:$|-)/.test(ctx.model.id);

export default function (pi: ExtensionAPI) {
  let enabled = false;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(
      "openai-fast-mode",
      enabled && supportsFastMode(ctx) ? "fast" : undefined,
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
        `Fast mode: ${enabled ? (available ? "on" : "unavailable for current model") : "off"}`,
        enabled && !available ? "warning" : "info",
      );
    },
  });
}
