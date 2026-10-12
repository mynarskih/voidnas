import {useEffect} from 'react';

export const REVEAL_SELECTOR='.page-head, .metric-card, .system-block, .info-table, .settings-section, .usage-chart, .profile-card, .public-share-header';
// Animate only transform/opacity, once per element. No hidden-content CSS:
// content stays accessible even if observers/animations are unavailable.
export function installPageMotion(root:Element,environment:Window & typeof globalThis=window){
  if(!environment.matchMedia||!environment.IntersectionObserver||!environment.MutationObserver)return()=>{};
  const preference=environment.matchMedia('(prefers-reduced-motion: reduce)');
  let stop=()=>{};
  const activate=()=>{
    stop();
    if(preference.matches)return;
    const seen=new WeakSet<Element>(),animations=new Set<Animation>(),pending=new Set<Element>();
    let frame:number|undefined,closed=false;
    const intersection=new environment.IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        intersection.unobserve(entry.target);
        if(preference.matches||typeof entry.target.animate!=='function')continue;
        const animation=entry.target.animate([{opacity:.55,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(0.16,1,0.3,1)'});
        animations.add(animation);animation.finished.then(()=>animations.delete(animation),()=>animations.delete(animation));
      }
    },{threshold:.05});
    const observe=(element:Element)=>{
      if(closed||seen.has(element)||!element.isConnected)return;
      seen.add(element);intersection.observe(element);
    };
    const scan=(element:Element)=>{
      if(element.matches(REVEAL_SELECTOR))observe(element);
      element.querySelectorAll(REVEAL_SELECTOR).forEach(observe);
    };
    scan(root);
    const changes=new environment.MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)pending.add(node as Element);
      if(!pending.size||frame!==undefined)return;
      frame=environment.requestAnimationFrame(()=>{frame=undefined;for(const element of pending)scan(element);pending.clear()});
    });
    changes.observe(root,{childList:true,subtree:true});
    stop=()=>{
      closed=true;intersection.disconnect();changes.disconnect();
      if(frame!==undefined)environment.cancelAnimationFrame(frame);
      pending.clear();for(const animation of animations)animation.cancel();animations.clear();
    };
  };
  activate();preference.addEventListener('change',activate);
  return()=>{preference.removeEventListener('change',activate);stop()};
}
export function usePageMotion(){
  useEffect(()=>{const root=document.getElementById('root');if(root)return installPageMotion(root)},[]);
}
