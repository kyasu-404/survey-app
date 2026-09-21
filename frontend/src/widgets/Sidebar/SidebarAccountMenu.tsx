import { Presence } from "../../shared/ui/Presence";
import {useEffect,useId,useRef,useState} from 'react';
import {useTheme} from '../../shared/theme/ThemeProvider';
import {ThemeMenuItems} from '../../shared/theme/ThemeCycleButton';
import themeBlack from '../../img/ThemeBlack.svg';
import themeWhite from '../../img/ThemeWhite.svg';
import exitBlack from '../../img/ExitBlack.svg';
import exitWhite from '../../img/ExitWhite.svg';
export function SidebarAccountMenu({name,onLogout}:{name:string;onLogout:()=>Promise<void>}){
 const {themeId}=useTheme(),[view,setView]=useState<'account'|'themes'|null>(null),[busy,setBusy]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menuId=useId();
 const dark=themeId==='graphite';
 const close=()=>{setView(null);trigger.current?.focus();};
 useEffect(()=>{
  if(!view)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setView(null);};
  document.addEventListener('pointerdown',outside);
  root.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
  return()=>document.removeEventListener('pointerdown',outside);
 },[view]);
 return <div className="sidebar-account" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setView(null);}} onKeyDown={e=>{
  if(e.key==='Escape' && view){e.preventDefault();close();}
  if(!view && (e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();setView('account');return;}
  if(!view || !['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const items=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') || []);if(!items.length)return;
  e.preventDefault();const at=items.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();
 }}>
  <button type="button" className="sidebar-account-trigger" ref={trigger} title={name} aria-haspopup="menu" aria-expanded={!!view} aria-controls={menuId} onClick={()=>setView(view?null:'account')}><span>{name}</span></button>
  <Presence kind="menu">{view && <div id={menuId} className="form-menu-dropdown sidebar-account-menu" role="menu" aria-label={view==='account'?'Меню пользователя':'Выбор темы'}>
   {view==='account'?<>
    <button type="button" role="menuitem" className="form-menu-item" onClick={()=>setView('themes')}><img src={dark?themeWhite:themeBlack} alt="" aria-hidden="true"/><span>Тема</span></button>
    <button type="button" role="menuitem" className="form-menu-item" disabled={busy} onClick={()=>{setBusy(true);void onLogout().finally(()=>setBusy(false));}}><img src={dark?exitWhite:exitBlack} alt="" aria-hidden="true"/><span>Выйти</span></button>
   </>:<><button type="button" role="menuitem" className="form-menu-item sidebar-account-back" onClick={()=>setView('account')}>← Назад</button><ThemeMenuItems onSelect={close}/></>}
  </div>}</Presence>
 </div>;
}
