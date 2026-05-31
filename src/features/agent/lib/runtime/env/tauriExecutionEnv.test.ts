import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReadTree,
  mockReadText,
  mockWriteText,
  mockEditText,
  mockCreateDir,
  mockDelete,
  mockRename,
} = vi.hoisted(() => ({
  mockReadTree: vi.fn(),
  mockReadText: vi.fn(),
  mockWriteText: vi.fn(),
  mockEditText: vi.fn(),
  mockCreateDir: vi.fn(),
  mockDelete: vi.fn(),
  mockRename: vi.fn(),
}));

vi.mock("@features/books/api/bookWorkspaceApi", () => ({
  readWorkspaceTree: mockReadTree,
  readWorkspaceTextFile: mockReadText,
  writeWorkspaceTextFile: mockWriteText,
  editWorkspaceTextFile: mockEditText,
  createWorkspaceDirectory: mockCreateDir,
  deleteWorkspaceEntry: mockDelete,
  renameWorkspaceEntry: mockRename,
}));

import { createTauriExecutionEnv } from "@features/agent/lib/runtime/env/tauriExecutionEnv";

const rootPath = "books/北境余烬";
// 解析用书籍标识（UUID）；env 内所有 bookWorkspaceApi 调用以此为第一参数。
const bookId = "book-uuid-001";

const tree = {
  kind: "directory",
  name: "北境余烬",
  path: rootPath,
  children: [
    {
      kind: "directory",
      name: "正文",
      path: `${rootPath}/正文`,
      children: [
        { kind: "file", name: "第001章.md", path: `${rootPath}/正文/第001章.md`, extension: ".md" },
      ],
    },
    {
      kind: "directory",
      name: "设定",
      path: `${rootPath}/设定`,
    },
  ],
};

function createEnv() {
  return createTauriExecutionEnv({ bookId, displayPath: rootPath });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadTree.mockResolvedValue(tree);
});

describe("TauriExecutionEnv", () => {
  it("cwd 绑定到书籍工作区根", () => {
    expect(createEnv().cwd).toBe(rootPath);
  });

  it("readTextFile 成功返回 ok", async () => {
    mockReadText.mockResolvedValue("第一章正文");
    const result = await createEnv().readTextFile("正文/第001章.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("第一章正文");
    }
    expect(mockReadText).toHaveBeenCalledWith(bookId, `${rootPath}/正文/第001章.md`);
  });

  it("readTextFile 文件不存在时返回 not_found 错误（不抛出）", async () => {
    mockReadText.mockRejectedValue(new Error("目标路径不存在。"));
    const result = await createEnv().readTextFile("缺失.md");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("readTextLines 按行切分并尊重 maxLines", async () => {
    mockReadText.mockResolvedValue("一\n二\n三");
    const result = await createEnv().readTextLines("正文/第001章.md", { maxLines: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["一", "二"]);
    }
  });

  it("writeFile 转发到 writeWorkspaceTextFile", async () => {
    mockWriteText.mockResolvedValue(undefined);
    const result = await createEnv().writeFile("正文/第002章.md", "内容");
    expect(result.ok).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith(bookId, `${rootPath}/正文/第002章.md`, "内容");
  });

  it("exists 通过目录树判断", async () => {
    const env = createEnv();
    const present = await env.exists("正文/第001章.md");
    const absent = await env.exists("正文/不存在.md");
    expect(present).toEqual({ ok: true, value: true });
    expect(absent).toEqual({ ok: true, value: false });
  });

  it("listDir 返回目录直接子项", async () => {
    const result = await createEnv().listDir("正文");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((info) => info.name)).toEqual(["第001章.md"]);
    }
  });

  it("listDir 对文件返回 not_directory", async () => {
    const result = await createEnv().listDir("正文/第001章.md");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_directory");
    }
  });

  it("createDir 拆解 parentPath/name 后转发", async () => {
    mockCreateDir.mockResolvedValue(`${rootPath}/设定/势力`);
    const result = await createEnv().createDir("设定/势力");
    expect(result.ok).toBe(true);
    expect(mockCreateDir).toHaveBeenCalledWith(bookId, `${rootPath}/设定`, "势力");
  });

  it("remove 转发到 deleteWorkspaceEntry", async () => {
    mockDelete.mockResolvedValue(undefined);
    const result = await createEnv().remove("正文/第001章.md");
    expect(result.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(bookId, `${rootPath}/正文/第001章.md`);
  });

  it("exec 始终返回不支持错误（不抛出）", async () => {
    const result = await createEnv().exec("ls -la");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("shell_unavailable");
    }
  });

  it("absolutePath 把相对路径解析到书根内", async () => {
    const result = await createEnv().absolutePath("正文/第001章.md");
    expect(result).toEqual({ ok: true, value: `${rootPath}/正文/第001章.md` });
  });

  it("createTempDir / createTempFile 返回 not_supported", async () => {
    const env = createEnv();
    expect((await env.createTempDir()).ok).toBe(false);
    expect((await env.createTempFile()).ok).toBe(false);
  });
});
