import { LoaderCircle } from "lucide-react";

type BookWorkspaceLoadingStateProps = {
  description?: string;
  title?: string;
};

export function BookWorkspaceLoadingState({
  description = "已检测到上次打开的书籍，正在恢复书籍结构和编辑内容。",
  title = "正在恢复书籍工作区...",
}: BookWorkspaceLoadingStateProps) {
  return (
    <section className="flex h-full min-h-0 items-center justify-center overflow-auto px-10 py-12">
      <div className="max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center text-[#0b84e7] dark:text-[#7cc4ff]">
          <LoaderCircle className="h-7 w-7 animate-spin" />
        </div>
        <h1 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.05em] text-[#111827] dark:text-[#f3f4f6]">
          {title}
        </h1>
        <p className="mx-auto mt-4 text-base leading-7 text-[#6b7280] dark:text-[#9aa4b2]">
          {description}
        </p>
      </div>
    </section>
  );
}
