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
    setPinnedTemplateIds((currentTemplateIds) => {
      const nextTemplateIds = currentTemplateIds.includes(templateId)
        ? currentTemplateIds.filter((currentTemplateId) => currentTemplateId !== templateId)
        : [templateId, ...currentTemplateIds];

      writePinnedTemplateIds(pinnedTemplateIdsStorageKey, nextTemplateIds);
      return nextTemplateIds;
    });
  };

  return {
    handleTogglePin,
    pinnedTemplateIds,
    sortedTemplates,
  };
}
