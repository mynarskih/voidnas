export function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) {
    if (last === null || last <= 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  const end = last === null ? size - 1 : Math.min(size - 1, last);
  if (first >= size || first > end) return null;
  return { start: first, end };
}
