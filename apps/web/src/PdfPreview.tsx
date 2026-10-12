import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {t} from './preferences';
GlobalWorkerOptions.workerSrc=workerUrl;

export default function PdfPreview({url}:{url:string}){
  const[document,setDocument]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[error,setError]=useState(''),[rendering,setRendering]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  // Canvas-only rendering; no scripting/annotation layer, remote fonts or eval.
  useEffect(()=>{let alive=true;const task=getDocument({url,withCredentials:true,useWasm:false,enableXfa:false,disableAutoFetch:true,disableStream:true});
    task.promise.then(pdf=>{if(alive){setDocument(pdf);setPage(1)}}).catch(e=>{if(alive)setError(e.message)});
    return()=>{alive=false;void task.destroy()};
  },[url]);
  useEffect(()=>{if(!document||!canvas.current)return;let alive=true;let render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;setRendering(true);
    document.getPage(page).then(pdfPage=>{if(!alive||!canvas.current)return;const initial=pdfPage.getViewport({scale:1}),scale=Math.min(1.5,1000/initial.width,1500/initial.height),viewport=pdfPage.getViewport({scale}),pixelRatio=Math.min(1.5,window.devicePixelRatio||1),element=canvas.current;
      element.width=Math.ceil(viewport.width*pixelRatio);element.height=Math.ceil(viewport.height*pixelRatio);element.style.width=`${viewport.width}px`;element.style.height=`${viewport.height}px`;
      render=pdfPage.render({canvas:element,viewport,transform:[pixelRatio,0,0,pixelRatio,0,0],annotationMode:0});return render.promise;
    }).catch(e=>{if(alive&&e.name!=='RenderingCancelledException')setError(e.message)}).finally(()=>{if(alive)setRendering(false)});
    return()=>{alive=false;render?.cancel()};
  },[document,page]);
  return <div className="pdf-preview">{error?<p className="error" role="alert">{t('Could not render PDF')}: {error}</p>:<><div className="pdf-controls"><button className="button" disabled={!document||page<=1||rendering} onClick={()=>setPage(value=>value-1)} aria-label={t('Previous page')}><ChevronLeft size={16}/></button><span className="mono">{page} / {document?.numPages??'—'}</span><button className="button" disabled={!document||page>=(document?.numPages??1)||rendering} onClick={()=>setPage(value=>value+1)} aria-label={t('Next page')}><ChevronRight size={16}/></button></div><div className="pdf-canvas"><canvas ref={canvas} aria-label={t('PDF page {count}',{count:page})}/></div></>}</div>;
}
