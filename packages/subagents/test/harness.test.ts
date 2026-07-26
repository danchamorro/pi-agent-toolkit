import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NATIVE_REASONING_EFFORTS, resolveHarnessEffort } from "../harness.ts";
import { StartSubagentParams } from "../schemas.ts";

const allEfforts = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

describe("StartSubagentParams", () => {
  it("exposes max reasoning effort in the public schema", () => {
    const schema = StartSubagentParams.properties.reasoning_effort as { enum?: string[] };
    assert.deepEqual(schema.enum, allEfforts);
  });
});

describe("resolveHarnessEffort", () => {
  it("keeps every Pi effort losslessly", () => {
    for (const effort of allEfforts) assert.equal(resolveHarnessEffort("pi", effort), effort);
  });

  it("accepts only the effort values exposed by both pinned native harnesses", () => {
    for (const harness of ["claude", "codex"] as const) {
      for (const effort of NATIVE_REASONING_EFFORTS) {
        assert.equal(resolveHarnessEffort(harness, effort), effort);
      }
      for (const effort of ["off", "minimal"] as const) {
        assert.throws(
          () => resolveHarnessEffort(harness, effort),
          new RegExp(`${harness}.*${effort}.*Supported values: low, medium, high, xhigh, max`, "u"),
        );
      }
    }
  });
});
