import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createPiMcpPolicyConfig, resolveAllowedPath } from "./pi-mcp-policy.ts";
import { listFiles, readTextFile, searchText } from "./pi-mcp-tools.ts";

const bridge = {
	enabled: true,
	maxFileBytes: 64,
	maxReturnedChars: 20,
	maxSearchMatches: 2,
	maxListEntries: 2,
	toolTimeoutMs: 1_000,
	maxConcurrentCalls: 1,
};

async function fixture(): Promise<{ root: string; outside: string }> {
	const root = join(tmpdir(), `pi-mcp-policy-${Date.now()}-${Math.random()}`);
	const outside = join(tmpdir(), `pi-mcp-policy-outside-${Date.now()}-${Math.random()}`);
	await mkdir(root, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(root, "safe.txt"), "hello bridge\nsecond line");
	await writeFile(join(root, ".env"), "SECRET=value");
	await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
	await writeFile(join(root, "large.txt"), "x".repeat(128));
	await writeFile(join(outside, "outside.txt"), "outside");
	await symlink(join(outside, "outside.txt"), join(root, "escape.txt"));
	return { root, outside };
}

test("resolveAllowedPath denies outside absolute paths and symlink escapes", async () => {
	const paths = await fixture();
	const config = createPiMcpPolicyConfig(paths.root, bridge);
	assert.equal((await resolveAllowedPath(config, join(paths.outside, "outside.txt"))).allowed, false);
	const symlinkResult = await resolveAllowedPath(config, "escape.txt");
	assert.deepEqual(symlinkResult, { allowed: false, reason: "symlink_escape" });
});

test("readTextFile enforces secret, binary, size, and return limits", async () => {
	const paths = await fixture();
	const config = createPiMcpPolicyConfig(paths.root, bridge);
	assert.equal((await readTextFile(config, ".env")).metadata.reason, "secret_path");
	assert.equal((await readTextFile(config, "binary.bin")).metadata.reason, "binary");
	assert.equal((await readTextFile(config, "large.txt")).metadata.reason, "too_large");
	const safe = await readTextFile(config, "safe.txt");
	assert.equal(safe.ok, true);
	assert.equal(safe.content, "hello bridge\nsecond ");
	assert.equal(safe.metadata.truncated, true);
});

test("listFiles and searchText enforce result limits", async () => {
	const paths = await fixture();
	await writeFile(join(paths.root, "another.txt"), "hello bridge again");
	await writeFile(join(paths.root, "third.txt"), "hello bridge third");
	const config = createPiMcpPolicyConfig(paths.root, bridge);
	const list = await listFiles(config, ".");
	assert.equal(list.metadata.returned, 2);
	assert.equal(list.metadata.truncated, true);
	assert.equal(list.content.includes(".env"), false);
	const search = await searchText(config, ".", "hello");
	assert.equal(search.metadata.returned, 2);
	assert.equal(search.metadata.truncated, false);
});
