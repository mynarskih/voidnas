import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {t} from './preferences';

export function Modal({title,children,onClose,className=''}:{title:string;children:React.ReactNode;onClose:()=>void;className?:string}){
  const dialog=useRef<HTMLDivElement>(null),label=useId(),[previous]=useState(()=>document.activeElement as HTMLElement|null);
  // Capture before commit: an autoFocus child has already taken focus by effect time.
  useEffect(()=>{const overflow=document.body.style.overflow;document.body.style.overflow='hidden';if(!dialog.current?.contains(document.activeElement))dialog.current?.querySelector<HTMLElement>('button,input,select,textarea')?.focus();return()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true})}},[previous]);
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby={label} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();onClose()}
    if(event.key==='Tab'){const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],audio[controls],video[controls]')??[]).filter(e=>e.getClientRects().length);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
  }}><button className="modal-scrim" tabIndex={-1} aria-label={t('Close')} onClick={onClose}/><div className={`modal ${className}`} ref={dialog}><header><h2 id={label}>{title}</h2><button className="icon-btn" aria-label={t('Close')} onClick={onClose}><X size={17}/></button></header>{children}</div></div>
}
