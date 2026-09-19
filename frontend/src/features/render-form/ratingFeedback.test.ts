import { describe, expect, it } from "vitest";
import { Model, type QuestionRatingModel } from "survey-core";
import { installRatingFeedback } from "./ratingFeedback";

describe("rating feedback", () => {
  it("uses custom labels, handles zero, and refreshes feedback when a question remounts", () => {
    const model = new Model({ elements: [{ type: "rating", name: "score", rateType: "stars", rateValues: [
      { value: 0, text: "Плохо" }, { value: 1, text: "Хорошо" },
    ] }] });
    installRatingFeedback(model);
    const question = model.getQuestionByName("score") as QuestionRatingModel;
    const htmlElement = document.createElement("div");
    model.onAfterRenderQuestion.fire(model, { question, htmlElement });
    question.value = 0;
    expect(htmlElement.textContent).toBe("Выбрано: Плохо");
    model.onAfterRenderQuestion.fire(model, { question, htmlElement });
    question.value = 1;
    expect(htmlElement.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(htmlElement.textContent).toBe("Выбрано: Хорошо");
    question.clearValue();
    expect(htmlElement.textContent).toBe("Оценка не выбрана");
    model.dispose();
  });
});
