import type { TreeNode } from "./types";

export function findNodeByPath(node: TreeNode | null, path: string): TreeNode | null {
  if (!node) {
    return null;
  }

  if (node.path === path) {
    return node;
  }

  for (const child of node.children ?? []) {
    const match = findNodeByPath(child, path);
    if (match) {
      return match;
    }
  }

  return null;
}

function collectAncestorPaths(node: TreeNode, targetPath: string, trail: string[] = []): string[] | null {
  if (node.path === targetPath) {
    return trail;
  }

  for (const child of node.children ?? []) {
    const nextTrail = child.kind === "directory" ? [...trail, child.path] : trail;
    const match = collectAncestorPaths(child, targetPath, nextTrail);
    if (match) {
      return match;
    }
  }

  return null;
}

export function buildExpandedPaths(rootNode: TreeNode, activeFilePath: string | null): string[] {
  const expanded = new Set<string>();
  for (const child of rootNode.children ?? []) {
    if (child.kind === "directory") {
      expanded.add(child.path);
    }
  }

  if (activeFilePath) {
    for (const path of collectAncestorPaths(rootNode, activeFilePath) ?? []) {
      expanded.add(path);
    }
  }

  return [...expanded];
}


export function collectAllDirectoryPaths(node: TreeNode | null): string[] {
  if (!node) {
    return [];
  }

  const paths: string[] = [];

  for (const child of node.children ?? []) {
    if (child.kind === "directory") {
      paths.push(child.path, ...collectAllDirectoryPaths(child));
    }
  }

  return paths;
}

export function replacePathPrefix(path: string | null, source: string, target: string): string | null {
  if (!path) {
    return null;
  }

  if (path === source) {
    return target;
  }

  return path.startsWith(`${source}/`) ? `${target}${path.slice(source.length)}` : path;
}

export function isSameOrDescendant(path: string | null, target: string): boolean {
  if (!path) {
    return false;
  }

  return path === target || path.startsWith(`${target}/`);
}
