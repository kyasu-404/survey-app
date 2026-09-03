import { describe, expect, it } from "vitest";
import {
  getOrganizationDisplayName,
  getOrganizationQuestionNames,
  normalizeOrganizationInput,
  normalizeOrganizationTypes,
  validateOrganizationInput,
} from "./model";

describe("organization model", () => {
  it("finds protected organization questions in nested survey schemas", () => {
    expect(getOrganizationQuestionNames({
      pages: [{
        elements: [{
          type: "paneldynamic",
          name: "panel",
          templateElements: [{ type: "organization", name: "organization", title: "Организация" }],
        }],
      }],
    })).toEqual(["organization"]);
  });

  it("uses school and kindergarten defaults and removes invalid form settings", () => {
    expect(normalizeOrganizationTypes(undefined)).toEqual(["school", "kindergarten"]);
    expect(normalizeOrganizationTypes(["school", "school", "bad", "udod"])).toEqual(["school", "udod"]);
  });

  it("never stores a number for UDOD and validates other organization numbers", () => {
    const udod = normalizeOrganizationInput({
      organization_type: "udod",
      number: "42",
      alias: "  ДДТ  ",
      email: " INFO@EXAMPLE.RU ",
    });
    expect(udod).toEqual({
      organization_type: "udod",
      number: null,
      alias: "ДДТ",
      email: "info@example.ru",
    });
    expect(validateOrganizationInput(udod)).toBeNull();
    expect(validateOrganizationInput({
      organization_type: "school",
      number: null,
      alias: "ГБОУ",
      email: "school@example.ru",
    })).toBe("Укажите номер организации");
  });

  it("formats dropdown labels as alias and number", () => {
    expect(getOrganizationDisplayName({ alias: "ГБОУ", number: "123" })).toBe("ГБОУ 123");
    expect(getOrganizationDisplayName({ alias: "ДДТ", number: null })).toBe("ДДТ");
  });
});
