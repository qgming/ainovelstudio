export function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string, maxChars: number) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}
