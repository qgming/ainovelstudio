import { Type, type TSchema } from "@earendil-works/pi-ai";
import { normalizeTodoToolInput } from "../../builtin-tools/resourceHelpers";
import type { PiToolSpec } from "./types";

// 把旧 ai-sdk-tools/*Builders.ts 里的 zod inputSchema 全量改写为 TypeBox。
// 约定：
// - .optional() → Type.Optional；.default(x) → { default: x }；.describe(x) → { description: x }
// - z.number().int() → Type.Integer；.nonnegative() → minimum:0；.positive() → minimum:1；.max(n) → maximum:n
// - z.enum([...]) → Type.Union([Type.Literal(...)])；数值字面量同理
// - z.unknown() → Type.Unknown；z.string().url() → Type.String({ format:'uri' })
// 字段顺序与描述与原 zod 保持一致，确保 system prompt 渲染与模型行为不变。

// ============ write ============

const editInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("append"),
        Type.Literal("insert_after"),
        Type.Literal("insert_before"),
        Type.Literal("prepend"),
        Type.Literal("replace_anchor_range"),
        Type.Literal("replace_heading_range"),
        Type.Literal("replace_lines"),
        Type.Literal("replace"),
      ],
      {
        default: "replace",
        description:
          "编辑动作。replace=替换精确 target；append/prepend=文件末尾/开头追加；insert_before/insert_after=围绕 target 插入；replace_lines=按行号替换；replace_anchor_range=按锚点附近窗口替换；replace_heading_range=替换 Markdown 标题块。",
      },
    ),
  ),
  afterLines: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 200,
      description: "replace_anchor_range：anchor 行之后额外覆盖多少行；只填需要被替换的范围，避免过大。",
    }),
  ),
  anchor: Type.Optional(
    Type.String({ description: "replace_anchor_range 必填。文件中能唯一定位的原文锚点；优先选短而稳定的一整行。" }),
  ),
  beforeLines: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 200,
      description: "replace_anchor_range：anchor 行之前额外覆盖多少行；默认覆盖窗口较小。",
    }),
  ),
  caseSensitive: Type.Optional(
    Type.Boolean({ description: "replace_anchor_range：中文通常不填；英文标识符大小写重要时传 true。" }),
  ),
  content: Type.String({
    description: "要写入的新文本片段。replace/replace_lines/replace_* 是替换后的完整片段；append/prepend/insert_* 是新增片段。",
  }),
  endLine: Type.Optional(
    Type.Integer({ minimum: 1, description: "replace_lines：结束行号，包含该行；必须 >= startLine。" }),
  ),
  expectedCount: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "target 类动作：replaceAll=false 时预期 target 命中次数，默认 1；命中数不符会失败以防误改。",
    }),
  ),
  heading: Type.Optional(
    Type.String({
      description: "replace_heading_range 必填。Markdown 标题文本，可带或不带 #；替换该标题块直到下一个同级/更高标题前。",
    }),
  ),
  occurrence: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "replace_anchor_range / replace_heading_range：使用第几次命中，默认 1；同名标题/锚点多处出现时必须指定。",
    }),
  ),
  path: Type.String({ description: "目标文本文件的相对工作区路径，不要传绝对路径。修改前通常应已 read 过当前内容。" }),
  replaceAll: Type.Optional(
    Type.Boolean({ description: "replace：为 true 时替换所有 target；除非用户明确要求全局替换，否则保持 false。" }),
  ),
  startLine: Type.Optional(
    Type.Integer({ minimum: 1, description: "replace_lines：起始行号，从 1 开始；替换前先 read range 核对行号。" }),
  ),
  target: Type.Optional(
    Type.String({
      description: "replace / insert_before / insert_after 必填。必须是文件里的原文片段；不要填新文本或模糊描述。",
    }),
  ),
});

const writeInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("create"), Type.Literal("append"), Type.Literal("replace")], {
      default: "append",
      description: "写入方式。create=创建空白文本文件；append=追加到已有文件末尾；replace=覆盖已有文件全文。",
    }),
  ),
  content: Type.Optional(
    Type.String({ description: "要写入的文本内容。action=create 时不填；append/replace 时填写。长章节建议分多次 append。" }),
  ),
  path: Type.String({
    description:
      "必填。目标文件的相对工作区路径，不要传绝对路径，不要省略文件名；章节正文优先用 正文/第001章.md、正文/第012章.md 这类路径；大纲用 大纲/xxx.md，设定用 设定/xxx.md。",
  }),
});

