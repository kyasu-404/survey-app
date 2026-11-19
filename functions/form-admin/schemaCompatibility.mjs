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
  allowCustomChoices: "возможность ввода своего варианта",
  allowAddRows: "возможность добавлять строки",
  allowRemoveRows: "возможность удалять строки",
  allowAddPanel: "возможность добавлять разделы",
  allowRemovePanel: "возможность удалять разделы",
  copyDefaultValueFromLastEntry: "копирование предыдущей записи",
  selectToRankEnabled: "правила отбора элементов для ранжирования",
  hideIfChoicesEmpty: "скрытие вопроса без вариантов",
  hideIfRowsEmpty: "скрытие матрицы без строк",
  clearIfInvisible: "очистку скрытого значения",
  resetValueIf: "условие сброса ответа",
  setValueIf: "условие подстановки ответа",
  setValueExpression: "выражение для подстановки ответа",
  expression: "вычисляемое выражение",
  bindings: "привязки свойств",
  readOnly: "доступность редактирования",
  templateVisibleIf: "видимость повторяющихся разделов",
  rowsVisibleIf: "видимость строк",
  columnsVisibleIf: "видимость столбцов",
  eachRowRequired: "обязательность строк",
  eachRowUnique: "уникальность ответов по строкам",
  isUnique: "требование уникальности",
  keyName: "поле проверки уникальности",
  minRowCount: "минимальное число строк",
  maxRowCount: "максимальное число строк",
  rowCount: "начальное число строк",
  minPanelCount: "минимальное число разделов",
  maxPanelCount: "максимальное число разделов",
  panelCount: "начальное число разделов",
  defaultRowValue: "значения строки по умолчанию",
  defaultPanelValue: "значения раздела по умолчанию",
  choicesFromQuestionMode: "правило отбора вариантов",
  rateStep: "шаг шкалы",
  rateCount: "число отметок шкалы",
  autoGenerate: "формирование шкалы",
  precision: "точность результата",
  acceptedTypes: "допустимые типы файлов",
  acceptedCategories: "допустимые категории файлов",
  allowMultiple: "возможность загрузки нескольких файлов",
  maxSize: "ограничение размера файла",
  maxFiles: "ограничение числа файлов",
  isCommentRequired: "обязательность комментария",
  isExclusive: "ограничение совместного выбора",
  showNoneItem: "вариант «Ничего из перечисленного»",
  showRefuseItem: "вариант отказа от ответа",
  showDontKnowItem: "вариант «Не знаю»",
  totalExpression: "выражение итога",
  totalType: "способ вычисления итога",
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

// Only active container rules affect a question moved between pages or panels.
function containerRules(element) {
  const rules = {};
  for (const key of ["visibleIf", "enableIf", "requiredIf", "isRequired", "readOnly", "timeLimit"]) {
    if (element[key]) rules[key] = element[key];
  }
  if (element.visible === false) rules.visible = false;
  return Object.keys(rules).length ? [rules] : [];
}

// SurveyJS also reads the legacy "questions" spelling. Conflicting lists can
// deserialize differently depending on JSON property order.
function elementList(container, key, aliases = []) {
  const lists = [key, ...aliases].filter(name => Array.isArray(container?.[name]));
  if (lists.length > 1) throw new Error("В схеме формы заданы конфликтующие списки элементов");
  return lists.length ? container[lists[0]] : [];
}

function storedCalculations(schema) {
  return new Set((Array.isArray(schema?.calculatedValues) ? schema.calculatedValues : [])
    .filter(item => item?.includeIntoResult).map(item => item.name));
}

