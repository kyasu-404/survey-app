import { useEffect, useMemo, useState } from "react";
import type { TemplatesSection } from "../types";
import {
  getPinnedTemplateIdsStorageKey,
  readPinnedTemplateIds,
  sortTemplatesByPins,
  writePinnedTemplateIds,
} from "../templatesPageUtils";
import type { SurveyFormSummary } from "../../../entities/survey/types";

export function usePinnedTemplates(section: TemplatesSection, userId: string | null | undefined, templates: SurveyFormSummary[]) {
  const pinnedTemplateIdsStorageKey = useMemo(() => getPinnedTemplateIdsStorageKey(userId, section), [section, userId]);
  const [pinnedTemplateIds, setPinnedTemplateIds] = useState(() =>
    readPinnedTemplateIds(getPinnedTemplateIdsStorageKey(userId, "mine")),
  );

  useEffect(() => {
    setPinnedTemplateIds(readPinnedTemplateIds(pinnedTemplateIdsStorageKey));
  }, [pinnedTemplateIdsStorageKey]);

  const sortedTemplates = useMemo(() => sortTemplatesByPins(templates, pinnedTemplateIds), [pinnedTemplateIds, templates]);

  const handleTogglePin = (templateId: string) => {
    const nextTemplateIds = pinnedTemplateIds.includes(templateId)
      ? pinnedTemplateIds.filter((currentTemplateId) => currentTemplateId !== templateId)
      : [templateId, ...pinnedTemplateIds];
    setPinnedTemplateIds(nextTemplateIds);
    writePinnedTemplateIds(pinnedTemplateIdsStorageKey, nextTemplateIds);
  };

  return {
    handleTogglePin,
    pinnedTemplateIds,
    sortedTemplates,
  };
}
