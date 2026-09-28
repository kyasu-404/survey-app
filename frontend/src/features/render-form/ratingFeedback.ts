import { QuestionRatingModel, type Model } from "survey-core";

function getRatingFeedback(question: QuestionRatingModel) {
  if (question.isEmpty()) return "Оценка не выбрана";

  const choices = question.visibleRateValues;
  const selected = choices.find((choice) => choice.value === question.value);
  if (!selected) return "Оценка не выбрана";

  const isNumberedScale = choices.every((choice, index) => choice.value === index + 1 && choice.text === String(choice.value));
  return isNumberedScale
    ? `Выбрано: ${selected.text} из ${choices.length}`
    : `Выбрано: ${selected.text}`;
}

export function installRatingFeedback(model: Model) {
  model.onAfterRenderQuestion.add((_sender, { question, htmlElement }) => {
    if (question.getType() !== "rating") return;
    const rating = question as QuestionRatingModel;
    if (rating.rateType !== "stars" && rating.rateType !== "smileys") return;

    const container = htmlElement.querySelector(".sd-question__content") ?? htmlElement;
    const feedback = document.createElement("div");
    feedback.className = "survey-rating-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-atomic", "true");
    container.querySelector(".survey-rating-feedback")?.remove();
    container.append(feedback);

    const update = () => {
      feedback.textContent = getRatingFeedback(rating);
      if (rating.rateType !== "smileys" || !rating.isReadOnly) return;
      // SurveyJS suppresses scale colors in read-only mode. Use its public color
      // calculation on a detached editable copy, keeping the real answer locked.
      const display = new QuestionRatingModel(rating.name);
      display.fromJSON(rating.toJSON());
      display.readOnly = false;
      const index = display.visibleRateValues.findIndex(item => item.value === rating.value);
      const color = index >= 0 ? display.getItemStyle(display.renderedRateItems[index])["--sd-rating-item-color"] : null;
      if (color) htmlElement.style.setProperty("--survey-rating-saved-color", color);
      display.dispose();
    };
    rating.registerPropertyChangedHandlers(["value"], update, "survey-rating-feedback");
    update();
  });
}
