import { AnimatedTabs } from "./AnimatedTabs";
export function SectionTabs<T extends string>({id,label,tabs,value,onChange}:{id:string;label:string;tabs:readonly {value:T;label:string}[];value:T;onChange:(value:T)=>void}){
 return <AnimatedTabs className="organizations-type-switcher section-tabs" role="tablist" aria-label={label}>
  {tabs.map((tab,index)=><button key={tab.value} id={`${id}-tab-${tab.value}`} type="button" role="tab" aria-selected={value===tab.value} aria-controls={`${id}-panel-${tab.value}`} tabIndex={value===tab.value?0:-1} className={value===tab.value?'active':''} onClick={()=>onChange(tab.value)} onKeyDown={e=>{
   let next=index;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;
   e.preventDefault();onChange(tabs[next].value);document.getElementById(`${id}-tab-${tabs[next].value}`)?.focus();
  }}>{tab.label}</button>)}
 </AnimatedTabs>;
}
