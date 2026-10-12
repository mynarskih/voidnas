export function chartSeries(values: (number | null)[], width = 320, height = 86) {
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => { if (current.length) segments.push(current.join(' ')); current = []; };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { flush(); return; }
    const x = values.length === 1 ? width : index / (values.length - 1) * width;
    current.push(`${x},${height - Math.max(0, Math.min(100, value)) / 100 * height}`);
  });
  flush();
  const last = values.at(-1);
  return { segments, latest: typeof last === 'number' && Number.isFinite(last) ? last : null };
}
