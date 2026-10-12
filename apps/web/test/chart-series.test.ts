import { describe, expect, it } from 'vitest';
import { chartSeries } from '../src/chart-series';
describe('real metric chart history', () => {
  it('does not display stale values as current when the monitor is unavailable', () => {
    expect(chartSeries([20, 30, null]).latest).toBe(null);
    expect(chartSeries([20, Number.NaN]).latest).toBe(null);
  });
  it('retains time spacing and gaps instead of joining across unavailable samples', () => {
    expect(chartSeries([0, null, 100], 100, 100).segments).toEqual(['0,100', '100,0']);
    expect(chartSeries([0, 50, 100], 100, 100).segments).toEqual(['0,100 50,50 100,0']);
  });
  it('handles empty and single-sample histories safely', () => {
    expect(chartSeries([]).segments).toEqual([]);
    expect(chartSeries([50], 100, 100).segments).toEqual(['100,50']);
  });
});
