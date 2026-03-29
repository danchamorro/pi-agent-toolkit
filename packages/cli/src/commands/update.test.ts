import { describe, it } from "node:test";
import assert from "node:assert/strict";

// compareSemver is not exported, so we inline a copy for testing.
// If the logic ever moves to a shared util, update this import.
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  });

  it("returns -1 when a is older (major)", () => {
    assert.equal(compareSemver("1.0.0", "2.0.0"), -1);
  });

  it("returns 1 when a is newer (major)", () => {
    assert.equal(compareSemver("2.0.0", "1.0.0"), 1);
  });

  it("compares minor versions", () => {
    assert.equal(compareSemver("1.1.0", "1.2.0"), -1);
    assert.equal(compareSemver("1.3.0", "1.2.0"), 1);
  });

  it("compares patch versions", () => {
    assert.equal(compareSemver("1.0.1", "1.0.2"), -1);
    assert.equal(compareSemver("1.0.3", "1.0.2"), 1);
  });

  it("handles mixed version differences", () => {
    assert.equal(compareSemver("0.3.1", "0.4.0"), -1);
    assert.equal(compareSemver("1.0.0", "0.9.9"), 1);
  });
});
