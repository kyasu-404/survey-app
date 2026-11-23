import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeSchemaCompatibility } from "./schemaCompatibility.mjs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("draft restoration authorizes the browser capability before signing a private upload", () => {
  const restore = source.slice(source.indexOf('if (payload.action === "restore-upload")'), source.indexOf('if (payload.action === "delete-upload")'));
  assert.match(restore, /isUuid\(payload.browserId\)/);
  assert.match(restore, /isAnonymousUploadPath\(payload.path, payload.formId\)/);
  assert.match(restore, /rpc\("can_restore_survey_upload"/);
  assert.match(restore, /allowed !== true/);
  assert.match(restore, /isUuid\(payload\.personalToken\)/);
  assert.match(restore, /can_restore_personal_upload/);
  assert.match(restore, /allowed = personalAllowed === true/);
  assert.ok(restore.indexOf('allowed !== true') < restore.indexOf('createSignedUrl'));
  assert.match(restore, /createSignedUrl\(payload.path, 60\)/);
  assert.match(restore, /signedUrl.pathname \+ signedUrl.search/);
});

test("pins the Supabase client import to an exact version", () => {
  assert.match(source, /@supabase\/supabase-js@2\.\d+\.\d+/);
  assert.doesNotMatch(source, /@supabase\/supabase-js@2["']/);
});

test("uses an explicit CORS allowlist instead of wildcard origin", () => {
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(source, /FORM_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /Vary": "Origin"/);
  assert.match(source, /isOriginAllowed/);
  assert.match(source, /x-request-id/);
  assert.match(source, /traceparent/);
});

test("allows private-network development origins without wildcard CORS", () => {
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(source, /FORM_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /isDefaultLocalDevelopmentOrigin/);
  assert.match(source, /isPrivateNetworkHostname/);
  assert.match(source, /octets.length !== 4/);
  assert.match(source, /defaultAllowedDevelopmentPorts/);
});

test("logs request correlation context for form-admin actions", () => {
  assert.match(source, /createRequestLogContext/);
  assert.match(source, /requestId: req\.headers\.get\("x-request-id"\)/);
  assert.match(source, /traceparent: req\.headers\.get\("traceparent"\)/);
  assert.match(source, /release: req\.headers\.get\("x-client-release"\)/);
  assert.match(source, /console\.info\("form-admin action started"/);
  assert.match(source, /console\.error\("form-admin action failed"/);
});

test("delegates form deletion authorization to an atomic actor-aware RPC", () => {
  assert.match(source, /authClient\.auth\.getUser\(jwt\)/);
  assert.match(source, /\.rpc\("delete_form_with_files", \{\s*p_form_id: payload\.formId,\s*p_actor_id: requester\.id/);
});

test("rejects disabled owners and administrators", () => {
  assert.match(source, /\.select\("role, is_disabled"\)/);
  assert.match(source, /requesterProfile\?\.is_disabled/);
});

test("deletes database rows before best-effort storage cleanup", () => {
  const deleteIndex = source.lastIndexOf('.rpc("delete_form_with_files"');
  const removeIndex = source.lastIndexOf("removeStorageObjectPaths(adminClient, responseObjectPaths)");
  const removeAssetsIndex = source.lastIndexOf("removeSurveyAssetsForForm(");

  assert.notEqual(deleteIndex, -1);
  assert.ok(deleteIndex < removeIndex);
  assert.ok(deleteIndex < removeAssetsIndex);
  assert.match(source, /SURVEY_ASSETS_BUCKET/);
  assert.doesNotMatch(source, /listStorageObjectPathsForForm/);
  assert.match(source, /removeStorageTree\(adminClient, surveyAssetsBucket, `forms\/\$\{formId\}`\)/);
  assert.match(source, /\.storage\.from\(bucketName\)\.remove\(batch\)/);
  assert.doesNotMatch(source, /\.schema\("storage"\)/);
});

test("offers an admin-only cleanup for stale unreferenced public uploads", () => {
  assert.match(source, /action: "cleanup-orphans"/);
  assert.match(source, /action: "get-cleanup-status"/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
  assert.match(source, /storageCleanupRetentionHours = 7 \* 24/);
  assert.match(source, /\.rpc\("begin_storage_cleanup_run"/);
  assert.match(source, /"list_orphan_survey_files"/);
  assert.match(source, /"confirm_orphan_survey_files"/);
  assert.match(source, /"list_orphan_survey_assets"/);
  assert.match(source, /"confirm_orphan_survey_assets"/);
  assert.match(source, /\.rpc\("finish_storage_cleanup_run"/);
  assert.doesNotMatch(source, /olderThanHours/);
  assert.match(source, /removedAssets/);
});

test("deletes only an exact unreferenced anonymous upload capability", () => {
  assert.match(source, /action: "delete-upload"/);
  assert.match(source, /isAnonymousUploadPath/);
  assert.match(source, /\.rpc\("claim_survey_file_deletions"/);
  assert.match(source, /!claimedPaths\.includes\(payload\.path\)/);
  assert.match(source, /\.remove\(\[payload\.path\]\)/);
});

test("deletes selected responses only for the form owner or an admin and removes referenced files", () => {
  assert.match(source, /action: "delete-responses"/);
  assert.match(source, /getUniqueResponseIds/);
  assert.match(source, /value\.length > 100/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.doesNotMatch(source, /\.from\("response_file_references"\)/);
  assert.match(source, /\.rpc\("delete_form_responses_with_files"/);
  assert.match(source, /p_actor_id: requester\.id/);
  assert.match(source, /adminClient\.storage\.from\(storageBucket\)\.remove\(batch\)/);
  assert.doesNotMatch(source, /allReferences|existingResponseIds/);
  assert.match(source, /storage cleanup deferred/);
});

test("routes schema updates through an owner-authorized compatibility check", () => {
  assert.match(source, /action: "update-schema"/);
  assert.match(source, /analyzeSchemaCompatibility/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
  assert.match(source, /status: "confirmation_required"/);
  assert.match(source, /status: "blocked"/);
  assert.match(source, /\.eq\("responses_count", responsesCount\)/);
  assert.match(source, /\.eq\("revision", revision\)/);
  assert.match(source, /confirmWarnings/);
});

test("classifies safe display edits without warnings", () => {
  const previous = {
    title: "Старая форма",
    pages: [{
      name: "page1",
      elements: [{
        type: "radiogroup",
        name: "status",
        title: "Статус",
        choices: [{ value: "yes", text: "Да" }],
      }],
    }],
  };
  const next = {
    title: "Новая форма",
    pages: [{
      name: "page2",
      elements: [{
        type: "radiogroup",
        name: "status",
        title: "Текущий статус",
        choices: [{ value: "yes", text: "Подтверждаю" }],
      }],
    }],
  };

  const result = analyzeSchemaCompatibility(previous, next, ["school"], ["school"]);

  assert.equal(result.breakingChanges.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.safeChanges.some((message) => message.includes("отображаемый текст")));
});

test("warns for compatible additions and changed response behavior", () => {
  const previous = {
    pages: [{
      elements: [{ type: "text", name: "employee_count", title: "Количество" }],
    }],
  };
  const next = {
    pages: [{
      elements: [
        {
          type: "text",
          name: "employee_count",
          title: "Количество",
          isRequired: true,
          validators: [{ type: "numeric", minValue: 1 }],
          visibleIf: "{has_staff} = true",
        },
        { type: "text", name: "website", title: "Адрес сайта" },
      ],
    }],
  };

  const result = analyzeSchemaCompatibility(previous, next, ["school"], ["school", "odo"]);

  assert.equal(result.breakingChanges.length, 0);
  assert.ok(result.warnings.some((message) => message.includes("стал обязательным")));
  assert.ok(result.warnings.some((message) => message.includes("новый необязательный вопрос")));
  assert.ok(result.warnings.some((message) => message.includes("валидаторы")));
  assert.ok(result.warnings.some((message) => message.includes("условие видимости")));
  assert.ok(result.warnings.some((message) => message.includes("типов организаций")));
});

test("blocks incompatible question, choice, matrix, and duplicate-name changes", () => {
  const previous = {
    pages: [{
      elements: [
        {
          type: "text",
          inputType: "text",
          name: "employee_count",
          title: "Количество",
        },
        {
          type: "matrix",
          name: "services",
          title: "Услуги",
          rows: [{ value: "row-1", text: "Строка" }],
          columns: [{ value: "yes", text: "Да" }],
        },
      ],
    }],
  };
  const next = {
    pages: [{
      elements: [
        {
          type: "text",
          inputType: "number",
          name: "employee_count",
          title: "Количество",
        },
        {
          type: "matrix",
          name: "services",
          title: "Услуги",
          rows: [],
          columns: [{ value: "no", text: "Нет" }],
        },
        { type: "text", name: "employee_count", title: "Дубликат" },
        { type: "text", name: "required_new", title: "Новое", isRequired: true },
      ],
    }],
  };

  const result = analyzeSchemaCompatibility(previous, next);

  assert.ok(result.breakingChanges.some((message) => message.includes("формат ввода")));
  assert.ok(result.breakingChanges.some((message) => message.includes("строка матрицы")));
  assert.ok(result.breakingChanges.some((message) => message.includes("столбец матрицы")));
  assert.ok(result.breakingChanges.some((message) => message.includes("используется несколько раз")));
  assert.ok(result.breakingChanges.some((message) => message.includes("обязательный вопрос")));
});

test("allows matrix column labels but protects their technical names and types", () => {
  const previous = {
    pages: [{ elements: [{
      type: "matrixdropdown",
      name: "budget",
      title: "Бюджет",
      columns: [{ name: "amount", title: "Сумма", cellType: "text", inputType: "number" }],
    }] }],
  };
  const labelEdit = {
    pages: [{ elements: [{
      type: "matrixdropdown",
      name: "budget",
      title: "Бюджет",
      columns: [{ name: "amount", title: "Размер суммы", cellType: "text", inputType: "number" }],
    }] }],
  };
  const renamedColumn = {
    pages: [{ elements: [{
      type: "matrixdropdown",
      name: "budget",
      title: "Бюджет",
      columns: [{ name: "total", title: "Размер суммы", cellType: "dropdown" }],
    }] }],
  };

  const safeResult = analyzeSchemaCompatibility(previous, labelEdit);
  const breakingResult = analyzeSchemaCompatibility(previous, renamedColumn);

  assert.equal(safeResult.warnings.length, 0);
  assert.equal(safeResult.breakingChanges.length, 0);
  assert.ok(safeResult.safeChanges.some((message) => message.includes("отображаемый текст")));
  assert.ok(breakingResult.breakingChanges.some((message) => message.includes("столбец матрицы")));
});

const questionSchema = (question, survey = {}, page = {}) => ({
  ...survey, pages: [{ ...page, elements: [{ name: "q", type: "text", ...question }] }],
});

test("requires confirmation for changes to collection, validation, visibility and assignment rules", () => {
  const cases = [
    [{}, {}, { clearInvisibleValues: "onHidden" }],
    [{}, {}, { maxTextLength: 10 }],
    [{}, { clearIfInvisible: "onHiddenContainer" }],
    [{}, { resetValueIf: "{other} empty" }],
    [{}, { setValueIf: "{other} notempty", setValueExpression: "{other}" }],
    [{ type: "expression" }, { type: "expression", expression: "{other} + 1" }],
    [{}, { maskType: "pattern", maskSettings: { pattern: "999" } }],
    [{ type: "matrixdynamic" }, { type: "matrixdynamic", minRowCount: 2 }],
    [{ type: "checkbox", choices: ["a"] }, { type: "checkbox", choices: [{ value: "a", visibleIf: "{other} empty" }] }],
    [{ type: "multipletext", items: [{ name: "a" }] }, { type: "multipletext", items: [{ name: "a", validators: [{ type: "numeric" }] }] }],
    [{}, {}, {}, { visibleIf: "{other} = 1" }],
  ];
  for (const [before, after, survey, page] of cases) {
    const result = analyzeSchemaCompatibility(questionSchema(before), questionSchema(after, survey, page));
    assert.deepEqual(result.breakingChanges, []);
    assert.ok(result.warnings.length, JSON.stringify([after, survey, page]));
  }
});

test("blocks changes to saved answer representations, including nested fields", () => {
  const cases = [
    [{ type: "boolean" }, { type: "boolean", valueTrue: "yes" }],
    [{ type: "imagepicker" }, { type: "imagepicker", multiSelect: true }],
    [{ type: "checkbox" }, { type: "checkbox", valuePropertyName: "code" }],
    [{ type: "signaturepad" }, { type: "signaturepad", storeDataAsText: false }],
    [{ type: "dropdown", showOtherItem: true }, { type: "dropdown", showOtherItem: true }, { storeOthersAsComment: false }],
    [{ showCommentArea: true }, { showCommentArea: true }, { commentSuffix: "_note" }],
    [{ maskType: "pattern" }, { maskType: "pattern", maskSettings: { saveMaskedValue: true } }],
    [{ maskType: "pattern", maskSettings: { saveMaskedValue: true, pattern: "99-99" } },
      { maskType: "pattern", maskSettings: { saveMaskedValue: true, pattern: "(99)99" } }],
    [{}, { maskType: "numeric" }],
    [{ type: "matrix" }, { type: "matrix", cellType: "checkbox" }],
    [{ type: "checkbox", choices: ["a"] }, { type: "checkbox", choices: [{ value: "a", showCommentArea: true }] }],
    [{ type: "matrixdropdown", columns: [{ name: "col", cellType: "dropdown", choices: ["a"] }] },
      { type: "matrixdropdown", columns: [{ name: "col", cellType: "dropdown", choices: ["b"] }] }],
  ];
  for (const [before, after, survey] of cases) {
    assert.ok(analyzeSchemaCompatibility(questionSchema(before), questionSchema(after, survey)).breakingChanges.length,
      JSON.stringify([before, after, survey]));
  }
});

test("keeps equivalent storage defaults and presentation edits compatible", () => {
  const before = questionSchema({ type: "boolean" });
  const after = questionSchema({ type: "boolean", valueTrue: true, valueFalse: false, labelTrue: "Согласен" },
    { clearInvisibleValues: "onComplete", storeOthersAsComment: true, commentSuffix: "-Comment" });
  const result = analyzeSchemaCompatibility(before, after);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.breakingChanges, []);
});

test("distinguishes reordering from changing the scope of a stored answer", () => {
  const field = { type: "text", name: "field" };
  const repeated = { type: "paneldynamic", name: "entries", templateElements: [] };
  const schema = elements => ({ pages: [{ elements }] });
  const before = schema([field, repeated]);
  assert.deepEqual(analyzeSchemaCompatibility(before, schema([repeated, field])).breakingChanges, []);
  assert.ok(analyzeSchemaCompatibility(before, schema([{ ...repeated, templateElements: [field] }])).breakingChanges.length);
});

test("protects keys already used by saved questions and calculated values", () => {
  const before = questionSchema({ valueName: "answer" }, { calculatedValues: [{ name: "score", expression: "1", includeIntoResult: true }] });
  const collision = structuredClone(before);
  collision.pages[0].elements.push({ type: "text", name: "answer" });
  assert.ok(analyzeSchemaCompatibility(before, collision).breakingChanges.length);
  const removed = structuredClone(before);
  delete removed.calculatedValues[0].includeIntoResult;
  assert.ok(analyzeSchemaCompatibility(before, removed).breakingChanges.length);
});

test("protects nested choice questions and matrix details just like ordinary fields", () => {
  for (const field of ["choices", "detailElements"]) {
    const details = field === "choices"
      ? { type: "radiogroup", choices: [{ value: "a", elements: [{ type: "text", name: "detail" }] }] }
      : { type: "matrixdynamic", detailElements: [{ type: "text", name: "detail" }] };
    const before = questionSchema(details);
    const after = structuredClone(before);
    const q = after.pages[0].elements[0];
    (field === "choices" ? q.choices[0].elements : q.detailElements)[0].valueName = "renamed";
    assert.ok(analyzeSchemaCompatibility(before, after).breakingChanges.length, field);
  }
});

test("retains the original storage policy for inherited phone masks", () => {
  const before = questionSchema({ type: "phone" });
  const after = questionSchema({ type: "phone", maskSettings: { pattern: "+7(999)-999-99-99" } });
  assert.ok(analyzeSchemaCompatibility(before, after).breakingChanges.length);
  after.pages[0].elements[0].maskSettings.saveMaskedValue = true;
  assert.deepEqual(analyzeSchemaCompatibility(before, after).breakingChanges, []);
});

test("protects calculated and comment keys from conflicting new fields", () => {
  const before = questionSchema({ showCommentArea: true }, { calculatedValues: [{ name: "score", expression: "1", includeIntoResult: true }] });
  for (const name of ["score", "q-Comment"]) {
    const after = structuredClone(before);
    after.pages[0].elements.push({ type: "text", name });
    assert.ok(analyzeSchemaCompatibility(before, after).breakingChanges.length, name);
  }
});

test("compares legacy question containers and rejects conflicting element lists", () => {
  const before = { pages: [{ questions: [{ name: "q", type: "text" }] }] };
  assert.ok(analyzeSchemaCompatibility(before, questionSchema({ type: "boolean" })).breakingChanges.length);
  const mixed = { ...questionSchema({}), elements: [] };
  assert.throws(() => analyzeSchemaCompatibility(questionSchema({}), mixed));
});

test("adding the first commented checkbox choice changes the format of existing selections", () => {
  const before = questionSchema({ type: "checkbox", choices: ["a"] });
  const after = questionSchema({ type: "checkbox", choices: ["a", { value: "b", showCommentArea: true }] });
  assert.ok(analyzeSchemaCompatibility(before, after).breakingChanges.length);
});

test("tracks scoped names inside distinct or nested dynamic panels, container rules, and file storage mode", () => {
  const twoPanels = {
    pages: [{
      elements: [
        { type: "paneldynamic", name: "a", templateElements: [{ type: "text", name: "note" }] },
        { type: "paneldynamic", name: "b", templateElements: [{ type: "text", name: "note" }] },
      ],
    }],
  };
  assert.deepEqual(analyzeSchemaCompatibility(twoPanels, twoPanels).breakingChanges, []);

  const changedPanelB = structuredClone(twoPanels);
  changedPanelB.pages[0].elements[1].templateElements[0].type = "boolean";
  assert.ok(analyzeSchemaCompatibility(twoPanels, changedPanelB).breakingChanges.length > 0);

  const visibleChanged = structuredClone(twoPanels);
  visibleChanged.pages[0].elements[0].visibleIf = "{flag} = true";
  assert.ok(analyzeSchemaCompatibility(twoPanels, visibleChanged).warnings.length > 0);

  const fileBefore = questionSchema({ type: "file", storeDataAsText: false });
  const fileAfter = questionSchema({ type: "file", storeDataAsText: true });
  assert.ok(analyzeSchemaCompatibility(fileBefore, fileAfter).breakingChanges.length > 0);
});