export const WRITE_TOOL_SPECS: Record<string, PiToolSpec> = {
  workspace_write: {
    description:
      "创建空白文本文件或整文件追加、覆盖写入。create 创建空白文件；append 追加到末尾；replace 覆盖全文。改已有文件局部内容用 workspace_edit，JSON 文件用 workspace_json。",
    parameters: writeInputSchema,
  },
  workspace_edit: {
    description:
      "对已有文本文件做局部替换、插入或追加。改少量文字、插入片段、替换标题块或按行号替换时首选；按 action 提供 target / 行号 / anchor / heading。创建全新文件用 workspace_write。",
    parameters: editInputSchema,
  },
};

// ============ read ============

const fanqieLeaderboardInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("books"), Type.Literal("details"), Type.Literal("stats")], {
      default: "books",
      description: "查询动作。books=读取书单且不含简介；details=按 bookId/书名/排名单独读取简介；stats=读取数据统计指标。",
    }),
  ),
  board: Type.Optional(
    Type.Union(
      [Type.Literal("male-reading"), Type.Literal("male-new"), Type.Literal("female-reading"), Type.Literal("female-new")],
      {
        description:
          "四个主榜之一：male-reading=男频阅读榜，male-new=男频新书榜，female-reading=女频阅读榜，female-new=女频新书榜。不要传 fanqie-overall。",
      },
    ),
  ),
  gender: Type.Optional(
    Type.Union([Type.Literal(0), Type.Literal(1)], { description: "不传 board 时可用。0=女频，1=男频；board 已传时忽略。" }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal(1), Type.Literal(2)], { description: "不传 board 时可用。1=新书榜，2=阅读榜；board 已传时忽略。" }),
  ),
  categoryId: Type.Optional(
    Type.Integer({ description: "分类 ID；-1 表示该主榜总榜。已知 categoryId 时优先用它，高于 categoryName。" }),
  ),
  categoryName: Type.Optional(
    Type.String({ description: "分类名称，如 都市高武、快穿、总榜。未传默认该主榜总榜；不确定分类 ID 时用名称。" }),
  ),
  bookId: Type.Optional(Type.String({ description: "details 动作用：单本作品 ID 或详情 URL。" })),
  bookIds: Type.Optional(Type.Array(Type.String(), { description: "details 动作用：多本作品 ID 或详情 URL。" })),
  bookName: Type.Optional(Type.String({ description: "details 动作用：单本作品名。" })),
  bookNames: Type.Optional(Type.Array(Type.String(), { description: "details 动作用：多本作品名。" })),
  ranks: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description: "details 动作用：按排名读取多本作品简介。" })),
  rank: Type.Optional(
    Type.Integer({ minimum: 1, description: "查询单个具体排名，如第 3 名。books 返回该排名条目；details 返回该排名简介。" }),
  ),
  rankFrom: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "排名范围起点。不传 rank/rankFrom/rankTo/limit 时 books/stats 默认读取所选榜单或题材的全部可用作品。",
    }),
  ),
  rankTo: Type.Optional(
    Type.Integer({ minimum: 1, description: "排名范围终点。未传时使用 rankFrom + limit - 1。" }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 5000,
      description: "限制返回排名数量，最大 5000。不传时 books/stats 读取全部可用作品；单题材通常是该题材榜单可解析到的作品。",
    }),
  ),
  statsLimit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 30, description: "stats 动作返回多少个题材统计项，默认 10，最大 30。" }),
  ),
  forceRefresh: Type.Optional(
    Type.Boolean({ description: "是否绕过今日缓存强制刷新。默认 false；除非用户要求最新实时数据或怀疑缓存过期。" }),
  ),
});

const webSearchInputSchema: TSchema = Type.Object({
  domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "可选。限制结果优先来自这些站点域名，如 ['openai.com', 'platform.openai.com']；查官方规则时建议填写。",
    }),
  ),
  language: Type.Optional(Type.String({ description: "结果语言，默认 zh-CN；查英文资料可传 en。" })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 10, description: "最多返回多少条结果，默认 5，最大 10；需要快速定位时 3-5 足够。" }),
  ),
  query: Type.String({ minLength: 1, description: "搜索关键词或完整问题。包含实体名、平台名、时间范围会更准。" }),
  safesearch: Type.Optional(
    Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)], { description: "安全搜索等级：0 关闭，1 中等，2 严格。默认 1。" }),
  ),
});

