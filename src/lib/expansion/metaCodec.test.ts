import { describe, expect, it } from "vitest";
import {
  buildChapterEntryLabel,
  buildChapterTargetLabel,
  buildSettingMetaContent,
  buildVolumeMetaContent,
  formatVolumeLabel,
  getChapterVolumeId,
  getNextVolumeId,
  getProjectEntryLabel,
  getReadableError,
  getSettingCategory,
  getSettingEntryId,
  getSettingFallbackName,
  normalizeNumericId,
  normalizeVolumeId,
  parseChapterMeta,
  parseSettingMeta,
  sanitizeChapterJson,
  sanitizeSettingJson,
  sortSettingCategories,
  toChineseNumber,
} from "./metaCodec";

describe("metaCodec - id 与卷号", () => {
  it("normalizeNumericId 仅保留数字", () => {
    expect(normalizeNumericId("abc123def")).toBe("123");
    expect(normalizeNumericId("")).toBe("");
  });

  it("normalizeVolumeId 三位补零，非数字返回空串", () => {
    expect(normalizeVolumeId("1")).toBe("001");
    expect(normalizeVolumeId("042")).toBe("042");
    expect(normalizeVolumeId("abc")).toBe("");
  });

  it("getNextVolumeId 取最大值 + 1", () => {
    expect(getNextVolumeId([])).toBe("001");
    expect(getNextVolumeId(["001", "003"])).toBe("004");
  });

  it("formatVolumeLabel 转中文", () => {
    expect(formatVolumeLabel("001")).toBe("第一卷");
    expect(formatVolumeLabel("012")).toBe("第十二卷");
    expect(formatVolumeLabel("020")).toBe("第二十卷");
    expect(formatVolumeLabel("xx")).toBe("xx卷");
  });

  it("toChineseNumber 边界", () => {
    expect(toChineseNumber(1)).toBe("一");
    expect(toChineseNumber(10)).toBe("十");
    expect(toChineseNumber(11)).toBe("十一");
    expect(toChineseNumber(101)).toBe("一百零一");
  });
});

describe("metaCodec - 章节路径解析", () => {
  it("getChapterVolumeId 从路径推断卷号；无 / 默认 001", () => {
    expect(getChapterVolumeId("003/第十章")).toBe("003");
    expect(getChapterVolumeId("第一章")).toBe("001");
  });

  it("buildChapterTargetLabel 含 id 时拼接 '第 X 章'", () => {
    expect(
      buildChapterTargetLabel({ id: "5", name: "雨夜", outline: "", content: "" }, null),
    ).toBe("第 5 章 · 雨夜");
    expect(buildChapterTargetLabel(null, null)).toBe("未命名章节");
    expect(
      buildChapterTargetLabel({ id: "", name: "", outline: "", content: "" }, "回退名"),
    ).toBe("回退名");
  });

  it("buildChapterEntryLabel 与 id/名称组合", () => {
    expect(buildChapterEntryLabel("3", "决战")).toBe("第 3 章 · 决战");
    expect(buildChapterEntryLabel(null, "")).toBe("未命名章节");
  });
});

describe("metaCodec - 设定路径解析", () => {
  it("getSettingCategory 分隔出分类，缺省 '其他'", () => {
    expect(getSettingCategory("人物/1-主角")).toBe("人物");
    expect(getSettingCategory("xxx")).toBe("其他");
  });

  it("getSettingEntryId 取基名首段", () => {
    expect(getSettingEntryId("人物/12-主角")).toBe("12");
  });

  it("getSettingFallbackName 取基名后段", () => {
    expect(getSettingFallbackName("人物/12-主角")).toBe("主角");
    expect(getSettingFallbackName("人物/baseonly")).toBe("baseonly");
  });
});

describe("metaCodec - JSON 清理", () => {
  it("sanitizeSettingJson 标准化 id 与 name", () => {
    expect(
      sanitizeSettingJson({ id: "abc12", name: "  主角  ", content: "x" }),
    ).toEqual({ id: "12", name: "主角", content: "x" });
  });

  it("sanitizeChapterJson 同理", () => {
    expect(
      sanitizeChapterJson({
        id: "f3",
        name: "  雨 ",
        outline: "o",
        content: "c",
      }),
    ).toEqual({ id: "3", name: "雨", outline: "o", content: "c" });
  });
});

describe("metaCodec - meta 文件读写", () => {
  it("parseChapterMeta 解析 volumes 数组并标准化", () => {
    expect(parseChapterMeta(JSON.stringify({ volumes: ["1", "12", "abc"] }))).toEqual([
      "001",
      "012",
    ]);
    expect(parseChapterMeta("not json")).toEqual([]);
  });

  it("parseSettingMeta 解析 categories 数组", () => {
    expect(parseSettingMeta(JSON.stringify({ categories: ["人物", "  ", "势力"] }))).toEqual(
      ["人物", "势力"],
    );
    expect(parseSettingMeta("{}")).toEqual([]);
  });

  it("buildVolumeMetaContent 去重 + 排序", () => {
    const out = buildVolumeMetaContent(["003", "1", "001"]);
    expect(JSON.parse(out)).toEqual({ volumes: ["001", "003"] });
  });

  it("buildSettingMetaContent 合并默认分类并排序", () => {
    const out = buildSettingMetaContent(["势力"]);
    const parsed = JSON.parse(out) as { categories: string[] };
    // 默认分类按内置顺序优先
    expect(parsed.categories.slice(0, 6)).toEqual([
      "人物",
      "势力",
      "地点",
      "世界观",
      "道具",
      "其他",
    ]);
  });

  it("sortSettingCategories 默认分类优先；其余按 zh-Hans 排序", () => {
    expect(sortSettingCategories(["世界观", "未知A", "人物"])).toEqual([
      "人物",
      "世界观",
      "未知A",
    ]);
  });
});

describe("metaCodec - 杂项", () => {
  it("getProjectEntryLabel 识别常见名称", () => {
    expect(getProjectEntryLabel("AGENTS.md")).toBe("代理规则 · AGENTS.md");
    expect(getProjectEntryLabel("outline.md")).toBe("故事大纲 · outline.md");
    expect(getProjectEntryLabel("其他.md")).toBe("其他.md");
  });

  it("getReadableError 兼容 Error 与字符串", () => {
    expect(getReadableError(new Error("boom"))).toBe("boom");
    expect(getReadableError("custom")).toBe("操作失败，请重试。");
  });
});
