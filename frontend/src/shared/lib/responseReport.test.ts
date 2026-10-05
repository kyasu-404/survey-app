import { describe, expect, it } from "vitest";
import type { EducationOrganization } from "../../entities/organization/types";
import type { SurveyResponse } from "../../entities/response/types";
import type { SurveyQuestion } from "../../entities/survey/types";
import { formatResponsesForTable } from "./responsesExport";
import { createResponseReport } from "./responseReport";

const organizations: EducationOrganization[] = [
  {
    id: "org-1",
    is_archived: false,
    organization_type: "school",
    number: "1",
    alias: "ГБОУ",
    email: "one@example.ru",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "org-2",
    is_archived: false,
    organization_type: "kindergarten",
    number: "2",
    alias: "ГБДОУ",
    email: "two@example.ru",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
];

const responses: SurveyResponse[] = [
  {
    id: "response-1",
    form_id: "form-1",
    data: { organization: "org-1", approved: true, comment: "Готово" },
    created_at: "2026-08-03T12:00:00.000Z",
  },
  {
    id: "response-2",
    form_id: "form-1",
    data: { approved: false },
    created_at: "2026-08-03T13:00:00.000Z",
  },
];

describe("createResponseReport", () => {
  it.each(["matrixdropdown", "matrixdynamic"])("keeps raw numeric %s cells for statistics while exporting comments", (type) => {
    const question = {
      type, name: "matrix", rows: ["row"],
      columns: [
        { name: "score", cellType: "text", inputType: "number", showCommentArea: true },
        { name: "choice", cellType: "dropdown", choices: [{ value: 10, text: "Десять" }, { value: 20, text: "Двадцать" }], showCommentArea: true },
      ],
    } as unknown as SurveyQuestion;
    const schema = { commentSuffix: "_note", pages: [{ elements: [question] }] };
    const numericResponses: SurveyResponse[] = [10, 20].map(score => ({
      id: String(score), form_id: "form", created_at: "2026-10-05T00:00:00Z",
      data: { matrix: type === "matrixdynamic"
        ? [{ score, score_note: "Пояснение", choice: score, choice_note: "Выбор" }]
        : { row: { score, score_note: "Пояснение", choice: score, choice_note: "Выбор" } } },
    }));
    numericResponses.push({
      id: "comment-only", form_id: "form", created_at: "2026-10-05T00:00:00Z",
      data: { matrix: type === "matrixdynamic"
        ? [{ score: null, score_note: "Без числа" }]
        : { row: { score: null, score_note: "Без числа" } } },
    });
    const groups = createResponseReport(numericResponses, schema).questionReports[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].metrics).toEqual([{ label: "Среднее", value: "15" }, { label: "Медиана", value: "15" }]);
    expect(groups[0].values).toEqual([{ label: "10", count: 1, percentage: 50 }, { label: "20", count: 1, percentage: 50 }]);
    expect(groups[1].metrics).toEqual([{ label: "Ответов", value: "2" }]);
    expect(groups[1].values).toContainEqual({ label: "Десять\nКомментарий: Выбор", count: 1, percentage: 50 });
    expect(formatResponsesForTable(numericResponses, schema).rows[0]["answer:matrix"]).toMatch(/10\n\s*Комментарий: Пояснение/);
  });

  it("calculates question completion, distributions and organizations that did not submit", () => {
    const report = createResponseReport(responses, {
      pages: [{
        elements: [
          { type: "organization", name: "organization", title: "Организация" },
          { type: "boolean", name: "approved", title: "Согласовано" },
          { type: "comment", name: "comment", title: "Комментарий" },
        ],
      }],
    }, organizations);

    expect(report.totalResponses).toBe(2);
    expect(report.questionReports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "approved",
        kind: "single-choice",
        answeredCount: 2,
        values: expect.arrayContaining([
          { label: "Да", count: 1, percentage: 50 },
          { label: "Нет", count: 1, percentage: 50 },
        ]),
      }),
    ]));
    expect(report.questionReports.some((question) => question.type === "organization")).toBe(false);
    expect(report.organizationCoverage).toEqual(expect.objectContaining({
      expectedCount: 2,
      submittedCount: 1,
      submittedOrganizations: [organizations[0]],
      missingOrganizations: [organizations[1]],
    }));
  });

  it("omits submission coverage when the form has no organization field", () => {
    const report = createResponseReport([], {
      pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }],
    }, organizations);
    expect(report.organizationCoverage).toBeNull();
  });

  it("counts organizations at their nested valueName paths and ignores root lookalikes", () => {
    const report = createResponseReport([{
      ...responses[0], data: { institution: "org-2", records: [{ institution: "org-1" }, { institution: "org-1" }] },
    }], { pages: [{ elements: [{
      type: "paneldynamic", name: "entries", valueName: "records", templateElements: [{
        type: "panel", name: "details", elements: [{ type: "organization", name: "org", valueName: "institution" }],
      }],
    }] }] }, organizations);
    expect(report.questionReports).toEqual([]);
    expect(report.organizationCoverage).toMatchObject({
      submittedCount: 1, submittedOrganizations: [organizations[0]], missingOrganizations: [organizations[1]],
    });
  });

  it("builds different analytics for numeric, date, ranking, matrix and attachment questions", () => {
    const typedResponses: SurveyResponse[] = [
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-08-03T12:00:00.000Z",
        data: {
          score: 2,
          eventDate: "2026-08-01",
          priorities: ["quality", "speed"],
          matrix: { row1: "yes" },
          files: [{ name: "one.pdf" }, { name: "two.pdf" }],
        },
      },
      {
        id: "response-2",
        form_id: "form-1",
        created_at: "2026-08-03T13:00:00.000Z",
        data: {
          score: 4,
          eventDate: "2026-08-03",
          priorities: ["speed", "quality"],
          matrix: { row1: "no" },
          files: [{ name: "three.pdf" }],
        },
      },
    ];
    const report = createResponseReport(typedResponses, {
      pages: [{
        elements: [
          { type: "number", name: "score", title: "Баллы" },
          { type: "date", name: "eventDate", title: "Дата" },
          {
            type: "ranking",
            name: "priorities",
            title: "Приоритеты",
            choices: [
              { value: "quality", text: "Качество" },
              { value: "speed", text: "Скорость" },
            ],
          },
          {
            type: "matrix",
            name: "matrix",
            title: "Матрица",
            rows: [{ value: "row1", text: "Строка 1" }],
            columns: ["yes", "no"],
          } as never,
          { type: "file", name: "files", title: "Файлы" },
        ],
      }],
    });

    expect(report.questionReports.find((question) => question.name === "score")).toMatchObject({
      kind: "numeric",
      metrics: expect.arrayContaining([
        { label: "Среднее", value: "3" },
        { label: "Медиана", value: "3" },
      ]),
    });
    expect(report.questionReports.find((question) => question.name === "eventDate")).toMatchObject({
      kind: "date",
      metrics: expect.arrayContaining([
        { label: "Самая ранняя", value: "01.08.2026" },
        { label: "Самая поздняя", value: "03.08.2026" },
      ]),
    });
    expect(report.questionReports.find((question) => question.name === "priorities")).toMatchObject({
      kind: "ranking",
      groups: expect.arrayContaining([
        expect.objectContaining({ label: "Качество" }),
        expect.objectContaining({ label: "Скорость" }),
      ]),
    });
    expect(report.questionReports.find((question) => question.name === "matrix")).toMatchObject({
      kind: "matrix",
      groups: [expect.objectContaining({ label: "Строка 1" })],
    });
    expect(report.questionReports.find((question) => question.name === "files")).toMatchObject({
      kind: "attachment",
      metrics: expect.arrayContaining([{ label: "Прикреплено файлов", value: "3" }]),
    });
  });
});
