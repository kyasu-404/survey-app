import { ComponentCollection } from "survey-core";

export const QUESTION_TYPES = [
  "sectiontitle",
  "text",
  "comment",
  "radiogroup",
  "checkbox",
  "dropdown",
  "organization",
  "number",
  "integer",
  "date",
  "time",
  "datetime",
  "phone",
  "email",
  "boolean",
  "rating",
  "ranking",
  "tagbox",
  "matrix",
  "matrixdropdown",
  "matrixdynamic",
  "multipletext",
  "image",
  "imagepicker",
  "file",
  "signaturepad",
  "panel",
  "paneldynamic",
  "expression",
  "html",
] as const;

export type SurveyQuestionType = (typeof QUESTION_TYPES)[number];

export type QuestionTypeDefinition = {
  name: SurveyQuestionType;
  iconName: string;
  title: string;
  category: "basic" | "advanced";
  questionJSON?: Record<string, unknown>;
  defaultQuestionTitle?: string;
};

export const QUESTION_TYPE_DEFINITIONS: QuestionTypeDefinition[] = [
  {
    name: "sectiontitle",
    iconName: "icon-toolbox-sectiontitle-custom",
    title: "Название раздела",
    category: "basic",
    defaultQuestionTitle: "Название раздела",
    questionJSON: {
      type: "expression",
      expression: "",
      defaultDisplayValue: "",
      isRequired: false,
      showNumber: false,
      titleLocation: "top",
    },
  },
  {
    name: "text",
    iconName: "icon-text",
    title: "Текст",
    category: "basic",
  },
  {
    name: "comment",
    iconName: "icon-comment",
    title: "Абзац",
    category: "basic",
  },
  {
    name: "radiogroup",
    iconName: "icon-radiogroup",
    title: "Единичный выбор",
    category: "basic",
  },
  {
    name: "checkbox",
    iconName: "icon-checkbox",
    title: "Множественный выбор",
    category: "basic",
  },
  {
    name: "dropdown",
    iconName: "icon-dropdown",
    title: "Выпадающий список",
    category: "basic",
  },
  {
    name: "organization",
    iconName: "icon-dropdown",
    title: "Организация",
    category: "basic",
    questionJSON: {
      type: "dropdown",
      title: "Организация",
      placeholder: "Начните вводить название…",
      searchEnabled: true,
      choices: [],
      titleLocation: "top",
    },
  },
  {
    name: "number",
    iconName: "icon-toolbox-float-custom",
    title: "Число",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "number",
      step: "any",
      titleLocation: "top",
    },
  },
  {
    name: "integer",
    iconName: "icon-toolbox-integer-custom",
    title: "Целое число",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "number",
      step: 1,
      titleLocation: "top",
      validators: [
        {
          type: "regex",
          regex: "^-?\\d+$",
          text: "Введите целое число без точки и запятой",
        },
      ],
    },
  },
  {
    name: "date",
    iconName: "icon-toolbox-date-custom",
    title: "Дата",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "date",
      titleLocation: "top",
    },
  },
  {
    name: "time",
    iconName: "icon-toolbox-time-custom",
    title: "Время",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "time",
      titleLocation: "top",
    },
  },
  {
    name: "datetime",
    iconName: "icon-toolbox-datetime-custom",
    title: "Дата и время",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "datetime-local",
      titleLocation: "top",
    },
  },
  {
    name: "phone",
    iconName: "icon-toolbox-phone-custom",
    title: "Телефон",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "tel",
      maskType: "pattern",
      maskSettings: {
        pattern: "+7(999)-999-99-99",
        saveMaskedValue: true,
      },
      placeholder: "+7(999)-999-99-99",
      titleLocation: "top",
      validators: [
        {
          type: "regex",
          regex: "^\\+7\\(\\d{3}\\)-\\d{3}-\\d{2}-\\d{2}$",
          text: "Введите телефон в формате +7(999)-999-99-99",
        },
      ],
    },
  },
  {
    name: "email",
    iconName: "icon-toolbox-email-custom",
    title: "Email",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "email",
      titleLocation: "top",
    },
  },
  {
    name: "boolean",
    iconName: "icon-boolean",
    title: "Да/Нет",
    category: "advanced",
  },
  {
    name: "rating",
    iconName: "icon-rating",
    title: "Рейтинг",
    category: "advanced",
  },
  {
    name: "ranking",
    iconName: "icon-ranking",
    title: "Ранжирование",
    category: "advanced",
  },
  {
    name: "tagbox",
    iconName: "icon-tagbox",
    title: "Теги",
    category: "advanced",
  },
  {
    name: "matrix",
    iconName: "icon-matrix",
    title: "Матрица",
    category: "advanced",
  },
  {
    name: "matrixdropdown",
    iconName: "icon-matrixdropdown",
    title: "Матрица с выбором",
    category: "advanced",
  },
  {
    name: "matrixdynamic",
    iconName: "icon-matrixdynamic",
    title: "Динамическая матрица",
    category: "advanced",
  },
  {
    name: "multipletext",
    iconName: "icon-multipletext",
    title: "Несколько полей",
    category: "advanced",
  },
  {
    name: "image",
    iconName: "icon-image",
    title: "Изображение",
    category: "advanced",
  },
  {
    name: "imagepicker",
    iconName: "icon-imagepicker",
    title: "Выбор изображения",
    category: "advanced",
  },
  {
    name: "file",
    iconName: "icon-file",
    title: "Файл",
    category: "advanced",
  },
  {
    name: "signaturepad",
    iconName: "icon-signaturepad",
    title: "Подпись",
    category: "advanced",
  },
  {
    name: "panel",
    iconName: "icon-panel",
    title: "Панель",
    category: "advanced",
  },
  {
    name: "paneldynamic",
    iconName: "icon-paneldynamic",
    title: "Динамическая панель",
    category: "advanced",
  },
  {
    name: "expression",
    iconName: "icon-expression",
    title: "Выражение",
    category: "advanced",
  },
  {
    name: "html",
    iconName: "icon-html",
    title: "HTML",
    category: "advanced",
  },
];

export function registerCustomSurveyQuestionTypes() {
  QUESTION_TYPE_DEFINITIONS.filter((definition) => definition.questionJSON).forEach((definition) => {
    if (ComponentCollection.Instance.getCustomQuestionByName(definition.name)) {
      return;
    }

    ComponentCollection.Instance.add({
      name: definition.name,
      title: definition.title,
      iconName: definition.iconName,
      questionJSON: definition.questionJSON,
      defaultQuestionTitle: definition.defaultQuestionTitle,
      inheritBaseProps: true,
    });
  });
}