const webFetchInputSchema: TSchema = Type.Object({
  afterBlocks: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 20, description: "anchor_range：anchor 块之后额外返回多少块。" }),
  ),
  anchor: Type.Optional(Type.String({ description: "anchor_range 必填。网页正文中的定位锚点；应来自已知页面文本。" })),
  beforeBlocks: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 20, description: "anchor_range：anchor 块之前额外返回多少块。" }),
  ),
  caseSensitive: Type.Optional(Type.Boolean({ description: "anchor_range：是否大小写敏感。" })),
  heading: Type.Optional(Type.String({ description: "heading_range 必填。要提取的标题文本，可带或不带 #。" })),
  includeLinks: Type.Optional(
    Type.Boolean({ description: "是否额外提取正文区域内的结构化链接列表；需要继续追链接时传 true。" }),
  ),
  includeTables: Type.Optional(
    Type.Boolean({ description: "是否额外提取正文区域内的结构化表格；页面含价格/榜单/参数表时传 true。" }),
  ),
  maxChars: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20000,
      description: "正文最大返回字符数，默认 8000；页面很长时先 full 小 maxChars，再 anchor/heading 精读。",
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("full"), Type.Literal("anchor_range"), Type.Literal("heading_range")], {
      default: "full",
      description: "full 返回整页正文；anchor_range 返回锚点附近块；heading_range 返回指定标题块。已有标题/锚点时优先定向读取。",
    }),
  ),
  occurrence: Type.Optional(
    Type.Integer({ minimum: 1, description: "anchor_range / heading_range：使用第几次命中，默认 1。" }),
  ),
  url: Type.String({ format: "uri", description: "要读取的完整网页地址，必须包含 http/https。" }),
});

const readInputSchema: TSchema = Type.Object({
  afterLines: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 200, description: "anchor_range：anchor 行之后额外返回多少行。" }),
  ),
  anchor: Type.Optional(Type.String({ description: "anchor_range 必填。文件中已有的定位锚点；优先选唯一短句或标题。" })),
  beforeLines: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 200, description: "anchor_range：anchor 行之前额外返回多少行。" }),
  ),
  caseSensitive: Type.Optional(Type.Boolean({ description: "anchor_range：英文标识符大小写重要时传 true。" })),
  endLine: Type.Optional(
    Type.Integer({ minimum: 1, description: "range：结束行号，包含该行；必须 >= startLine。" }),
  ),
  heading: Type.Optional(
    Type.String({ description: "heading_range 必填。Markdown 标题文本，可带或不带 #；读取该标题块直到下个同级/更高标题前。" }),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 400, description: "head/tail 返回的最大行数，默认 80；大文件先用 head/tail/range，避免 full。" }),
  ),
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("anchor_range"),
        Type.Literal("full"),
        Type.Literal("head"),
        Type.Literal("heading_range"),
        Type.Literal("range"),
        Type.Literal("tail"),
      ],
      {
        default: "full",
        description:
          "full 返回全文（超约 6000 字符会被截断且无法续读）；head/tail 返回头尾片段；range 返回行段；anchor_range 返回锚点附近；heading_range 返回 Markdown 标题块。大文件改用定向模式分段读，不要靠 full。",
      },
    ),
  ),
  occurrence: Type.Optional(
    Type.Integer({ minimum: 1, description: "anchor_range / heading_range：使用第几次命中，默认 1；同名标题多处出现时指定。" }),
  ),
  path: Type.String({ description: "目标文本文件的相对工作区路径，不要传绝对路径。" }),
  startLine: Type.Optional(Type.Integer({ minimum: 1, description: "range：起始行号，从 1 开始。" })),
});

const wordCountInputSchema: TSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "单文件模式：目标文本文件的相对工作区路径。path、paths、dir 三选一。" })),
  paths: Type.Optional(Type.Array(Type.String(), { description: "多文件模式：要批量统计的相对路径列表。path、paths、dir 三选一。" })),
  dir: Type.Optional(Type.String({ description: "目录模式：递归统计该目录下所有文本文件。path、paths、dir 三选一。" })),
  extensions: Type.Optional(
    Type.Array(Type.String(), {
      description: "目录模式可选：扩展名过滤（如 ['.md','.txt']）；缺省统计 md/markdown/txt/text/json。",
    }),
  ),
});

