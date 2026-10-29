import "survey-creator-core/survey-creator-core.css";
import "survey-core/survey-core.css";
import { Serializer, surveyLocalization, SvgRegistry, type ITheme } from "survey-core";
import "survey-core/i18n/russian";
import SurveyTheme from "survey-core/themes";
import {
  editorLocalization,
  registerCreatorTheme,
  registerSurveyTheme,
  type ICreatorPlugin,
  type ICreatorTheme
} from "survey-creator-core";
import "survey-creator-core/i18n/russian";
import { SurveyCreator } from "survey-creator-react";
import { sanitizeSurveyHtml } from "../../entities/survey/model/surveyHtml";
import dateTimeIcon from "../../img/constructor/Date-Time.svg?raw";
import dateIcon from "../../img/constructor/Date.svg?raw";
import emailIcon from "../../img/constructor/Email.svg?raw";
import floatIcon from "../../img/constructor/float.svg?raw";
import integerIcon from "../../img/constructor/integer.svg?raw";
import phoneIcon from "../../img/constructor/Phone.svg?raw";
import timeIcon from "../../img/constructor/Time.svg?raw";
import sectionTitleIcon from "../../img/constructor/Title.svg?raw";

import {
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "../../entities/survey/model/defaultSurveyLogo";
import { normalizeSurveyQuestionNumbers } from "../../entities/survey/model/normalizeSurveyQuestionNumbers";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import {
  QUESTION_TYPE_DEFINITIONS,
  QUESTION_TYPES,
  registerCustomSurveyQuestionTypes,
  type SurveyQuestionType,
} from "../../entities/survey/model/surveyQuestionTypes";
import { sanitizeSurveySchema } from "../../entities/survey/model/surveySchemaSecurity";
import {
  DEFAULT_SURVEY_THEME,
  resolveBuilderDesignerTheme,
  resolveSurveyTheme,
  sanitizeSurveyTheme
} from "../../entities/survey/model/surveyTheme";
import type { SurveySchema } from "../../entities/survey/types";
import { creatorThemes } from "../../shared/theme/themeRegistry";
import { MOBILE_LAYOUT_QUERY } from "../../shared/ui/useMobileLayout";
import { updateBuilderPreviewBridge } from "./builderPreviewBridge";
import {
  BUILDER_PREVIEW_COMPONENT_NAME,
  BUILDER_PREVIEW_TAB_ID,
  registerBuilderPreviewTabComponent,
} from "./BuilderPreviewTab";


registerSurveyTheme(SurveyTheme);
registerCreatorTheme(...Object.values(creatorThemes));

type BuilderSchema = SurveySchema & {
  questionDescriptionLocation?: string;
};

type CreatorToolboxItem = {
  name: string;
  iconName: string;
  title: string;
  category: string;
  json: Record<string, unknown>;
  items?: CreatorToolboxItem[];
};

const builderDesignerSurveys = new WeakMap<SurveyCreator, Set<{ applyTheme: (theme: ITheme) => void }>>();

export function applyThemeToBuilderDesigners(creator: SurveyCreator) {
  const designerTheme = resolveBuilderDesignerTheme(creator.theme);
  builderDesignerSurveys.get(creator)?.forEach((survey) => survey.applyTheme(designerTheme));
}

export function enableThemePageTitleFontEditor(creator: SurveyCreator) {
  const pageTitleFontEditor = creator.themeEditor.propertyGrid.survey.getQuestionByName("pageTitle");

  if (pageTitleFontEditor) {
    pageTitleFontEditor.readOnly = false;
  }
}

export function configureCreatorLocalization() {
  surveyLocalization.defaultLocale = "ru";
  editorLocalization.currentLocale = "ru";
  const ruEditorStrings = editorLocalization.getLocaleStrings("ru");
  if (ruEditorStrings?.ed) {
    ruEditorStrings.ed.panelPlaceHolder = "Перетащите элемент с панели инструментов";
    ruEditorStrings.ed.panelPlaceHolderMobile = "Перетащите элемент с панели инструментов";
    ruEditorStrings.ed.pagePlaceHolder =
      "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
    ruEditorStrings.ed.pagePlaceHolderMobile =
      "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
  }
  if (ruEditorStrings?.qt) ruEditorStrings.qt.panel = "Раздел";
  if (ruEditorStrings?.tabs) {
    ruEditorStrings.tabs.designer = "\u041a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u043e\u0440";
    ruEditorStrings.tabs.preview = "\u041f\u0440\u0435\u0432\u044c\u044e";
    ruEditorStrings.tabs.logic = "\u041b\u043e\u0433\u0438\u043a\u0430 \u0444\u043e\u0440\u043c\u044b";
    ruEditorStrings.tabs.theme = "\u0422\u0435\u043c\u044b";
  }
}

export function configureCreatorToolbox(creator: SurveyCreator) {
  const toolbox = creator.toolbox;
  toolbox.showCategoryTitles = true;
  toolbox.clearItems();

  QUESTION_TYPE_DEFINITIONS.forEach((definition, index) => {
    const item: CreatorToolboxItem = {
      name: definition.name,
      iconName: definition.iconName,
      title: definition.title,
      category: definition.category,
      json: {
        type: definition.name,
        ...(definition.defaultQuestionTitle ? { title: definition.defaultQuestionTitle } : {}),
        ...(definition.name === "file" ? { allowMultiple: true } : {}),
      },
    };

    toolbox.addItem(item, index);
  });

  const textItem = toolbox.getItemByName("text") as
    | (ReturnType<typeof toolbox.getItemByName> & { items?: CreatorToolboxItem[]; clearSubitems?: () => void })
    | null;

  textItem?.clearSubitems?.();
  if (textItem) {
    textItem.items = [];
  }

  toolbox.categories.forEach((category) => {
    if (category.name === "basic") {
      category.title = "Базовые";
    }

    if (category.name === "advanced") {
      category.title = "Расширенные";
    }
  });
}

export function registerCustomIcons() {
  if (!SvgRegistry || typeof SvgRegistry.registerIconFromSvg !== "function") {
    return;
  }

  const registerSvgIcon = (iconName: string, iconSvg: string) => {
    SvgRegistry.registerIconFromSvg(iconName, iconSvg);
  };

  registerSvgIcon("icon-toolbox-phone-custom", phoneIcon);
  registerSvgIcon("icon-toolbox-email-custom", emailIcon);
  registerSvgIcon("icon-toolbox-float-custom", floatIcon);
  registerSvgIcon("icon-toolbox-integer-custom", integerIcon);
  registerSvgIcon("icon-toolbox-date-custom", dateIcon);
  registerSvgIcon("icon-toolbox-time-custom", timeIcon);
  registerSvgIcon("icon-toolbox-datetime-custom", dateTimeIcon);
  registerSvgIcon("icon-toolbox-sectiontitle-custom", sectionTitleIcon);
}

export function configureCreatorQuestionTypes() {
  registerCustomSurveyQuestionTypes();
  [
    ["text", "inputType"],
    ["survey", "showQuestionNumbers"],
    ["survey", "questionStartIndex"],
    ["survey", "questionTitlePattern"],
    ["question", "showNumber"],
    ["question", "hideNumber"],
    ["panel", "showNumber"],
    ["panel", "showQuestionNumbers"],
    ["paneldynamic", "showNumber"],
    ["paneldynamic", "showQuestionNumbers"],
  ].forEach(([typeName, propertyName]) => {
    const property = Serializer.getProperty(typeName, propertyName);
    if (property) {
      property.visible = false;
    }
  });
}

export function createCreatorInstance(
  formId: string | undefined,
  creatorTheme: ICreatorTheme,
  getSafeEditingMode: () => boolean,
) {
  if (!Serializer.getProperty("question", "integrationId")) {
    Serializer.addProperty("question", { name: "integrationId", visible: false });
  }
  configureCreatorLocalization();
  registerCustomIcons();
  configureCreatorQuestionTypes();
  const patchedDesignerSurveys = new WeakSet<object>();
  const htmlPatchedSurveys = new WeakSet<object>();
  const designerSurveys = new Set<{ applyTheme: (theme: ITheme) => void }>();

  const creator = new SurveyCreator({
    questionTypes: [...QUESTION_TYPES],
    showDesignerTab: true,
    showLogicTab: true,
    showPreviewTab: false,
    showJSONEditorTab: false,
    showTranslationTab: false,
    showThemeTab: true,
    showSaveButton: true,
    isAutoSave: false,
    showAddQuestionButton: false,
    showSurveyHeader: true,
    propertyGridNavigationMode: "accordion",
    showCreatorThemeSettings: false,
    previewAllowSimulateDevices: true,
    previewAllowSelectLanguage: false,
    previewAllowHiddenElements: false,
    previewAllowSelectPage: true,
    useElementTitles: true,
  });

  creator.locale = "ru";
  // Keep the add button compact and its type picker reachable on phones.
  creator.rememberLastQuestionType = false;
  creator.applyCreatorTheme(creatorTheme);
  creator.onSurveyInstanceCreated.add((_sender, options) => {
    if (["designer-tab", "preview-tab", "theme-tab"].includes(options.area) && !htmlPatchedSurveys.has(options.survey)) {
      htmlPatchedSurveys.add(options.survey);
      options.survey.onProcessHtml.add((_survey, htmlOptions) => {
        htmlOptions.html = sanitizeSurveyHtml(htmlOptions.html);
      });
    }
    if (options.area === "designer-tab" && !patchedDesignerSurveys.has(options.survey)) {
      patchedDesignerSurveys.add(options.survey);
      designerSurveys.add(options.survey);
      options.survey.applyTheme(resolveBuilderDesignerTheme(creator.theme));
    }
  });
  builderDesignerSurveys.set(creator, designerSurveys);
  creator.theme = resolveSurveyTheme(DEFAULT_SURVEY_THEME);
  creator.JSON = resolveDefaultSurveyLogo(createEmptyBuilderSchema());
  creator.allowCollapseSidebar = true;
  creator.showSidebar = !(window.matchMedia?.(MOBILE_LAYOUT_QUERY).matches ?? false);

  configureCreatorToolbox(creator);
  registerBuilderPreviewTab(creator, formId);

  creator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      const questionType = (options.question as { getType?: () => string }).getType?.();
      options.question.isRequired = questionType !== "sectiontitle" && questionType !== "expression" && !getSafeEditingMode();
      options.question.descriptionLocation = "underTitle";
      (options.question as { showNumber?: boolean }).showNumber = false;
      if (questionType === "panel" || questionType === "paneldynamic") {
        (options.question as { showQuestionNumbers?: string }).showQuestionNumbers = "off";
      }
    }
  });

  creator.onElementAllowOperations.add((_sender, options) => {
    const currentType = options.obj?.getType?.();

    options.allowChangeInputType = false;
    if (currentType === "sectiontitle") options.allowChangeRequired = false;
    if (!currentType) {
      return;
    }

    options.allowChangeType = QUESTION_TYPES.includes(currentType as SurveyQuestionType);
  });

  creator.onPropertyGetReadOnly.add((_sender, options) => {
    const propertyName = options.property?.name;
    const elementType = options.element?.getType?.();
    if (propertyName === "name" && elementType !== "survey") {
      options.readOnly = true;
    }
  });

  creator.onPropertyShowing.add((_sender, options) => {
    if (options.element?.getType?.() === "sectiontitle" && ["isRequired", "valueName", "defaultValue", "correctAnswer", "requiredIf", "validators"].includes(options.property.name)) {
      options.show = false;
    }
  });

  return creator;
}

