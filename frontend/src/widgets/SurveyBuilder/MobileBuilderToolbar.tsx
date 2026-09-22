import { useEffect, useRef, useState } from "react";
import type { SurveyCreator } from "survey-creator-react";
import { BUILDER_PREVIEW_TAB_ID } from "./BuilderPreviewTab";

type Props = {
  creator: SurveyCreator;
  busy: boolean;
  safeEditing: boolean;
  onSaveTemplate: () => void;
  onGallery: () => void;
  onReset: () => void;
};

/** The Creator's mobile footer doesn't include our custom tabs and actions. */
export function MobileBuilderToolbar({ creator, busy, safeEditing, onSaveTemplate, onGallery, onReset }: Props) {
  const [activeTab, setActiveTab] = useState(creator.activeTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => setActiveTab(creator.activeTab);
    creator.onActiveTabChanged.add(sync);
    return () => creator.onActiveTabChanged.remove(sync);
  }, [creator]);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  const run = (action: () => void) => {
    setMenuOpen(false);
    trigger.current?.focus();
    action();
  };

  return <div className="builder-mobile-toolbar">
    <select aria-label="Раздел конструктора" value={activeTab} onChange={(event) => creator.switchTab(event.target.value)}>
      <option value="designer">Конструктор</option>
      <option value={BUILDER_PREVIEW_TAB_ID}>Предпросмотр</option>
      <option value="theme">Темы</option>
      <option value="logic">Логика</option>
    </select>
    <div className="builder-mobile-actions" ref={menuRoot} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setMenuOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" className="app-button" aria-expanded={menuOpen} aria-controls="builder-mobile-actions" onClick={() => setMenuOpen((open) => !open)}>Действия</button>
      {menuOpen && <div id="builder-mobile-actions" className="builder-mobile-actions-panel" aria-label="Действия конструктора">
        <button type="button" className="form-menu-item" disabled={busy} onClick={() => run(() => creator.saveSurvey())}>Сохранить форму</button>
        <button type="button" className="form-menu-item" disabled={busy} onClick={() => run(onSaveTemplate)}>Сохранить как шаблон</button>
        <button type="button" className="form-menu-item" disabled={busy} onClick={() => run(onGallery)}>Галерея фонов</button>
        {!safeEditing && <button type="button" className="form-menu-item" disabled={busy} onClick={() => run(onReset)}>Сбросить конструктор</button>}
      </div>}
    </div>
  </div>;
}
