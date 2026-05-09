function parseVersion(input: string) {
  const normalized = input.trim().replace(/^[^\d]*/, "");
  const [major = "0", minor = "0", patch = "0"] = normalized.split(/[.-]/);
  return [major, minor, patch].map((value) => Number.parseInt(value, 10) || 0);
}

export function normalizeVersionLabel(input: string) {
  return input.trim().replace(/^v/i, "");
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] === rightParts[index]) {
      continue;
    }
    return leftParts[index] > rightParts[index] ? 1 : -1;
  }

  return 0;
}