function collectQuestions(schema) {
  const questions = new Map();
  const duplicates = new Set();
  const answerOwners = new Map();
  function registerAnswer(scope, key, owner) {
    const path = stableValue([scope, key]);
    const owners = answerOwners.get(path) ?? new Set();
    owners.add(owner);
    answerOwners.set(path, owners);
  }
  const calculations = storedCalculations(schema);
  for (const name of calculations) registerAnswer("", name, `вычисление «${name}»`);

  const pages = Array.isArray(schema?.pages) ? elementList(schema, "pages", ["elements", "questions"]) : [schema];
  const stack = [];
  let visitedNodes = 0;

  for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex -= 1) {
    const page = pages[pageIndex];
    if (!isRecord(page)) continue;
    const rules = containerRules(page);
    const elements = elementList(page, "elements", ["questions"]);
    for (let index = elements.length - 1; index >= 0; index--) {
      stack.push({ element: elements[index], path: `page:${pageIndex}/element:${index}`, scope: "", rules });
    }
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !isRecord(current.element)) continue;
    visitedNodes += 1;
    if (visitedNodes > MAX_SCHEMA_NODES) {
      throw new Error("Схема формы содержит слишком много элементов");
    }

    const { element, path, scope, rules } = current;
    if (typeof element.name === "string" && element.name.trim() && typeof element.type === "string") {
      const name = element.name;
      if (questions.has(name)) {
        duplicates.add(name);
      } else {
        questions.set(name, { question: element, path, scope, rules });
        if (!["panel", "html", "image", "sectiontitle"].includes(element.type)) {
          const key = element.valueName || name;
          registerAnswer(scope, key, `вопрос «${name}»`);
          if (element.showCommentArea || element.hasComment || element.showOtherItem || element.hasOther) {
            registerAnswer(scope, key + (schema.commentSuffix ?? "-Comment"), `комментарий «${name}»`);
          }
        }
      }
    }

    const pushElements = (elements, propertyName, childScope, childRules) => {
      for (let index = elements.length - 1; index >= 0; index--) {
        stack.push({ element: elements[index], path: `${path}/${propertyName}:${index}`, rules: childRules, scope: childScope });
      }
    };
    if (element.type === "panel") {
      pushElements(elementList(element, "elements", ["questions"]), "elements", scope, rules.concat(containerRules(element)));
    } else if (element.type === "paneldynamic") {
      pushElements(elementList(element, "templateElements", ["questions"]), "templateElements", element.name, rules);
    } else if (["matrixdropdown", "matrixdynamic"].includes(element.type)) {
      pushElements(elementList(element, "detailElements"), "detailElements", element.name, rules);
    } else if (["radiogroup", "checkbox"].includes(element.type) && Array.isArray(element.choices)) {
      for (const choice of element.choices) {
        if (Array.isArray(choice?.elements)) {
          const condition = { question: element.name, choice: choice.value };
          pushElements(choice.elements, "choices", scope, rules.concat(condition));
        }
      }
    }
  }

  return { questions, duplicates, answerOwners, calculations };
}

function normalizedInputType(question) {
  if (question.type === "text") {
    return question.inputType ?? "text";
  }

  return question.inputType;
}

function inputMask(question) {
  const phone = question.type === "phone";
  const type = question.maskType ?? (phone ? "pattern" : "none");
  // A supplied settings object replaces the entire preset on the custom phone question.
  const { saveMaskedValue = false, ...settings } = question.maskSettings ?? (phone && type === "pattern"
    ? { pattern: "+7(999)-999-99-99", saveMaskedValue: true } : {});
  const saved = type !== "none" && Boolean(saveMaskedValue);
  let format = "text";
  if (saved) format = type;
  else if (type === "numeric" || type === "currency") format = "number";
  else if (type === "datetime") format = "iso";
  return { type, settings, saved, format };
}

function compareMask(before, after, label, warnings, breakingChanges) {
  const oldMask = inputMask(before);
  const nextMask = inputMask(after);
  const formatKeys = ["pattern", "prefix", "suffix", "decimalSeparator", "thousandsSeparator", "precision"];
  if (oldMask.saved !== nextMask.saved || oldMask.format !== nextMask.format
    || (nextMask.saved && formatKeys.some(key => !valuesEqual(oldMask.settings[key], nextMask.settings[key])))) {
    breakingChanges.push(`Изменён формат сохраняемого значения маски в «${label}»`);
  } else if (oldMask.type !== nextMask.type || !valuesEqual(oldMask.settings, nextMask.settings)) {
    warnings.push(`Изменены настройки маски ввода в «${label}»`);
  }
}

function choiceValueProperty(field) {
  // The first inline comment changes every checkbox selection from a scalar to an object.
  const usesObjects = ["checkbox", "tagbox", "ranking"].includes(field.type)
    && Array.isArray(field.choices) && field.choices.some(choice => choice?.showCommentArea);
  return field.valuePropertyName || (usesObjects ? "value" : "");
}

function compareFieldSettings(before, after, label, warnings, breakingChanges) {
  if (before.type !== after.type) breakingChanges.push(`Изменён тип вопроса «${label}»`);
  if (!valuesEqual(normalizedInputType(before), normalizedInputType(after))) {
    breakingChanges.push(`Изменён формат ввода вопроса «${label}»`);
  }
  if (!valuesEqual(before.valueName || before.name, after.valueName || after.name)) {
    breakingChanges.push(`Изменён ключ сохраняемого значения вопроса «${label}»`);
  }
  if (!before.isRequired && after.isRequired) warnings.push(`Вопрос «${label}» стал обязательным`);
  for (const [key, description] of Object.entries(WARNING_PROPERTIES)) {
    if (!valuesEqual(before[key], after[key])) warnings.push(`В «${label}» изменили ${description}`);
  }

  if (choiceValueProperty(before) !== choiceValueProperty(after)) {
    breakingChanges.push(`Изменён формат хранения выбранных вариантов в «${label}»`);
  }
  const storageDefaults = {
    valueTrue: true, valueFalse: false, commentPropertyName: "comment",
    multiSelect: false, storeOthersAsComment: "default", dataFormat: "png",
    otherItemValue: "other", noneItemValue: "none",
  };
  if (before.type === "signaturepad") storageDefaults.storeDataAsText = true;
  if (before.type === "matrix") storageDefaults.cellType = "radio";
  for (const [key, fallback] of Object.entries(storageDefaults)) {
    if (!valuesEqual(before[key] ?? fallback, after[key] ?? fallback)) {
      breakingChanges.push(`Изменён формат ответа в «${label}» (${key})`);
    }
  }
  for (const [key, legacy] of [["showCommentArea", "hasComment"], ["showOtherItem", "hasOther"]]) {
    const wasEnabled = before[key] ?? before[legacy] ?? false;
    const enabled = after[key] ?? after[legacy] ?? false;
    if (wasEnabled && !enabled) breakingChanges.push(`Отключено сохранение комментария или варианта «Другое» в «${label}»`);
    if (!wasEnabled && enabled) warnings.push(`Добавлено поле комментария или вариант «Другое» в «${label}»`);
  }
  compareMask(before, after, label, warnings, breakingChanges);
}

