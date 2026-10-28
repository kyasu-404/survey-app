import { useEffect } from "react";
import type { SurveyCreator } from "survey-creator-react";
import type { SurveySchema } from "../../entities/survey/types";

export const GUARDED_COLLECTION_PROPERTIES = ["choices", "rows", "columns", "rateValues", "items"] as const;

export function getProtectedCollectionItemIdentity(propertyName: string, item: unknown) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const itemRecord = item as Record<string, unknown>;
    const technicalValue = (
      (propertyName === "items" || propertyName === "columns")
      && itemRecord.name !== undefined
      && itemRecord.value === undefined
    )
      ? itemRecord.name
      : itemRecord.value;
    if (technicalValue !== undefined) {
      return JSON.stringify(technicalValue);
    }
  }

  return JSON.stringify(item);
}

export function collectOriginalSchemaProtection(schema: SurveySchema) {
  const questionNames = new Set<string>();
  const collectionItems = new Set<string>();
  const stack: unknown[] = schema.pages.flatMap((page) => page.elements);

  while (stack.length > 0) {
    const element = stack.pop();
    if (!element || typeof element !== "object" || Array.isArray(element)) continue;
    const elementRecord = element as Record<string, unknown>;
    const name = typeof elementRecord.name === "string" ? elementRecord.name : "";

    if (name) {
      questionNames.add(name);
      GUARDED_COLLECTION_PROPERTIES.forEach((propertyName) => {
        const items = elementRecord[propertyName];
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
          collectionItems.add(`${name}:${propertyName}:${getProtectedCollectionItemIdentity(propertyName, item)}`);
        });
      });
    }

    for (const propertyName of ["elements", "templateElements"]) {
      const nestedElements = elementRecord[propertyName];
      if (Array.isArray(nestedElements)) stack.push(...nestedElements);
    }
  }

  return { questionNames, collectionItems };
}


export function useSafeSchemaEditing(creator: SurveyCreator | null, schema: SurveySchema | undefined, isSafeEditingMode: boolean) {
  useEffect(() => {
    if (!creator || !schema || !isSafeEditingMode) {
      return;
    }

    const protection = collectOriginalSchemaProtection(schema);
    const handleElementOperations = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        allowChangeInputType?: boolean;
        allowChangeType?: boolean;
        allowDelete?: boolean;
        allowDrag?: boolean;
        allowEdit?: boolean;
        element?: { name?: string };
        obj?: { name?: string };
      };
      const elementName = options.element?.name ?? options.obj?.name;
      if (!elementName || !protection.questionNames.has(elementName)) return;

      options.allowDelete = false;
      options.allowChangeType = false;
      options.allowChangeInputType = false;
      options.allowDrag = true;
      options.allowEdit = true;
    };
    const handleCollectionOperations = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        allowDelete?: boolean;
        element?: { name?: string };
        item?: unknown;
        propertyName?: string;
      };
      const questionName = options.element?.name;
      const propertyName = options.propertyName;
      if (!questionName || !propertyName || !GUARDED_COLLECTION_PROPERTIES.includes(
        propertyName as (typeof GUARDED_COLLECTION_PROPERTIES)[number],
      )) {
        return;
      }

      const key = `${questionName}:${propertyName}:${getProtectedCollectionItemIdentity(propertyName, options.item)}`;
      if (protection.collectionItems.has(key)) {
        options.allowDelete = false;
      }
    };
    const handleReadOnlyProperty = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        element?: unknown;
        parentElement?: { name?: string };
        parentProperty?: { name?: string };
        property?: { name?: string };
        readOnly?: boolean;
      };
      const questionName = options.parentElement?.name;
      const collectionName = options.parentProperty?.name;
      const itemRecord = options.element && typeof options.element === "object" && !Array.isArray(options.element)
        ? options.element as Record<string, unknown>
        : {};
      const technicalPropertyName = (
        (collectionName === "items" || collectionName === "columns")
        && itemRecord.name !== undefined
        && itemRecord.value === undefined
      )
        ? "name"
        : "value";
      if (
        !questionName
        || !collectionName
        || options.property?.name !== technicalPropertyName
        || !GUARDED_COLLECTION_PROPERTIES.includes(
          collectionName as (typeof GUARDED_COLLECTION_PROPERTIES)[number],
        )
      ) {
        return;
      }

      const key = `${questionName}:${collectionName}:${getProtectedCollectionItemIdentity(collectionName, options.element)}`;
      if (protection.collectionItems.has(key)) {
        options.readOnly = true;
      }
    };

    creator.onElementAllowOperations.add(handleElementOperations);
    creator.onCollectionItemAllowOperations.add(handleCollectionOperations);
    creator.onPropertyGetReadOnly.add(handleReadOnlyProperty);

    return () => {
      creator.onElementAllowOperations.remove(handleElementOperations);
      creator.onCollectionItemAllowOperations.remove(handleCollectionOperations);
      creator.onPropertyGetReadOnly.remove(handleReadOnlyProperty);
    };
  }, [creator, schema, isSafeEditingMode]);

}
