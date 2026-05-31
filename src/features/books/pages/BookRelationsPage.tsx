import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import {
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { PageBackTitle } from "@shared/components/PageBackTitle";
import { PageShell } from "@shared/components/PageShell";
import { Button } from "@shared/ui/button";
import {
  getBookWorkspaceSummaryById,
  listBookRelations,
} from "@features/books/api/bookWorkspaceApi";
import { buildBookWorkspaceRoute } from "@features/books/lib/routes";
import { getBaseName } from "@features/books/lib/paths";
import type {
  BookWorkspaceSummary,
  WorkspaceRelation,
} from "@features/books/types";

// 按需注册:graph 图 + 必要组件 + canvas 渲染器。
echarts.use([
  GraphChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

// 按文件夹分类:用文件相对路径的第一段作为分类名,直观区分人物/势力/章节/设定。
function getCategoryName(rootPath: string, entryPath: string) {
  const rootPrefix = `${rootPath}/`;
  const relative = entryPath.startsWith(rootPrefix)
    ? entryPath.slice(rootPrefix.length)
    : entryPath;
  const firstSegment = relative.split("/")[0] ?? "";
  if (firstSegment.startsWith(".")) {
    return "项目";
  }
  return firstSegment || "其它";
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOption(
  rootPath: string,
  relations: WorkspaceRelation[],
  isDark: boolean,
): EChartsCoreOption {
  const pathSet = new Set<string>();
  for (const relation of relations) {
    pathSet.add(relation.entryAPath);
    pathSet.add(relation.entryBPath);
  }
  const paths = Array.from(pathSet).sort();

  // 度数 = 节点参与的关联数,作为 symbolSize 权重。
  const degreeByPath = new Map<string, number>();
  for (const relation of relations) {
    degreeByPath.set(
      relation.entryAPath,
      (degreeByPath.get(relation.entryAPath) ?? 0) + 1,
    );
    degreeByPath.set(
      relation.entryBPath,
      (degreeByPath.get(relation.entryBPath) ?? 0) + 1,
    );
  }

  const categoryNames = Array.from(
    new Set(paths.map((path) => getCategoryName(rootPath, path))),
  );
  const categories = categoryNames.map((name) => ({ name }));

  const nodes = paths.map((path) => {
    const degree = degreeByPath.get(path) ?? 1;
    const categoryName = getCategoryName(rootPath, path);
    return {
      id: path,
      name: getBaseName(path),
      // 官方 Les Mis 示例风格:节点直径与度数成正比,5~30 范围。
      symbolSize: Math.min(30, 6 + degree * 2.2),
      category: categoryNames.indexOf(categoryName),
      value: path,
    };
  });

  const links = relations.map((relation) => ({
    source: relation.entryAPath,
    target: relation.entryBPath,
    value: relation.relationship || "未标注",
    // 边标签默认不显示(与官方示例一致,避免视觉太满),hover 时由 emphasis 浮现。
    tooltipNote: relation.note ?? "",
  }));

  return {
    backgroundColor: "transparent",
    tooltip: {
      formatter: (params: unknown) => {
        const item = params as {
          dataType?: "node" | "edge";
          name: string;
          value?: string;
          data?: { tooltipNote?: string; value?: string };
        };
        if (item.dataType === "edge") {
          const note = item.data?.tooltipNote;
          return note ? `${item.name}<br/>${escapeHtml(note)}` : item.name;
        }
        const fullPath = item.value ?? item.data?.value ?? "";
        return `${item.name}<br/><span style="color:#94a3b8;font-size:11px">${escapeHtml(String(fullPath))}</span>`;
      },
    },
    legend: [
      {
        // 与 Les Mis 例子一致:legend 显示在顶部居中,以 category 名字作为筛选项。
        data: categoryNames,
        textStyle: { color: isDark ? "#cbd5e1" : "#475569", fontSize: 12 },
        top: 10,
        left: "center",
      },
    ],
    animationDuration: 1500,
    animationEasingUpdate: "quinticInOut",
    series: [
      {
        type: "graph",
        layout: "force",
        // 缩放/平移开启,但禁止用户连边(只读图谱)。
        roam: true,
        draggable: true,
        // 官方示例没开 focusNodeAdjacency,这里保留,因为对作者更友好。
        focusNodeAdjacency: true,
        // 官方 Les Mis force 参数:repulsion=100,gravity=0.02。
        // 这里 repulsion 略大,因为节点 label 在边上要更松散一点才不重叠。
        force: {
          repulsion: 100,
          edgeLength: [40, 120],
          gravity: 0.02,
          friction: 0.6,
          layoutAnimation: true,
        },
        label: {
          // 官方示例 position=right,小字号,根据 symbolSize 缩放(scale)。
          show: true,
          position: "right",
          fontSize: 12,
          color: isDark ? "#e2e8f0" : "#0f172a",
        },
        labelLayout: {
          hideOverlap: true,
        },
        scaleLimit: {
          min: 0.4,
          max: 2,
        },
        emphasis: {
          focus: "adjacency",
          lineStyle: { width: 4 },
          label: { show: true, fontWeight: "bold" },
        },
        // 边:source 着色,与官方示例一致(线条颜色随起点 category 着色)。
        lineStyle: {
          color: "source",
          curveness: 0.3,
          opacity: 0.7,
          width: 1,
        },
        categories,
        data: nodes,
        links,
      },
    ],
  };
}

type LoadStatus = "loading" | "ready" | "error";

// 自己用 echarts.init 渲染 — 跳过 echarts-for-react,避免其 size-sensor 依赖在 Vite/Tauri 环境下的兼容问题。
function EChartsCanvas({
  option,
  isDark,
}: {
  option: EChartsCoreOption;
  isDark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  // 初始化 + 销毁
  useEffect(() => {
    if (!containerRef.current) return;
    // theme 传 undefined 即可;暗色由 option 内 color 自行控制。
    const instance = echarts.init(containerRef.current, undefined, {
      renderer: "canvas",
    });
    chartRef.current = instance;

    const resize = () => instance.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  // option 变更时更新
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  // 主题切换时强制重画一次背景(option 中其它颜色已经随主题切换)
  useEffect(() => {
    chartRef.current?.resize();
  }, [isDark]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export function BookRelationsPage() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();
  const [summary, setSummary] = useState<BookWorkspaceSummary | null>(null);
  const [relations, setRelations] = useState<WorkspaceRelation[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(
    typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!bookId) {
      return;
    }
    void refresh(bookId);
  }, [bookId]);

  async function refresh(currentBookId: string) {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const nextSummary = await getBookWorkspaceSummaryById(currentBookId);
      const rawRelations = await listBookRelations(nextSummary.id);
      const rootPrefix = `${nextSummary.path}/`;
      const enriched: WorkspaceRelation[] = rawRelations.map((relation) => ({
        ...relation,
        entryAPath: relation.entryAPath
          ? `${rootPrefix}${relation.entryAPath}`
          : nextSummary.path,
        entryBPath: relation.entryBPath
          ? `${rootPrefix}${relation.entryBPath}`
          : nextSummary.path,
      }));
      setSummary(nextSummary);
      setRelations(enriched);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载关联图谱失败。");
      setStatus("error");
    }
  }

  const option = useMemo(
    () => buildOption(summary?.path ?? "", relations, isDark),
    [isDark, relations, summary?.path],
  );

  if (!bookId) {
    return <Navigate replace to="/" />;
  }

  const title = summary ? `关联图谱 · ${summary.name}` : "关联图谱";

  const hasGraph =
    relations.length > 0 && summary !== null && status === "ready";

  return (
    <PageShell
      title={
        <PageBackTitle
          backLabel="返回书架"
          onBack={() => navigate("/")}
          title={title}
        />
      }
      actions={[
        {
          icon: RefreshCw,
          label: status === "loading" ? "刷新中..." : "刷新",
          tone: "default",
          busy: status === "loading",
          onClick: () => void refresh(bookId),
        },
      ]}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {errorMessage ? (
          <div className="editor-callout mx-4 my-3" data-tone="error">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">
              {errorMessage}
            </pre>
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="editor-empty-state border-solid bg-panel">
            正在加载关联...
          </div>
        ) : !hasGraph ? (
          <div className="editor-empty-state min-h-[320px]">
            <div className="max-w-xl text-center">
              <h2 className="text-[22px] font-semibold tracking-[-0.04em] text-foreground">
                这本书还没有关联
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                进入工作区,在文件树点文件行的关联图标新建关联;或让 Agent 主动建立(标签如"出场人物""引用设定")。
              </p>
              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(buildBookWorkspaceRoute(bookId))}
                >
                  进入工作区
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden bg-panel">
            <EChartsCanvas option={option} isDark={isDark} />
          </div>
        )}
      </div>
    </PageShell>
  );
}
