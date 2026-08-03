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
        name: "organization",
        answeredCount: 1,
        missingCount: 1,
        values: [{ label: "ГБОУ 1", count: 1 }],
      }),
      expect.objectContaining({
        name: "approved",
        answeredCount: 2,
        values: expect.arrayContaining([
          { label: "Да", count: 1 },
          { label: "Нет", count: 1 },
        ]),
      }),
    ]));
    expect(report.organizationCoverage).toEqual(expect.objectContaining({
      expectedCount: 2,
      submittedCount: 1,
      missingOrganizations: [organizations[1]],
    }));
  });

  it("omits submission coverage when the form has no organization field", () => {
    const report = createResponseReport([], {
      pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }],
    }, organizations);
    expect(report.organizationCoverage).toBeNull();
  });
});
