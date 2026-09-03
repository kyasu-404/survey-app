import { describe, expect, it } from "vitest";
import type { Model } from "survey-core";
import { applyOrganizationChoicesToSurvey } from "./surveyQuestion";

describe("applyOrganizationChoicesToSurvey", () => {
  it("fills only protected organization dropdowns with directory labels", () => {
    const organizationContent = { choices: [] as Array<{ value: string; text: string }> };
    const regularContent = { choices: [{ value: "keep", text: "Keep" }] };
    const model = {
      getAllQuestions: () => [
        { getType: () => "organization", contentQuestion: organizationContent },
        { getType: () => "dropdown", contentQuestion: regularContent },
      ],
    } as unknown as Model;

    applyOrganizationChoicesToSurvey(model, [
      { id: "school-1", organization_type: "school", number: "123", alias: "ГБОУ" },
      { id: "udod-1", organization_type: "udod", number: null, alias: "ДДТ" },
    ]);

    expect(organizationContent.choices).toEqual([
      { value: "school-1", text: "ГБОУ 123" },
      { value: "udod-1", text: "ДДТ" },
    ]);
    expect(regularContent.choices).toEqual([{ value: "keep", text: "Keep" }]);
  });
});