export function cloneSchema(schema: SurveySchema): SurveySchema {
  return sanitizeSurveySchema(schema);
}

export function getSerializedBuilderSchema(creator: SurveyCreator): SurveySchema {
  return normalizeSurveyQuestionNumbers(
    serializeDefaultSurveyLogo(creator.JSON as SurveySchema),
  );
}

export function getRuntimePreviewSchema(creator: SurveyCreator): SurveySchema {
  return getSerializedBuilderSchema(creator);
}

export function updateRuntimePreviewBridgeFromCreator(creator: SurveyCreator, formId?: string) {
  updateBuilderPreviewBridge({
    previewSchema: getRuntimePreviewSchema(creator),
    previewTheme: sanitizeSurveyTheme(creator.theme),
    formId,
  });
}

export function applyThemeToCreatorAndEditor(creator: SurveyCreator, theme: ITheme) {
  creator.theme = theme;
  creator.themeEditor.themeModel.setTheme(theme);
}

export function registerBuilderPreviewTab(creator: SurveyCreator, formId?: string) {
  registerBuilderPreviewTabComponent();

  const syncPreview = () => {
    updateRuntimePreviewBridgeFromCreator(creator, formId);
  };
  const runtimePreviewPlugin: ICreatorPlugin = {
    model: creator,
    activate: syncPreview,
    update: syncPreview,
    deactivate: () => true,
  };

  creator.addPluginTab(
    BUILDER_PREVIEW_TAB_ID,
    runtimePreviewPlugin,
    "Превью",
    BUILDER_PREVIEW_COMPONENT_NAME,
    1,
  );
}

export function getSchemaTitle(schema: SurveySchema, fallbackTitle: string) {
  const normalizedTitle = schema.title?.trim();
  return normalizedTitle || fallbackTitle;
}

export function toBuilderSchema(schema: SurveySchema, fallbackTitle: string): BuilderSchema {
  const builderSchema = normalizeSurveyQuestionNumbers(cloneSchema(schema)) as BuilderSchema;

  return {
    ...builderSchema,
    title: getSchemaTitle(builderSchema, fallbackTitle),
    locale: builderSchema.locale ?? "ru",
    questionDescriptionLocation: builderSchema.questionDescriptionLocation ?? "underTitle",
  };
}

export function createEmptyBuilderSchema(title = "Новая форма") {
  return toBuilderSchema(createEmptySurveySchema(title), title);
}

