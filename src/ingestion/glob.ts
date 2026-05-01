export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesAny(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return patterns.some((pattern) => {
    const variants = pattern.startsWith("**/") ? [pattern, pattern.slice(3)] : [pattern];
    return variants.some((variant) => globToRegExp(variant).test(normalized));
  });
}