const grepInputSchema: TSchema = Type.Object({
  pattern: Type.String({
    minLength: 1,
    description: "要精确匹配的文本。isRegex=false 时按字面量子串匹配；isRegex=true 时按正则匹配。",
  }),
  isRegex: Type.Optional(
    Type.Boolean({ description: "是否按正则匹配，默认 false（字面量）。需要 ^$、字符类、量词等才传 true。" }),
  ),
  caseSensitive: Type.Optional(
    Type.Boolean({ description: "是否区分大小写，默认 false。中文通常不填；英文标识符大小写重要时传 true。" }),
  ),
  scope: Type.Optional(
    Type.Array(Type.String(), {
      description: "可选的相对路径范围列表（如 ['正文', '设定']）限定搜索；不传则搜全书。不要传绝对路径。",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 500,
      description: "最多返回多少条匹配行，默认 50，最大 500。命中超过会截断并标记 truncated。",
    }),
  ),
  contextLines: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 10,
      description: "每条命中额外返回的前后上下文行数，默认 0；定位锚点改写时可传 1-3。",
    }),
  ),
});

export const READ_TOOL_SPECS: Record<string, PiToolSpec> = {
  leaderboard: {
    description:
      "读取番茄小说四大主榜的书单、单本简介或题材统计。books 返回书名、作者、在读数、字数、状态、排行变化和详情链接但不含简介；details 按 bookId/书名/排名单独读取简介；stats 返回数据统计指标。",
    parameters: fanqieLeaderboardInputSchema,
  },
  web_search: {
    description:
      "搜索公开网络并返回标题、摘要与链接。需要最新或外部事实时使用；拿到链接后用 web_read 精读。查官方规则优先传 domains 限定站点。",
    parameters: webSearchInputSchema,
  },
  web_read: {
    description:
      "读取一个已知网址的网页正文。通常先 web_search 找链接，再 web_read；已知 URL 可直接用。页面很长时用 heading_range 或 anchor_range 精读。",
    parameters: webFetchInputSchema,
  },
  workspace_read: {
    description:
      "读取已知路径的工作区文本文件正文。未知路径先用 workspace_browse 或 workspace_search。full 整文件返回，超约 6000 字符会被截断且无法续读；大文件改用 head/tail/range/anchor_range/heading_range 分段读。",
    parameters: readInputSchema,
  },
  workspace_grep: {
    description:
      "按字面量或正则精确匹配文件内容，返回命中文件、行号与该行文本（可带前后上下文）。找某角色名/术语的全部出现、查错别字、定位改写锚点时用它；模糊语义检索相关设定/伏笔用 workspace_search。",
    parameters: grepInputSchema,
  },
  text_stats: {
    description:
      "统计文本文件的字数、中文字符与段落等指标。支持单文件（path）、多文件（paths 数组）或目录递归（dir）；批量返回每文件统计、总和与中位字符数。",
    parameters: wordCountInputSchema,
  },
};

// ============ data ============

const jsonPatchOpSchema = Type.Object({
  from: Type.Optional(Type.String({ description: "copy / move 时来源 JSON Pointer，例如 /chapters/0。" })),
  op: Type.Union(
    [Type.Literal("add"), Type.Literal("copy"), Type.Literal("move"), Type.Literal("remove"), Type.Literal("replace"), Type.Literal("test")],
    { description: "RFC 6902 风格的 patch 动作：add/copy/move/remove/replace/test。" },
  ),
  path: Type.String({ description: "patch 目标 JSON Pointer，例如 /stage 或 /chapters/0/title。" }),
  value: Type.Optional(Type.Unknown({ description: "add / replace / test 时使用的值；remove/copy/move 通常不填。" })),
});

const jsonBatchOpSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("append"),
      Type.Literal("delete"),
      Type.Literal("ensure_template"),
      Type.Literal("history_append"),
      Type.Literal("merge"),
      Type.Literal("set"),
      Type.Literal("text_append"),
    ],
    { description: "batch 中的单步动作；不支持 get/search/overview/create/patch。" },
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "batch 中 history_append 的历史数组保留上限。" })),
  pointer: Type.Optional(
    Type.String({ description: "batch 中该步操作的 JSON Pointer。空字符串表示根节点；路径不存在时 set/ensure_template 可创建中间对象。" }),
  ),
  separator: Type.Optional(
    Type.String({ description: "仅 batch 的 text_append 使用。追加文本前插入的分隔符，例如 '\\n'。" }),
  ),
  timestamp: Type.Optional(
    Type.String({ description: "batch 中 history_append 的写入时间；不填则工具生成当前时间。" }),
  ),
  timestampField: Type.Optional(
    Type.String({ description: "batch 中 history_append 的时间字段名，默认 updatedAt。" }),
  ),
  value: Type.Optional(
    Type.Unknown({
      description: "该步要写入的新值。set/merge/append/text_append/ensure_template/history_append 通常必填；delete 不填。",
    }),
  ),
});

const jsonInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("append"),
        Type.Literal("batch"),
        Type.Literal("create"),
        Type.Literal("delete"),
        Type.Literal("ensure_template"),
        Type.Literal("get"),
        Type.Literal("history_append"),
        Type.Literal("merge"),
        Type.Literal("overview"),
        Type.Literal("patch"),
        Type.Literal("search"),
        Type.Literal("set"),
        Type.Literal("text_append"),
      ],
      {
        default: "get",
        description:
          "JSON 动作。get 读指针值；overview 看结构骨架；search 搜 key/value；create 新建文件；set 覆盖指针值；merge 合并对象；append 追加数组；text_append 追加字符串；delete 删除节点；ensure_template 补默认结构；history_append 追加带时间历史；batch/patch 多步一次写回。维护 .project/status 时优先 batch / patch / ensure_template，不要整文件重写。",
      },
    ),
  ),
  patch: Type.Optional(
    Type.Array(jsonPatchOpSchema, {
      description: "patch：按顺序执行的 JSON Patch 操作；适合标准 add/remove/replace/copy/move/test。",
    }),
  ),
  operations: Type.Optional(
    Type.Array(jsonBatchOpSchema, {
      description: "batch：按顺序依次执行多个局部更新，一次读写文件；多字段更新优先用它。",
    }),
  ),
  caseSensitive: Type.Optional(Type.Boolean({ description: "search：是否区分大小写；中文通常不填。" })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, description: "history_append 的历史数组最大保留条数；search 的最大匹配数。" }),
  ),
  maxChars: Type.Optional(
    Type.Integer({ minimum: 1, description: "读取或写入后返回 value 的最大字符数，默认 4000；大对象可调小，避免结果过长。" }),
  ),
  maxDepth: Type.Optional(
    Type.Integer({ minimum: 0, description: "overview：结构概览递归深度，默认 2；越大返回越长。" }),
  ),
  maxEntries: Type.Optional(
    Type.Integer({ minimum: 1, description: "overview：最多返回多少个结构节点，默认 80。" }),
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "create：目标文件已存在时是否覆盖，默认 false；不确定时先 get/overview。" }),
  ),
  path: Type.String({ description: "目标 JSON 文件的相对工作区路径，不要传绝对路径。" }),
  pointer: Type.Optional(
    Type.String({ description: "JSON Pointer。空字符串或不填表示根节点；对象字段用 /field，数组下标用 /0，例如 /stage、/chapters/0/title。" }),
  ),
  query: Type.Optional(
    Type.String({ description: "search：要搜索的 key 或 value 文本；找字段名时 searchIn=key。" }),
  ),
  searchIn: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("key"), Type.Literal("value")], {
      description: "search：all 搜 key+value；key 只搜字段名；value 只搜值。",
    }),
  ),
  separator: Type.Optional(
    Type.String({ description: "text_append：追加文本前插入的分隔符，例如 '\\n' 或 '\\n\\n'。" }),
  ),
  timestamp: Type.Optional(
    Type.String({ description: "history_append：手动指定写入时间；不填则工具生成当前时间。" }),
  ),
  timestampField: Type.Optional(
    Type.String({ description: "history_append：记录时间字段名，默认 updatedAt。" }),
  ),
  value: Type.Optional(
    Type.Unknown({
      description: "写入的新值。set/merge/append/text_append/ensure_template/history_append/create 通常需要；delete/get/overview/search 不需要。",
    }),
  ),
});

const pathInputSchema: TSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("create_folder"), Type.Literal("move"), Type.Literal("rename"), Type.Literal("delete")],
    {
      description:
        "路径动作。create_folder 需要 parentPath+name；rename 需要 path+name；move 需要 path+targetParentPath；delete 删除 path 指向的文件或文件夹(高风险，通常仅用户明确要求时用)。",
    },
  ),
  name: Type.Optional(
    Type.String({ description: "create_folder/rename 使用的新名称，只写文件夹名或文件名，不要带父路径。" }),
  ),
  parentPath: Type.Optional(
    Type.String({ description: "create_folder 使用的父目录相对路径；根目录可传空字符串或不填。" }),
  ),
  path: Type.Optional(Type.String({ description: "rename/move/delete 使用的现有目标相对路径。" })),
  targetParentPath: Type.Optional(Type.String({ description: "仅 move 使用。移动到的目标父目录相对路径。" })),
});

const skillReadInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("list"), Type.Literal("read")], {
      default: "list",
      description: "技能动作。list 列出技能；read 读 SKILL.md 或 references/templates 文件。",
    }),
  ),
  relativePath: Type.Optional(
    Type.String({ description: "action=read 时技能内相对路径，如 SKILL.md、references/voice.md、templates/prompt.md。" }),
  ),
  skillId: Type.Optional(Type.String({ description: "read 动作通常都需要 skillId；先 list 获取准确 id。" })),
});

const skillManageInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [Type.Literal("create"), Type.Literal("create_reference"), Type.Literal("delete"), Type.Literal("write")],
      { default: "create", description: "技能动作。create 新建技能；create_reference 新建参考文件；write 写回技能文件；delete 删除技能。" },
    ),
  ),
  content: Type.Optional(
    Type.String({ description: "action=write 时要写入技能文件的完整新内容。写 SKILL.md 时必须保留合法 frontmatter。" }),
  ),
  description: Type.Optional(
    Type.String({ description: "action=create 时的新 skill 简介，会写入 SKILL.md 头部 description。" }),
  ),
  name: Type.Optional(
    Type.String({ description: "action=create 时是新 skill 名称/id；action=create_reference 时是新参考文件名，不必带 .md。" }),
  ),
  relativePath: Type.Optional(
    Type.String({ description: "action=read/write 时技能内相对路径，如 SKILL.md、references/voice.md、templates/prompt.md。" }),
  ),
  skillId: Type.Optional(Type.String({ description: "管理动作通常都需要 skillId；先 list 获取准确 id。" })),
});

const relationInputSchema: TSchema = Type.Object({
  action: Type.Optional(
    Type.Union(
      [Type.Literal("list"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")],
      {
        default: "list",
        description:
          "关联动作。list=列出某文件全部关联(需 path)；create=在两文件间建关联(需 pathA/pathB/relationship)；update=改关系标签或备注(需 relationId)；delete=删一条关联边(需 relationId)。",
      },
    ),
  ),
  path: Type.Optional(
    Type.String({ description: "仅 action=list 使用。要查看关联的工作区文件相对路径,不要传绝对路径。" }),
  ),
  pathA: Type.Optional(Type.String({ description: "仅 action=create 使用。第一个文件的相对路径。" })),
  pathB: Type.Optional(
    Type.String({ description: "仅 action=create 使用。第二个文件的相对路径。两者不能是同一文件,且必须已存在。" }),
  ),
  relationship: Type.Optional(
    Type.String({
      description:
        'create 必填、update 可选的关系标签,自定义字符串(如"出场人物"、"涉及势力"、"引用设定"、"前置剧情")。update 不填则保持原标签。',
    }),
  ),
  note: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description:
        'create/update 的一行可选备注(如"本章主角")。update 传 null 表示清空备注,不填则保持原备注。',
    }),
  ),
  relationId: Type.Optional(
    Type.String({ description: "update/delete 必填。要操作的关联 ID,通过 action=list 获取。" }),
  ),
});

export const DATA_TOOL_SPECS: Record<string, PiToolSpec> = {
  workspace_json: {
    description:
      "读写 JSON 文件的首选工具，支持局部字段更新与批量 patch。读取先 overview/search/get；改字段用 set/merge/append/text_append/delete；多字段更新优先 batch；补状态模板用 ensure_template；追加事件流用 history_append。不要用 workspace_write 直接覆写 JSON。",
    parameters: jsonInputSchema,
  },
  workspace_path: {
    description:
      "只创建、重命名、移动或删除路径结构，不写文件内容。create_folder/rename/move/delete 路径用它（delete 走 action=delete，高风险）。写文本内容用 workspace_edit / workspace_write，写 JSON 用 workspace_json。",
    parameters: pathInputSchema,
  },
  skill_read: {
    description:
      "列出本地技能或读取技能的 SKILL 与参考文件。任务命中技能时先 list/read SKILL.md 获取完整规则；需要参考材料时再读 references。",
    parameters: skillReadInputSchema,
  },
  skill_manage: {
    description:
      "创建、写回或删除本地技能文件。用户要求创建或修改技能时用 create/create_reference/write/delete 落盘。write 写的是技能文件完整内容，不是补丁片段。",
    parameters: skillManageInputSchema,
  },
  workspace_relation: {
    description:
      "管理工作区文件之间的无向多对多关联边。list 列出某文件全部关联（返回 id/对端路径/关系标签/备注）；create 在两文件间建关联（同一对文件可有多条不同 relationship）；update 改标签或备注；delete 删一条边（不影响文件）。改 relationId 前先 list 取 id。",
    parameters: relationInputSchema,
  },
};

