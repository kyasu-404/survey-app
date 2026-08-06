const COLLECTION_PROPERTIES = {
  choices: "вариант ответа",
  rows: "строка матрицы",
  columns: "столбец матрицы",
  rateValues: "значение шкалы",
  items: "поле составного вопроса",
};

const WARNING_PROPERTIES = {
  validators: "валидаторы",
  min: "минимальное значение",
  max: "максимальное значение",
  minValue: "минимальное значение",
  maxValue: "максимальное значение",
  minLength: "минимальную длину ответа",
  maxLength: "максимальную длину ответа",
  step: "шаг значения",
  minValueExpression: "минимальное значение",
  maxValueExpression: "максимальное значение",
  rateMin: "минимальное значение шкалы",
  rateMax: "максимальное значение шкалы",
  minSelectedChoices: "минимальное количество выбранных вариантов",
  maxSelectedChoices: "максимальное количество выбранных вариантов",
  visible: "видимость",
  visibleIf: "условие видимости",
  enableIf: "условие доступности",
  requiredIf: "условие обязательности",
  defaultValue: "значение по умолчанию",
  defaultValueExpression: "выражение значения по умолчанию",
  choicesVisibleIf: "условие видимости вариантов",
  choicesEnableIf: "условие доступности вариантов",
  choicesFromQuestion: "источник вариантов ответа",
  choiceValuesFromQuestion: "источник значений вариантов ответа",
  choiceTextsFromQuestion: "источник текстов вариантов ответа",
  choicesByUrl: "источник вариантов ответа",
  correctAnswer: "правильный ответ",
};

const SAFE_QUESTION_PROPERTIES = [
  "title",
  "description",
  "placeholder",
  "commentText",
  "otherText",
  "noneText",
  "selectAllText",
  "labelTrue",
  "labelFalse",
];

const MAX_SCHEMA_NODES = 5_000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableValue(left) === stableValue(right);
}

function questionLabel(question, fallback) {
  const title = typeof question.title === "string" ? question.title.trim() : "";
  return title || fallback;
}

function collectionIdentity(propertyName, item) {
  if (
    (propertyName === "items" || propertyName === "columns")
    && isRecord(item)
    && "name" in item
    && !("value" in item)
  ) {
    return stableValue(item.name);
  }

  if (isRecord(item) && "value" in item) {
    return stableValue(item.value);
  }

  return stableValue(item);
}

function collectionItemLabel(item) {
  if (isRecord(item)) {
    const displayValue = item.text ?? item.title ?? item.value ?? item.name;
    if (typeof displayValue === "string" || typeof displayValue === "number") {
      return String(displayValue);
    }
  }

  if (typeof item === "string" || typeof item === "number") {
    return String(item);
  }

  return "без названия";
}

function collectQuestions(schema) {
  const questions = new Map();
  const duplicates = new Set();
  const pages = isRecord(schema) && Array.isArray(schema.pages) ? schema.pages : [];
  const stack = [];
  let visitedNodes = 0;

  for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex -= 1) {
    const page = pages[pageIndex];
    if (!isRecord(page) || !Array.isArray(page.elements)) continue;
    for (let elementIndex = page.elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
      const element = page.elements[elementIndex];
      stack.push({ element, path: `page:${pageIndex}/element:${elementIndex}` });
    }
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !isRecord(current.element)) continue;
    visitedNodes += 1;
    if (visitedNodes > MAX_SCHEMA_NODES) {
      throw new Error("Схема формы содержит слишком много элементов");
    }

    const { element, path } = current;
    if (typeof element.name === "string" && element.name.trim() && typeof element.type === "string") {
      const name = element.name.trim();
      if (questions.has(name)) {
        duplicates.add(name);
      } else {
        questions.set(name, { question: element, path });
      }
    }

    for (const propertyName of ["elements", "templateElements"]) {
      const nestedElements = element[propertyName];
      if (!Array.isArray(nestedElements)) continue;
      for (let index = nestedElements.length - 1; index >= 0; index -= 1) {
        const nestedElement = nestedElements[index];
        stack.push({ element: nestedElement, path: `${path}/${propertyName}:${index}` });
      }
    }
  }

  return { questions, duplicates };
}

function normalizedInputType(question) {
  if (question.type === "text") {
    return question.inputType ?? "text";
  }

  return question.inputType;
}

