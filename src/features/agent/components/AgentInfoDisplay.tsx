type AgentInfoDisplayProps = {
  description: string;
  title: string;
};

export function AgentInfoDisplay({
  description,
  title,
}: AgentInfoDisplayProps) {
  return (
    <div
      aria-label={title}
      className="editor-panel-header min-h-0 justify-start bg-transparent px-3 py-2"
    >
      <div className="min-w-0 break-words text-xs leading-5 text-muted-foreground">
        {description}
      </div>
    </div>
  );
}