// ============ interaction ============

const todoItemSchema = Type.Object({
  activeForm: Type.Optional(
    Type.String({ description: "当步骤处于 in_progress 时的进行时描述，例如“正在读取大纲”。可不填。" }),
  ),
  content: Type.String({ minLength: 1, description: "这一步要做什么；写成可验证的小动作，不要写空泛目标。" }),
  status: Type.Optional(
    Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")], {
      default: "pending",
      description: "步骤状态。当前正在做的步骤最多一个 in_progress；已完成用 completed；未开始用 pending。",
    }),
  ),
  phase: Type.Optional(
    Type.String({
      description: "可选：所属阶段标签。建议网文链路使用 plot / bible / outline / chapter / write / review / polish 等短词。",
    }),
  ),
});

const askInputSchema: TSchema = Type.Object({
  title: Type.String({ minLength: 1, description: "问题标题，用一句话说明需要用户决定什么。" }),
  description: Type.Optional(Type.String({ description: "可选的问题说明。解释为什么必须问，不要写长篇背景。" })),
  selectionMode: Type.Optional(
    Type.Union([Type.Literal("single"), Type.Literal("multiple")], {
      default: "single",
      description: "single 为单选，multiple 为多选。默认 single；只有多个选项可同时成立时用 multiple。",
    }),
  ),
  options: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, description: "选项唯一标识，使用稳定短 id，如 keep-style。" }),
      label: Type.String({ minLength: 1, description: "选项显示名称，短而清楚。" }),
      description: Type.Optional(Type.String({ description: "选项补充说明，说明影响或取舍。" })),
    }),
    { minItems: 1, description: "预设选项列表，2-4 个最合适；不要包含“用户输入”，系统会自动追加。" },
  ),
  customPlaceholder: Type.Optional(Type.String({ description: "选择“用户输入”后输入框的占位提示。" })),
  minSelections: Type.Optional(Type.Integer({ minimum: 1, description: "仅 multiple 使用。多选时最少需要选择多少项。" })),
  maxSelections: Type.Optional(Type.Integer({ minimum: 1, description: "仅 multiple 使用。多选时最多允许选择多少项。" })),
  confirmLabel: Type.Optional(Type.String({ description: "确认按钮文案；通常不填。" })),
});

const todoObjectInputSchema: TSchema = Type.Object({
  items: Type.Array(todoItemSchema, {
    description: "当前整份计划数组。每次传完整计划，保持最多一个 in_progress；简单任务可不用 todo。",
  }),
});

const yoloControlInputSchema: TSchema = Type.Object({
  action: Type.Union([Type.Literal("complete"), Type.Literal("continue"), Type.Literal("blocked")], {
    description: "YOLO 检查动作。complete=目标完成；continue=还需继续下一轮；blocked=需要用户授权或补充信息。",
  }),
  evidence: Type.Optional(
    Type.Array(Type.String(), { default: [], description: "完成证据。complete 时至少 1 条，写具体文件、工具结果或落地事项。" }),
  ),
  goal: Type.String({ minLength: 1, description: "当前 YOLO 总目标，必须复述用户目标。" }),
  nextAction: Type.Optional(Type.String({ description: "continue 时必填，写下一轮最重要动作。" })),
  reason: Type.String({ minLength: 1, description: "本次检查结论的原因。" }),
  remaining: Type.Optional(
    Type.Array(Type.String(), { default: [], description: "continue 时必填，列出剩余任务；complete 时必须为空。" }),
  ),
  requiredUserAction: Type.Optional(Type.String({ description: "blocked 时必填，说明需要用户做什么。" })),
  stateUpdated: Type.Optional(
    Type.Boolean({ default: false, description: "成果涉及项目状态时是否已维护状态文件；complete 时必须为 true。" }),
  ),
  verification: Type.Optional(
    Type.Array(Type.String(), { default: [], description: "验证结果。complete 时至少 1 条，写已读取/统计/搜索核对的结果。" }),
  ),
});