function compareCollections(oldQuestion, nextQuestion, questionName, safeChanges, warnings, breakingChanges) {
  for (const [propertyName, itemTypeLabel] of Object.entries(COLLECTION_PROPERTIES)) {
    const oldItems = Array.isArray(oldQuestion[propertyName]) ? oldQuestion[propertyName] : [];
    const nextItems = Array.isArray(nextQuestion[propertyName]) ? nextQuestion[propertyName] : [];
    if (oldItems.length === 0 && nextItems.length === 0) continue;

    const oldByIdentity = new Map();
    const nextByIdentity = new Map();
    const duplicateNextIdentities = new Set();

    oldItems.forEach((item) => oldByIdentity.set(collectionIdentity(propertyName, item), item));
    nextItems.forEach((item) => {
      const identity = collectionIdentity(propertyName, item);
      if (nextByIdentity.has(identity)) duplicateNextIdentities.add(identity);
      nextByIdentity.set(identity, item);
    });

    for (const identity of duplicateNextIdentities) {
      breakingChanges.push(`В вопросе «${questionName}» повторяется техническое значение ${itemTypeLabel}`);
    }

    for (const [identity, oldItem] of oldByIdentity) {
      const nextItem = nextByIdentity.get(identity);
      if (nextItem === undefined) {
        breakingChanges.push(
          `Удалён или изменён ${itemTypeLabel} «${collectionItemLabel(oldItem)}» в вопросе «${questionName}»`,
        );
        continue;
      }

      const oldText = isRecord(oldItem) ? oldItem.text ?? oldItem.title : oldItem;
      const nextText = isRecord(nextItem) ? nextItem.text ?? nextItem.title : nextItem;
      if (!valuesEqual(oldText, nextText)) {
        safeChanges.push(`Изменён отображаемый текст ${itemTypeLabel} в вопросе «${questionName}»`);
      }

      if (
        (propertyName === "columns" || propertyName === "items")
        && isRecord(oldItem)
        && isRecord(nextItem)
        && (
          !valuesEqual(oldItem.type, nextItem.type)
          || !valuesEqual(oldItem.cellType, nextItem.cellType)
          || !valuesEqual(oldItem.inputType, nextItem.inputType)
        )
      ) {
        breakingChanges.push(`Изменён тип ${itemTypeLabel} «${collectionItemLabel(oldItem)}» в вопросе «${questionName}»`);
      }
    }

    for (const [identity, nextItem] of nextByIdentity) {
      if (!oldByIdentity.has(identity)) {
        warnings.push(`Добавлен ${itemTypeLabel} «${collectionItemLabel(nextItem)}» в вопрос «${questionName}»`);
      }
    }
  }
}

/**
 * @param {unknown} previousSchema
 * @param {unknown} nextSchema
 * @param {unknown} previousOrganizationTypes
 * @param {unknown} nextOrganizationTypes
 */
export function analyzeSchemaCompatibility(
  previousSchema,
  nextSchema,
  previousOrganizationTypes = [],
  nextOrganizationTypes = [],
) {
  const previous = collectQuestions(previousSchema);
  const next = collectQuestions(nextSchema);
  const safeChanges = [];
  const warnings = [];
  const breakingChanges = [];

  for (const name of next.duplicates) {
    breakingChanges.push(`Технический идентификатор вопроса «${name}» используется несколько раз`);
  }

  for (const [name, oldEntry] of previous.questions) {
    const nextEntry = next.questions.get(name);
    const oldQuestion = oldEntry.question;
    const oldLabel = questionLabel(oldQuestion, name);

    if (!nextEntry) {
      breakingChanges.push(`Удалён вопрос «${oldLabel}»`);
      continue;
    }

    const nextQuestion = nextEntry.question;
    const nextLabel = questionLabel(nextQuestion, name);

    if (oldQuestion.type !== nextQuestion.type) {
      breakingChanges.push(`Изменён тип вопроса «${oldLabel}»`);
    }

    if (!valuesEqual(normalizedInputType(oldQuestion), normalizedInputType(nextQuestion))) {
      breakingChanges.push(`Изменён формат ввода вопроса «${oldLabel}»`);
    }

    if (!valuesEqual(oldQuestion.valueName, nextQuestion.valueName)) {
      breakingChanges.push(`Изменён ключ сохраняемого значения вопроса «${oldLabel}»`);
    }

    compareCollections(oldQuestion, nextQuestion, nextLabel, safeChanges, warnings, breakingChanges);

    if (!oldQuestion.isRequired && Boolean(nextQuestion.isRequired)) {
      warnings.push(`Вопрос «${nextLabel}» стал обязательным`);
    }

    for (const [propertyName, propertyLabel] of Object.entries(WARNING_PROPERTIES)) {
      if (!valuesEqual(oldQuestion[propertyName], nextQuestion[propertyName])) {
        warnings.push(`Изменено ${propertyLabel} вопроса «${nextLabel}»`);
      }
    }

    if (oldEntry.path !== nextEntry.path) {
      safeChanges.push(`Вопрос «${nextLabel}» перемещён`);
    }

    if (SAFE_QUESTION_PROPERTIES.some((propertyName) => !valuesEqual(oldQuestion[propertyName], nextQuestion[propertyName]))) {
      safeChanges.push(`Изменён отображаемый текст вопроса «${nextLabel}»`);
    }
  }

  for (const [name, nextEntry] of next.questions) {
    if (previous.questions.has(name)) continue;
    const nextQuestion = nextEntry.question;
    const label = questionLabel(nextQuestion, name);

    if (nextQuestion.isRequired) {
      breakingChanges.push(`Добавлен обязательный вопрос «${label}». Сначала добавьте его как необязательный`);
    } else {
      warnings.push(`Добавлен новый необязательный вопрос «${label}»`);
    }
  }

  for (const propertyName of ["title", "description", "completedHtml", "logo", "logoPosition"]) {
    const oldValue = isRecord(previousSchema) ? previousSchema[propertyName] : undefined;
    const nextValue = isRecord(nextSchema) ? nextSchema[propertyName] : undefined;
    if (!valuesEqual(oldValue, nextValue)) {
      safeChanges.push("Изменено оформление или текст формы");
      break;
    }
  }

  for (const propertyName of ["triggers", "calculatedValues"] ) {
    const oldValue = isRecord(previousSchema) ? previousSchema[propertyName] : undefined;
    const nextValue = isRecord(nextSchema) ? nextSchema[propertyName] : undefined;
    if (!valuesEqual(oldValue, nextValue)) {
      warnings.push("Изменена логика переходов или вычислений формы");
      break;
    }
  }

  if (!valuesEqual(previousOrganizationTypes, nextOrganizationTypes)) {
    warnings.push("Изменён список типов организаций");
  }

  return {
    safeChanges: [...new Set(safeChanges)],
    warnings: [...new Set(warnings)],
    breakingChanges: [...new Set(breakingChanges)],
  };
}