function matrixColumnType(column, matrix) {
  if (!column.cellType || column.cellType === "default") return matrix.cellType || "dropdown";
  return column.cellType;
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

      const before = isRecord(oldItem) ? oldItem : {};
      const after = isRecord(nextItem) ? nextItem : {};
      const itemLabel = `${questionName} / ${collectionItemLabel(nextItem)}`;
      if (propertyName === "columns" || propertyName === "items") {
        const beforeType = propertyName === "items" ? before.type ?? "text" : matrixColumnType(before, oldQuestion);
        const afterType = propertyName === "items" ? after.type ?? "text" : matrixColumnType(after, nextQuestion);
        compareFieldSettings({ ...before, type: beforeType }, { ...after, type: afterType }, itemLabel, warnings, breakingChanges);
        if (propertyName === "columns" && (before.choices || after.choices)) {
          compareCollections({ choices: before.choices ?? oldQuestion.choices }, { choices: after.choices ?? nextQuestion.choices },
            itemLabel, safeChanges, warnings, breakingChanges);
        }
      } else {
        if (Boolean(before.showCommentArea) !== Boolean(after.showCommentArea)) {
          breakingChanges.push(`Изменён формат значения с комментарием у варианта «${itemLabel}»`);
        }
        for (const key of ["visibleIf", "enableIf", "isCommentRequired", "isExclusive"]) {
          if (!valuesEqual(before[key], after[key])) warnings.push(`В «${itemLabel}» изменили ${WARNING_PROPERTIES[key]}`);
        }
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

  for (const [key, owners] of next.answerOwners) {
    if (owners.size > 1 && [...owners].some(name => !previous.answerOwners.get(key)?.has(name))) {
      breakingChanges.push(`Один ключ сохраняемого ответа используют ${[...owners].join(", ")}`);
    }
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

    compareCollections(oldQuestion, nextQuestion, nextLabel, safeChanges, warnings, breakingChanges);
    compareFieldSettings(oldQuestion, nextQuestion, nextLabel, warnings, breakingChanges);
    if (oldEntry.scope !== nextEntry.scope) {
      breakingChanges.push(`Изменилось место хранения ответа на вопрос «${nextLabel}»`);
    }
    if (!valuesEqual(oldEntry.rules, nextEntry.rules)) {
      warnings.push(`Изменены условия страницы или раздела для «${nextLabel}»`);
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

  const before = isRecord(previousSchema) ? previousSchema : {};
  const after = isRecord(nextSchema) ? nextSchema : {};
  if (["title", "description", "completedHtml", "logo", "logoPosition"].some(key => !valuesEqual(before[key], after[key]))) {
    safeChanges.push("Изменено оформление или текст формы");
  }

  for (const [key, fallback] of Object.entries({ commentSuffix: "-Comment", storeOthersAsComment: true })) {
    if (!valuesEqual(before[key] ?? fallback, after[key] ?? fallback)) {
      breakingChanges.push(`Изменён формат хранения комментариев формы (${key})`);
    }
  }
  const surveyRules = [
    ["clearInvisibleValues", "onComplete", "очистки скрытых ответов"],
    ["checkErrorsMode", "onNextPage", "проверки ошибок"],
    ["validateVisitedEmptyFields", false, "проверки пропущенных полей"],
    ["maxTextLength", 0, "длины текстового ответа"],
    ["maxCommentLength", 0, "длины комментария"],
    ["readOnly", false, "доступности редактирования"],
    ["timeLimit", 0, "времени заполнения формы"],
    ["timeLimitPerPage", 0, "времени заполнения страницы"],
    ["autoAdvanceEnabled", false, "автоматического перехода"],
    ["autoAdvanceAllowComplete", true, "автоматического завершения"],
  ];
  for (const [key, fallback, label] of surveyRules) {
    if (!valuesEqual(before[key] ?? fallback, after[key] ?? fallback)) {
      warnings.push(`Изменены настройки ${label}`);
    }
  }
  for (const key of previous.calculations) {
    if (!next.calculations.has(key)) breakingChanges.push(`Удалён ключ вычисляемого результата «${key}»`);
  }

  if (["triggers", "calculatedValues"].some(key => !valuesEqual(before[key], after[key]))) {
    warnings.push("Изменена логика переходов или вычислений формы");
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
