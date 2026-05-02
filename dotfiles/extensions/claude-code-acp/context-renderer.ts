import type { Context } from "@mariozechner/pi-ai";

const HEADER = `You are being used through Pi's experimental claude-code-acp provider.

Milestone limitations:
- Respond with text only.
- Do not use tools, terminals, MCP servers, or file editing capabilities.
- If the user asks for a file change, describe the change or provide a patch in text for Pi to apply separately.`;

interface TypedBlock {
	type?: string;
	text?: string;
	thinking?: string;
	content?: unknown;
	result?: unknown;
	name?: string;
}

export function renderContextAsAcpPrompt(context: Context): string {
	const sections: string[] = [section("Pi ACP provider instructions", HEADER)];

	if (context.systemPrompt?.trim()) {
		sections.push(section("System prompt", context.systemPrompt.trim()));
	}

	for (const message of context.messages) {
		const role = typeof message.role === "string" ? message.role : "unknown";
		sections.push(section(`Message: ${role}`, renderMessageContent(message.content)));
	}

	return `${sections.join("\n\n")}\n`;
}

function section(title: string, body: string): string {
	return `## ${title}\n\n${body}`;
}

function renderMessageContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const rendered = content.map(renderContentBlock).filter((text) => text.trim().length > 0);
		return rendered.length > 0 ? rendered.join("\n\n") : "[empty content]";
	}

	return `[unsupported message content omitted: ${describeValue(content)}]`;
}

function renderContentBlock(block: unknown): string {
	if (!isRecord(block)) return `[unsupported content block omitted: ${describeValue(block)}]`;

	const typedBlock = block as TypedBlock;
	switch (typedBlock.type) {
		case "text":
			return typeof typedBlock.text === "string" ? typedBlock.text : "[text block without text omitted]";
		case "thinking":
			return "[assistant thinking omitted]";
		case "image":
			return "[image omitted: claude-code-acp milestone 1 supports text only]";
		case "toolCall":
			return `[assistant tool call omitted: ${typedBlock.name ?? "unknown tool"}]`;
		case "toolResult":
			return renderToolResult(typedBlock);
		default:
			return `[${typedBlock.type ?? "unknown"} content block omitted]`;
	}
}

function renderToolResult(block: TypedBlock): string {
	const content = block.content ?? block.result;
	if (typeof content === "string") return `[tool result]\n${content}`;
	if (Array.isArray(content)) {
		return `[tool result]\n${content.map(renderContentBlock).join("\n")}`;
	}
	return `[tool result omitted: ${describeValue(content)}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function describeValue(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
