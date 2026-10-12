import {describe,it,expect,vi} from 'vitest';
import {installPageMotion,REVEAL_SELECTOR} from '../src/page-motion';
function fixture(reduced=false){
  const listeners=new Set<()=>void>(),frames:FrameRequestCallback[]=[];
  const preference={matches:reduced,addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)};
  const animation={finished:new Promise(()=>{}),cancel:vi.fn()};
  const element={isConnected:true,matches:()=>true,querySelectorAll:()=>[],animate:vi.fn(()=>animation)} as unknown as Element;
  const root={matches:()=>false,querySelectorAll:()=>[element]} as unknown as Element;
  let visible:(entries:{isIntersecting:boolean;target:Element}[])=>void=()=>{},mutated:(records:{addedNodes:Node[]}[])=>void=()=>{};
  const observe=vi.fn(),unobserve=vi.fn(),disconnect=vi.fn(),mutationDisconnect=vi.fn();
  class Intersection{constructor(fn:typeof visible){visible=fn}observe=observe;unobserve=unobserve;disconnect=disconnect}
  class Mutation{constructor(fn:typeof mutated){mutated=fn}observe=vi.fn();disconnect=mutationDisconnect}
  const environment={matchMedia:()=>preference,IntersectionObserver:Intersection,MutationObserver:Mutation,requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length},cancelAnimationFrame:vi.fn()} as unknown as Window & typeof globalThis;
  return {root,environment,preference,listeners,element,animation,observe,unobserve,disconnect,mutationDisconnect,frames,reveal:()=>visible([{isIntersecting:true,target:element}]),mutate:(element:Node)=>mutated([{addedNodes:[element]}])};
}
describe('restrained page motion',()=>{
  it('does not observe or hide content with reduced motion enabled',()=>{
    const f=fixture(true),cleanup=installPageMotion(f.root,f.environment);
    expect(f.observe).not.toHaveBeenCalled();expect(f.element.animate).not.toHaveBeenCalled();cleanup();expect(f.listeners.size).toBe(0);
  });
  it('animates visible sections once with only opacity and transform',()=>{
    const f=fixture(),cleanup=installPageMotion(f.root,f.environment);expect(f.observe).toHaveBeenCalledWith(f.element);
    f.reveal();expect(f.unobserve).toHaveBeenCalledWith(f.element);
    expect(f.element.animate).toHaveBeenCalledWith([{opacity:.55,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(0.16,1,0.3,1)'});
    cleanup();expect(f.animation.cancel).toHaveBeenCalled();expect(f.disconnect).toHaveBeenCalled();expect(f.mutationDisconnect).toHaveBeenCalled();
  });
  it('cancels in-progress motion immediately when the OS preference changes',()=>{
    const f=fixture(),cleanup=installPageMotion(f.root,f.environment);f.reveal();
    f.preference.matches=true;for(const listener of f.listeners)listener();
    expect(f.animation.cancel).toHaveBeenCalled();cleanup();
  });
  it('coalesces additions and never re-observes an already seen card',()=>{
    const f=fixture(),cleanup=installPageMotion(f.root,f.environment);
    const node=Object.assign(f.element,{nodeType:1}) as unknown as Node;
    f.mutate(node);f.mutate(node);expect(f.frames).toHaveLength(1);f.frames[0](0);expect(f.observe).toHaveBeenCalledTimes(1);cleanup();
  });
  it('keeps file rows outside scroll animations and falls back without observers',()=>{
    expect(REVEAL_SELECTOR).not.toContain('tbody');expect(REVEAL_SELECTOR).not.toContain('.file-table');
    expect(()=>installPageMotion({} as Element,{} as Window & typeof globalThis)()).not.toThrow();
  });
});
