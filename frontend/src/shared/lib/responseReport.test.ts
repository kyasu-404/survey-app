import { describe, expect, it } from "vitest";
import type { EducationOrganization } from "../../entities/organization/types";
import type { SurveyResponse } from "../../entities/response/types";
import { createResponseReport } from "./responseReport";

const organizations: EducationOrganization[] = [
  {
    id: "org-1",
    organization_type: "school",
    number: "1",
    alias: "ГБОУ",
    email: "one@example.ru",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "org-2",
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
