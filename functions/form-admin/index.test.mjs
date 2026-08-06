import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeSchemaCompatibility } from "./schemaCompatibility.mjs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

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
  assert.match(source, /172\\\.\(1\[6-9\]\|2\\d\|3\[0-1\]\)\\\./);
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

test("authorizes form deletion by requester ownership or admin role", () => {
  assert.match(source, /authClient\.auth\.getUser\(jwt\)/);
  assert.match(source, /\.from\("forms"\)\s*[\s\S]*?\.select\("id, author_id"\)/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
});

test("rejects disabled owners and administrators", () => {
  assert.match(source, /\.select\("role, is_disabled"\)/);
  assert.match(source, /requesterProfile\?\.is_disabled/);
});

test("removes storage objects before deleting the form row", () => {
  const removeIndex = source.indexOf("removeStorageObjectsForForm");
  const removeAssetsIndex = source.indexOf("removeSurveyAssetsForForm");
  const deleteMatch = source.match(/\.from\("forms"\)\s*\.delete\(\)/);

  assert.notEqual(removeIndex, -1);
  assert.notEqual(removeAssetsIndex, -1);
  assert.ok(deleteMatch);
  assert.ok(removeIndex < deleteMatch.index);
  assert.ok(removeAssetsIndex < deleteMatch.index);
  assert.match(source, /SURVEY_ASSETS_BUCKET/);
  assert.match(source, /\.from\("response_file_references"\)\s*\.select\("object_path"\)\s*\.eq\("form_id", formId\)/);
  assert.match(source, /removeStorageTree\(adminClient, surveyAssetsBucket, `forms\/\$\{formId\}`\)/);
  assert.match(source, /\.storage\.from\(bucketName\)\.remove\(batch\)/);
  assert.doesNotMatch(source, /\.schema\("storage"\)/);
});

test("offers an admin-only cleanup for stale unreferenced public uploads", () => {
  assert.match(source, /action: "cleanup-orphans"/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
  assert.match(source, /\.rpc\("list_orphan_survey_files"/);
  assert.match(source, /olderThanHours/);
  assert.match(source, /removeStaleDraftSurveyAssets/);
  assert.match(source, /listStorageEntries\(adminClient, surveyAssetsBucket, "forms"\)/);
  assert.match(source, /assetEntry\.created_at >= cutoff/);
  assert.match(source, /removedAssets/);
});

test("deletes only an exact unreferenced anonymous upload capability", () => {
  assert.match(source, /action: "delete-upload"/);
  assert.match(source, /isAnonymousUploadPath/);
  assert.match(source, /\.rpc\("is_survey_file_referenced"/);
  assert.match(source, /isReferenced !== false/);
  assert.match(source, /\.remove\(\[payload\.path\]\)/);
});

test("deletes selected responses only for the form owner or an admin and removes referenced files", () => {
  assert.match(source, /action: "delete-responses"/);
  assert.match(source, /getUniqueResponseIds/);
  assert.match(source, /value\.length > 100/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /\.from\("response_file_references"\)/);
  assert.match(source, /\.in\("response_id", existingResponseIds\)/);
  assert.match(source, /adminClient\.storage\.from\(storageBucket\)\.remove\(batch\)/);
  assert.match(source, /\.from\("responses"\)\s*\.delete\(\)/);
});

test("routes schema updates through an owner-authorized compatibility check", () => {
  assert.match(source, /action: "update-schema"/);
  assert.match(source, /analyzeSchemaCompatibility/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
  assert.match(source, /status: "confirmation_required"/);
  assert.match(source, /status: "blocked"/);
  assert.match(source, /\.eq\("responses_count", responsesCount\)/);
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
