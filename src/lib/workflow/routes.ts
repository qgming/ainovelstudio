export function buildWorkflowRoute(workflowId: string) {
  return `/workflows/${encodeURIComponent(workflowId)}`;
}
