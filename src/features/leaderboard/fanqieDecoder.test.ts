import { describe, expect, it } from "vitest";
import { decodeText } from "./fanqieDecoder";

describe("decodeText", () => {
  it("解码番茄字体映射字符", () => {
    expect(decodeText(String.fromCharCode(58657, 58666, 58475))).toBe("我不书");
  });

  it("保留普通字符", () => {
    expect(decodeText("番茄ABC")).toBe("番茄ABC");
  });

  it("空字符串返回空字符串", () => {
    expect(decodeText("")).toBe("");
  });
});