const browseInputSchema: TSchema = Type.Object({
  depth: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 8, description: "仅 mode=tree 使用。限制返回的树深度，默认 2；项目很大时保持 1-3。" }),
  ),
  extensions: Type.Optional(
    Type.Array(Type.String(), { description: "仅 mode=list 使用。按文件扩展名过滤，如 ['md', '.json']；不确定扩展名则不填。" }),
  ),
  kind: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("directory"), Type.Literal("file")], {
      default: "all",
      description: "仅 mode=list 使用。筛选目录、文件或全部。",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 200, description: "仅 mode=list 使用。限制返回的子项数量，默认由工具决定；目录很大时传 50-100。" }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("list"), Type.Literal("stat"), Type.Literal("tree")], {
      default: "list",
      description: "list 列出目录直接子项；stat 查看路径是否存在、类型和大小；tree 返回裁剪后的目录树。未知结构先 list 或 tree。",
    }),
  ),
  path: Type.Optional(
    Type.String({ description: "要浏览的相对工作区路径；不传时默认为工作区根目录。不要传绝对路径。" }),
  ),
  sortBy: Type.Optional(
    Type.Union([Type.Literal("name"), Type.Literal("type")], {
      default: "name",
      description: "仅 mode=list 使用。name 按名称排序，type 先目录后文件。",
    }),
  ),
});

const searchInputSchema: TSchema = Type.Object({
  includeAdjacent: Type.Optional(
    Type.Boolean({
      default: true,
      description: "是否允许检索器优先返回可继续向前后扩展阅读的上下文片段。默认 true。",
    }),
  ),
  intent: Type.Optional(
    Type.Union(
      [
        Type.Literal("auto"),
        Type.Literal("fact"),
        Type.Literal("character"),
        Type.Literal("plot"),
        Type.Literal("chapter"),
        Type.Literal("path"),
        Type.Literal("status"),
        Type.Literal("conflict"),
      ],
      {
        default: "auto",
        description: "检索意图。找人物设定用 character/fact，找当前状态用 status，找章节正文用 chapter，找路径用 path；不确定时 auto。",
      },
    ),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 30, description: "最多返回多少段上下文，默认 8。Agent 检索通常 5-12 足够。" }),
  ),
  path: Type.Optional(
    Type.String({ description: "兼容单路径 scope；限定在某个相对目录或文件下检索。新调用优先使用 scope。" }),
  ),
  query: Type.String({
    description: "检索关键词或短问题。优先传角色名、地点、伏笔、章节名、字段名或 2-6 个关键词；不要传整段正文。",
  }),
  scope: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "可选的相对路径范围列表，如 ['.project/status', '设定', '大纲']。找事实源时优先限定 ['.project/status','设定','大纲','正文']；不要传绝对路径。",
    }),
  ),
  tokenBudget: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 12000, description: "本次检索结果可用的上下文预算，默认 4000。复杂问题可传 6000-10000。" }),
  ),
});

export const INTERACTION_TOOL_SPECS: Record<string, PiToolSpec> = {
  ask_user: {
    description:
      "向用户提出单选或多选问题并等待选择。只有需求模糊且不同选择会显著影响结果时使用；可自行判断、可先读文件确认、或用户已给明确目标时不要问。工具会自动补“用户输入”。",
    parameters: askInputSchema,
  },
  update_plan: {
    description:
      "更新当前会话的多步计划清单。≥3 步或长链路任务使用；每次传完整 items，并保持最多一个 in_progress。简单单步任务不要为了形式调用。",
    parameters: todoObjectInputSchema,
    // 复刻旧 zod z.preprocess(normalizeTodoToolInput)：在 schema 校验前归一化非规范 todo 形态。
    prepareArguments: (args) => normalizeTodoToolInput(args),
  },
  yolo_control: {
    description:
      "YOLO 模式每轮结束时上报 complete/continue/blocked。每轮结束必须调用一次；不要用自然语言代替这三种结论。",
    parameters: yoloControlInputSchema,
  },
  workspace_browse: {
    description:
      "浏览工作区目录结构、列目录或查路径状态，不读正文。未知路径或需要了解目录时使用；已知关键词用 workspace_search，已知准确文件用 workspace_read。",
    parameters: browseInputSchema,
  },
  workspace_search: {
    description:
      "语义检索工作区事实源与正文证据，按相关度返回上下文片段。未知路径、缺人物/设定/伏笔/章节/状态证据、需要定位 JSON 字段或编辑锚点时优先使用；要精确字面量/正则匹配（找某名字全部出现、查错别字）用 workspace_grep；编辑前用 workspace_read 精读最高置信路径。",
    parameters: searchInputSchema,
  },
};

// 所有工具规格的汇总（供 prompt 渲染与 buildPiTools 取 description/parameters）。
export const ALL_TOOL_SPECS: Record<string, PiToolSpec> = {
  ...INTERACTION_TOOL_SPECS,
  ...READ_TOOL_SPECS,
  ...WRITE_TOOL_SPECS,
  ...DATA_TOOL_SPECS,
};
