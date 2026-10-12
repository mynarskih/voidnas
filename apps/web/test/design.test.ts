import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const rule=(selector:string)=>css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' \\{([^}]+)\\}'))?.[1]??'';
describe('DESIGN3 visual contracts',()=>{
  it('keeps the black canvas, graphite hairlines and restrained violet tokens',()=>{
    const root=rule(':root');
    expect(root).toContain('--bg: #000000'); expect(root).toContain('--surface: #000000');
    expect(root).toContain('--line: #292d30'); expect(root).toContain('--violet: #9281f7');
    expect(root).toContain('--r: 6px'); expect(root).toContain('--card: 16px');
  });
  it('uses outlined primary actions, not filled accent buttons',()=>{
    expect(rule('.button.strong')).toContain('background: transparent');
    expect(rule('.danger-button')).toContain('background: transparent');
    expect(css).not.toMatch(/(?:linear|radial)-gradient|box-shadow\s*:/);
  });
  it('preserves light mode, monochrome fonts and reduced motion',()=>{
    expect(rule(":root[data-theme='light']")).toContain('--surface: #ffffff');
    expect(rule('.mono, code')).toContain('var(--font-mono)');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('animation: none !important');
  });
  it('keeps file actions above the table and within the viewport',()=>{
    expect(rule('.file-menu')).toContain('position: fixed');
    expect(rule('.file-menu')).toContain('max-height: calc(100dvh - 24px)');
    const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
    expect(app).toContain('return createPortal(');
    expect(app).toContain('focus({preventScroll:true})');
    const modal=readFileSync(new URL('../src/Modal.tsx',import.meta.url),'utf8');
    expect(modal).toContain('if(previous?.isConnected)previous.focus');
  });
});
