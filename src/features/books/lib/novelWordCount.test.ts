import { describe, expect, it } from "vitest";
import { countNovelWords, formatNovelWordCount } from "./novelWordCount";

describe("novelWordCount", () => {
  it("按小说文章口径统计中文、英文单词和数字词", () => {
    expect(countNovelWords("你好，world 123！")).toBe(4);
  });

  it("不把空白和标点计入字数", () => {
    expect(countNovelWords("  ，。！？\n\t")).toBe(0);
  });

  it("格式化为中文字数标签", () => {
    expect(formatNovelWordCount(12345)).toBe("12,345 字");
  });
});
