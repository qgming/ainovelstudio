import { describe, expect, it } from "vitest";
import { isTextEditableFile, validateEntryName } from "./paths";

describe("bookWorkspace paths", () => {
  it("将 json 识别为可编辑文本文件", () => {
    expect(isTextEditableFile("创作状态追踪器.json")).toBe(true);
  });

  it("保留 json 文件名的通用校验行为", () => {
    expect(validateEntryName("index.json")).toBeNull();
  });
});
