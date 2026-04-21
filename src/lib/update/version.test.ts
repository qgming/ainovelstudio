import { describe, expect, it } from "vitest";
import { compareVersions, normalizeVersionLabel } from "./version";

describe("update version helpers", () => {
  it("支持比较带 v 前缀的版本号", () => {
    expect(compareVersions("v0.1.6", "0.1.5")).toBe(1);
    expect(compareVersions("0.1.5", "v0.1.5")).toBe(0);
    expect(compareVersions("0.1.4", "0.1.5")).toBe(-1);
  });

  it("会去掉版本号前缀", () => {
    expect(normalizeVersionLabel("v0.1.6")).toBe("0.1.6");
  });
});
