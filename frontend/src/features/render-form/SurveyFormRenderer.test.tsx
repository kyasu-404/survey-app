import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const {
  componentCollectionAdd,
  componentCollectionGetByName,
  createdModels,
  createdModelSchemas,
  downloadEventsDuringDataAssignment,
  includeUIStateEvent,
  mutateAsync,
  updateMutateAsync,
  registeredCustomQuestionTypes,
  getStoragePathFromSurveyFileValue,
  getStoragePathsFromResponseData,
  removeFileFromStorage,
  resolveSurveyFileValueContent,
  uploadFileToStorage,
  showToast,
} = vi.hoisted(() => {
  const registeredCustomQuestionTypes = new Set<string>();
  const componentCollectionAdd = vi.fn((definition: { name: string }) => {
    registeredCustomQuestionTypes.add(definition.name);
  });
  const componentCollectionGetByName = vi.fn((name: string) =>
    registeredCustomQuestionTypes.has(name) ? { name } : undefined,
  );

  return {
    componentCollectionAdd,
    componentCollectionGetByName,
    createdModels: [] as Array<Record<string, unknown>>,
    createdModelSchemas: [] as Array<Record<string, unknown>>,
    downloadEventsDuringDataAssignment: [] as unknown[],
    includeUIStateEvent: { current: true },
    mutateAsync: vi.fn().mockRejectedValue(new Error("api failed")),
    updateMutateAsync: vi.fn().mockRejectedValue(new Error("api failed")),
    registeredCustomQuestionTypes,
    getStoragePathFromSurveyFileValue: vi.fn(),
    getStoragePathsFromResponseData: vi.fn(() => []),
    removeFileFromStorage: vi.fn(),
    resolveSurveyFileValueContent: vi.fn(),
    uploadFileToStorage: vi.fn(),
    showToast: vi.fn(),
  };
});

class FakeSurveyEvent<T = unknown> {
  private handlers: Array<(sender: T, options: unknown) => void | Promise<void>> = [];

  add(handler: (sender: T, options: unknown) => void | Promise<void>) {
    this.handlers.push(handler);
  }

  remove(handler: (sender: T, options: unknown) => void | Promise<void>) {
    this.handlers = this.handlers.filter((item) => item !== handler);
  }

  async fire(sender: T, options?: unknown) {
    await Promise.all(this.handlers.map((handler) => handler(sender, options)));
  }
}

vi.mock("survey-core", () => ({
  ComponentCollection: {
    Instance: {
      add: componentCollectionAdd,
      getCustomQuestionByName: componentCollectionGetByName,
    },
  },
  surveyLocalization: {
    defaultLocale: "en",
  },
  Model: class {
    locale = "ru";
    completeText = "";
    completedHtml = "";
    private dataValue: Record<string, unknown> = {};
    fitToContainer = true;
    readOnly = false;
    showCompleteButton = true;
    showNavigationButtons = true;
    currentPageNo = 0;
    uiState: Record<string, unknown> = {};
    questionNames: string[] = [];
    schema: Record<string, unknown> & { pages?: Array<{ elements?: Array<{ type: string; name: string }> }> };
    onCompleting = new FakeSurveyEvent();
    onUploadFiles = new FakeSurveyEvent();
    onDownloadFile = new FakeSurveyEvent();
    onClearFiles = new FakeSurveyEvent();
    onOpenDropdownMenu = new FakeSurveyEvent();
    onProcessHtml = new FakeSurveyEvent();
    onNavigateToUrl = new FakeSurveyEvent();
    onValueChanged = new FakeSurveyEvent();
    onCurrentPageChanged = new FakeSurveyEvent();
    onUIStateChanged = includeUIStateEvent.current ? new FakeSurveyEvent() : undefined;
    doComplete = vi.fn();
    clear = vi.fn();
    applyTheme = vi.fn();

    constructor(schema: Record<string, unknown> & { pages?: Array<{ elements?: Array<{ type: string; name: string }> }> }) {
      this.schema = schema;
      createdModels.push(this as unknown as Record<string, unknown>);
      createdModelSchemas.push(schema);
      const builtInQuestionTypes = new Set(["text", "comment", "radiogroup", "checkbox", "dropdown"]);
      this.questionNames =
        schema.pages?.flatMap((page) =>
          (page.elements ?? [])
            .filter((question) => builtInQuestionTypes.has(question.type) || registeredCustomQuestionTypes.has(question.type))
            .map((question) => question.name),
        ) ?? [];
    }

    get data() {
      return this.dataValue;
    }

    set data(nextData: Record<string, unknown>) {
      this.dataValue = nextData;
      const fileQuestionNames =
        this.schema.pages?.flatMap((page) =>
          (page.elements ?? []).filter((question) => question.type === "file").map((question) => question.name),
        ) ?? [];

      fileQuestionNames.forEach((questionName) => {
        const value = nextData[questionName];
        const fileValues = Array.isArray(value) ? value : value ? [value] : [];
        fileValues.forEach((fileValue) => {
          void this.onDownloadFile.fire(this, {
            fileValue,
            callback: (_status: string, data: unknown) => {
              downloadEventsDuringDataAssignment.push(data);
            },
          });
        });
      });
    }
  },
}));

vi.mock("survey-react-ui", () => ({
  Survey: ({
    model,
  }: {
    model: {
      completeText: string;
      completedHtml: string;
      data: Record<string, unknown>;
      questionNames: string[];
      showCompleteButton: boolean;
      showNavigationButtons: boolean;
      onCompleting: { fire: (arg: unknown, options: unknown) => Promise<void> };
    };
  }) => {
    const [isCompleted, setIsCompleted] = useState(false);

    if (isCompleted) {
      return <div data-testid="survey-complete-page" dangerouslySetInnerHTML={{ __html: model.completedHtml }} />;
    }

    return (
      <div>
      <div data-testid="survey-question-names">{model.questionNames.join(",")}</div>
      <div className="sd-body__navigation">
        {model.showNavigationButtons && <button className="sd-navigation__prev-btn">Назад</button>}
        {model.showNavigationButtons && <button className="sd-navigation__next-btn">Далее</button>}
        {model.showCompleteButton && (
          <button
            className="sd-btn sd-btn--action"
            onClick={async () => {
              model.data = { email: "a@b.com" };
              const options = { allowComplete: true, allow: true };
              await model.onCompleting.fire(model, options);
              if (options.allowComplete && options.allow) {
                setIsCompleted(true);
              }
            }}
          >
            {model.completeText || "Отправить"}
          </button>
        )}
      </div>
      </div>
    );
  },
}));

vi.mock("../submit-response/useSubmitResponse", () => ({
  useSubmitResponseMutation: () => ({
    mutateAsync,
  }),
  useUpdateResponseMutation: () => ({
    mutateAsync: updateMutateAsync,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../shared/api/storage", () => ({
  getStoragePathFromSurveyFileValue,
  getStoragePathsFromResponseData,
  removeFileFromStorage,
  resolveSurveyFileValueContent,
  uploadFileToStorage,
}));

describe("SurveyFormRenderer", () => {
  beforeEach(() => {
    createdModels.length = 0;
    createdModelSchemas.length = 0;
    downloadEventsDuringDataAssignment.length = 0;
    registeredCustomQuestionTypes.clear();
    showToast.mockClear();
    mutateAsync.mockClear();
    updateMutateAsync.mockClear();
    componentCollectionAdd.mockClear();
    componentCollectionGetByName.mockClear();
    getStoragePathFromSurveyFileValue.mockReset();
    getStoragePathsFromResponseData.mockReset();
    getStoragePathsFromResponseData.mockReturnValue([]);
    removeFileFromStorage.mockReset();
    resolveSurveyFileValueContent.mockReset();
    uploadFileToStorage.mockReset();
    mutateAsync.mockRejectedValue(new Error("api failed"));
    includeUIStateEvent.current = true;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shows error toast when API submission fails", async () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });

  it("shows the server duplicate message and edits the saved browser response when allowed", async () => {
    mutateAsync.mockResolvedValueOnce({
      status: "already_submitted",
      responseId: "response-1",
      data: { email: "saved@example.com" },
      editable: true,
    });
    updateMutateAsync.mockResolvedValueOnce({
      responseId: "response-1",
      data: { email: "a@b.com" },
    });

    render(
      <SurveyFormRenderer
        formId="form-1"
        allowResponseEditing
        schema={{ pages: [{ elements: [{ type: "text", name: "email" }] }] }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Вы уже отправляли ответ на эту форму.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Редактировать" }));

    expect(createdModels[0]).toMatchObject({ data: { email: "saved@example.com" } });
    await userEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        responseId: "response-1",
        data: { email: "a@b.com" },
      }));
    });
    expect(await screen.findByText("Спасибо за Ваш ответ!")).toBeInTheDocument();
  });

  it("shows the completion message after the first successful submission", async () => {
    mutateAsync.mockResolvedValueOnce({
      status: "submitted",
      responseId: "response-1",
      data: { email: "a@b.com" },
      editable: true,
    });

    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} allowResponseEditing />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Спасибо за Ваш ответ!")).toBeInTheDocument();
    expect(createdModels[0]).toMatchObject({ showCompletePage: true });
    expect(screen.queryByText("Вы уже отправляли ответ на эту форму.")).not.toBeInTheDocument();
  });

  it("shows an existing response before the form and only offers editing when enabled", async () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        allowResponseEditing
        existingResponse={{
          responseId: "response-1",
          data: { email: "saved@example.com" },
          editable: true,
        }}
        schema={{ pages: [{ elements: [{ type: "text", name: "email" }] }] }}
      />,
    );

    expect(screen.getByText("Вы уже отправляли ответ на эту форму.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Редактировать" }));

    expect(createdModels[0]).toMatchObject({ data: { email: "saved@example.com" } });
    expect(screen.getByRole("button", { name: "Сохранить изменения" })).toBeInTheDocument();
  });

  it("does not show editing for an existing response when response editing is disabled", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        existingResponse={{ responseId: "response-1", data: {}, editable: false }}
        schema={{ pages: [] }}
      />,
    );

    expect(screen.getByText("Вы уже отправляли ответ на эту форму.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Редактировать" })).not.toBeInTheDocument();
  });

  it("keeps interactive mode editable with submit and draft side effects enabled", async () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        renderMode="interactive"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      readOnly: boolean;
      showCompleteButton: boolean;
      showNavigationButtons: boolean;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
      onCompleting: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };

    expect(model.readOnly).toBe(false);
    expect(model.showNavigationButtons).toBe(true);
    expect(model.showCompleteButton).toBe(true);

    model.data = { email: "draft@example.com" };
    await model.onValueChanged.fire(model);

    expect(JSON.parse(window.sessionStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}")).toMatchObject({
      data: { email: "draft@example.com" },
      submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });

    await model.onCompleting.fire(model, { allowComplete: true, allow: true });

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      formId: "form-1",
      submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
  });

  it("renders dashboard preview mode with navigation buttons but without submit or draft side effects", async () => {
    window.sessionStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "saved@example.com" },
        currentPageNo: 1,
        updatedAt: new Date().toISOString(),
      }),
    );

    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        renderMode="preview-navigable"
        initialData={{ email: "response@example.com" }}
        initialPageNo={1}
        schema={{
          pages: [
            { name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] },
            { name: "page2", elements: [{ type: "text", name: "name", title: "Имя" }] },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      readOnly: boolean;
      showCompleteButton: boolean;
      showNavigationButtons: boolean;
      currentPageNo: number;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
      onCompleting: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };

    expect(model.data).toEqual({ email: "response@example.com" });
    expect(model.currentPageNo).toBe(1);
    expect(model.readOnly).toBe(true);
    expect(model.showNavigationButtons).toBe(true);
    expect(model.showCompleteButton).toBe(true);
    expect(screen.getByRole("button", { name: "Далее" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить" })).toBeInTheDocument();

    model.data = { email: "changed@example.com" };
    await model.onValueChanged.fire(model);
    await userEvent.click(screen.getByRole("button", { name: "Завершить" }));

    expect(window.sessionStorage.getItem("survey-response:draft:user-1:form-1")).toContain("saved@example.com");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("renders builder preview like an editable respondent form without submit or draft side effects", async () => {
    render(
      <SurveyFormRenderer
        formId="__builder_preview__"
        renderMode="preview-interactive"
        schema={{
          pages: [
            { name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] },
            { name: "page2", elements: [{ type: "text", name: "name", title: "Имя" }] },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      readOnly: boolean;
      showCompleteButton: boolean;
      showNavigationButtons: boolean;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
    };

    expect(model).toMatchObject({
      readOnly: false,
      showNavigationButtons: true,
      showCompleteButton: true,
    });
    expect(screen.getByRole("button", { name: "Далее" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeInTheDocument();

    model.data = { email: "preview@example.com" };
    await model.onValueChanged.fire(model);
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps readonly navigable previews without a complete button", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        renderMode="readonly-navigable"
        schema={{
          pages: [
            { name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] },
            { name: "page2", elements: [{ type: "text", name: "name", title: "Имя" }] },
          ],
        }}
      />,
    );

    expect(createdModels[0]).toMatchObject({
      readOnly: true,
      showNavigationButtons: true,
      showCompleteButton: false,
    });
    expect(screen.getByRole("button", { name: "Далее" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Завершить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить" })).not.toBeInTheDocument();
  });

  it("keeps legacy isPreview compatible with dashboard preview mode", () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} isPreview />);

    expect(createdModels[0]).toMatchObject({
      readOnly: true,
      showNavigationButtons: true,
      showCompleteButton: true,
    });
    expect(screen.getByRole("button", { name: "Завершить" })).toBeInTheDocument();
  });

  it("renders readonly static previews on the first page without navigation or submit", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        renderMode="readonly-static"
        initialPageNo={2}
        schema={{
          pages: [
            { name: "page1", elements: [] },
            { name: "page2", elements: [] },
            { name: "page3", elements: [] },
          ],
        }}
      />,
    );

    expect(createdModels[0]).toMatchObject({
      readOnly: true,
      showNavigationButtons: false,
      showCompleteButton: false,
      currentPageNo: 0,
    });
  });

  it("keeps file download callbacks available in readonly navigable previews", async () => {
    const callback = vi.fn();
    resolveSurveyFileValueContent.mockResolvedValue("file-content");

    render(
      <SurveyFormRenderer
        formId="form-1"
        renderMode="readonly-navigable"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "file", name: "attachment", title: "Файл" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      onDownloadFile: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };

    await model.onDownloadFile.fire(model, { fileValue: { content: "public/form-1/file.txt" }, callback });

    expect(resolveSurveyFileValueContent).toHaveBeenCalledWith({ content: "public/form-1/file.txt" });
    expect(callback).toHaveBeenCalledWith("success", "file-content");
  });

  it("registers file download callbacks before loading initial response data", async () => {
    resolveSurveyFileValueContent.mockResolvedValue("data:application/octet-stream;base64,UEsDBA==");

    render(
      <SurveyFormRenderer
        formId="form-1"
        renderMode="readonly-navigable"
        initialData={{
          attachment: [{ name: "answer.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: "public/form-1/file.xlsx" }],
        }}
        schema={{
          pages: [{ name: "page1", elements: [{ type: "file", name: "attachment", title: "Файл" }] }],
        }}
      />,
    );

    await waitFor(() => {
      expect(resolveSurveyFileValueContent).toHaveBeenCalledWith({
        name: "answer.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: "public/form-1/file.xlsx",
      });
    });
    expect(downloadEventsDuringDataAssignment).toEqual(["data:application/octet-stream;base64,UEsDBA=="]);
  });

  it("adds a submitting hook while the response is being sent", async () => {
    let resolveMutation!: () => void;
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = () => resolve({
            status: "submitted",
            responseId: "response-1",
            data: { email: "a@b.com" },
            editable: false,
          });
        }),
    );

    const { container } = render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(container.querySelector(".survey-renderer-submitting")).toBeInTheDocument();
    });

    resolveMutation();

    await waitFor(() => {
      expect(container.querySelector(".survey-renderer-submitting")).not.toBeInTheDocument();
    });
  });

  it("does not pass the shared default logo token into the SurveyJS model", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          logo: "__APP_DEFAULT_CARD_LOGO__",
          logoWidth: "120px",
          logoHeight: "90px",
          logoFit: "contain",
          pages: [],
        }}
      />,
    );

    expect(createdModelSchemas[0]?.logo).not.toBe("__APP_DEFAULT_CARD_LOGO__");
  });

  it("uses completedHtml from schema when provided", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [],
          completedHtml: "<div>Мой текст</div>",
        }}
      />,
    );

    expect(createdModels[createdModels.length - 1]?.completedHtml).toBe("<div>Мой текст</div>");
  });

  it("falls back to the default completedHtml for old schemas", () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    expect(String(createdModels[createdModels.length - 1]?.completedHtml)).toContain("Спасибо за Ваш ответ!");
  });

  it("registers custom SurveyJS question types before creating the public model", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [
            {
              name: "page1",
              elements: [
                { type: "text", name: "school", title: "Школа" },
                { type: "phone", name: "phone", title: "Телефон" },
                { type: "email", name: "email", title: "Email" },
              ],
            },
          ],
        }}
      />,
    );

    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "phone",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "tel",
        }),
      }),
    );
    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "email",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "email",
        }),
      }),
    );
    expect(screen.getByTestId("survey-question-names")).toHaveTextContent("school,phone,email");
  });

  it("restores a fresh respondent draft before the survey is rendered", () => {
    window.sessionStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "saved@example.com" },
        uiState: { questions: { email: { collapsed: true } } },
        currentPageNo: 1,
        updatedAt: new Date().toISOString(),
      }),
    );

    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        schema={{
          pages: [
            { name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] },
            { name: "page2", elements: [{ type: "text", name: "name", title: "Имя" }] },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      currentPageNo: number;
      uiState: Record<string, unknown>;
    };

    expect(model.data).toEqual({ email: "saved@example.com" });
    expect(model.currentPageNo).toBe(1);
    expect(model.uiState).toEqual({ questions: { email: { collapsed: true } } });
  });

  it("saves respondent draft data and UI state in session storage when answers change", async () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      currentPageNo: number;
      uiState: Record<string, unknown>;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
    };
    model.data = { email: "draft@example.com" };
    model.currentPageNo = 0;
    model.uiState = { questions: { email: { collapsed: false } } };

    await model.onValueChanged.fire(model);

    expect(window.localStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}")).toMatchObject({
      data: { email: "draft@example.com" },
      uiState: { questions: { email: { collapsed: false } } },
      currentPageNo: 0,
      updatedAt: expect.any(String),
    });
  });

  it("omits uploaded file values from response drafts", async () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "file", name: "attachment", title: "Файл" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
    };
    model.data = {
      email: "draft@example.com",
      attachment: [{ name: "answer.txt", content: "public/form-1/file-id.txt" }],
      signedAttachment: [
        {
          name: "signed.txt",
          content: "https://storage.local/object/sign/survey-files/public/form-1/signed-id.txt?token=secret",
        },
      ],
      inlineAttachment: [{ name: "legacy.txt", content: "data:text/plain;base64,aGVsbG8=" }],
    };

    await model.onValueChanged.fire(model);

    const storedDraft = JSON.parse(window.sessionStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}") as {
      data?: Record<string, unknown>;
    };

    expect(storedDraft.data).toEqual({ email: "draft@example.com" });
  });

  it("keeps saving drafts when the installed SurveyJS runtime has no UI state event", async () => {
    includeUIStateEvent.current = false;

    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
    };
    model.data = { email: "draft@example.com" };

    await model.onValueChanged.fire(model);

    expect(JSON.parse(window.sessionStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}")).toMatchObject({
      data: { email: "draft@example.com" },
      updatedAt: expect.any(String),
    });
  });

  it("uses a stable anonymous respondent draft key when no user id is available", async () => {
    window.sessionStorage.setItem("survey-response:draft:anonymous-id", "anon-browser");

    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "text", name: "name", title: "Имя" }] }],
        }}
      />,
    );

    const model = createdModels[0] as {
      data: Record<string, unknown>;
      onValueChanged: { fire: (sender: unknown, options?: unknown) => Promise<void> };
    };
    model.data = { name: "Анонимный респондент" };

    await model.onValueChanged.fire(model);

    expect(window.localStorage.getItem("survey-response:draft:anon-browser:form-1")).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem("survey-response:draft:anon-browser:form-1") ?? "{}")).toMatchObject({
      data: { name: "Анонимный респондент" },
    });
  });

  it("drops stale respondent drafts instead of restoring them", () => {
    window.sessionStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "old@example.com" },
        updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    render(
      <SurveyFormRenderer
        formId="form-1"
        respondentId="user-1"
        schema={{
          pages: [{ name: "page1", elements: [{ type: "text", name: "email", title: "Email" }] }],
        }}
      />,
    );

    const model = createdModels[0] as { data: Record<string, unknown> };

    expect(model.data).toEqual({});
    expect(window.sessionStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
  });

  it("removes legacy response drafts from local storage when the renderer mounts", () => {
    window.localStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "persisted@example.com" },
        updatedAt: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem("survey-response:draft:anonymous-id", "anon-browser");

    render(<SurveyFormRenderer formId="form-1" respondentId="user-1" schema={{ pages: [] }} />);

    expect(window.localStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
    expect(window.localStorage.getItem("survey-response:draft:anonymous-id")).toBeNull();
  });

  it("clears the respondent draft after a successful submission", async () => {
    mutateAsync.mockResolvedValueOnce({
      status: "submitted",
      responseId: "response-1",
      data: { email: "a@b.com" },
      editable: false,
    });
    window.sessionStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "saved@example.com" },
        updatedAt: new Date().toISOString(),
      }),
    );

    render(<SurveyFormRenderer formId="form-1" respondentId="user-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
    });
  });

  it("keeps SurveyJS dropdown menus from reflowing the survey container", async () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [
            {
              name: "page1",
              elements: [
                {
                  type: "dropdown",
                  name: "choice",
                  title: "Выберите вариант",
                  choices: ["Пункт 1", "Пункт 2"],
                },
              ],
            },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      fitToContainer?: boolean;
      onOpenDropdownMenu: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };
    const popupModel = { focusFirstInputSelector: ".sv-list__item--selected" };
    const dropdownOptions = {
      deviceType: "desktop",
      menuType: "popup",
      question: {
        dropdownListModel: {
          popupModel,
        },
      },
    };

    await model.onOpenDropdownMenu.fire(model, dropdownOptions);

    expect(model.fitToContainer).toBe(false);
    expect(dropdownOptions.menuType).toBe("dropdown");
    expect(popupModel.focusFirstInputSelector).toBe(".surveyjs-dropdown-autofocus-disabled");
  });

  it("passes uploaded files to SurveyJS using the upload callback contract", async () => {
    const file = new File(["hello"], "attachment.txt", { type: "text/plain" });
    const callback = vi.fn();

    uploadFileToStorage.mockResolvedValue({
      file,
      path: "public/form-1/file-id.txt",
    });

    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [
            {
              name: "page1",
              elements: [{ type: "file", name: "attachment", title: "Файл" }],
            },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      onUploadFiles: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };

    await model.onUploadFiles.fire(model, { files: [file], callback });

    expect(callback).toHaveBeenCalledWith([
      {
        file,
        content: "public/form-1/file-id.txt",
      },
    ]);
  });

  it("deletes an anonymous public upload when the respondent clears it", async () => {
    const callback = vi.fn();
    getStoragePathFromSurveyFileValue.mockReturnValue("public/form-1/file-id.txt");

    render(
      <SurveyFormRenderer
        formId="form-1"
        allowAnonymousUploads
        schema={{
          pages: [
            {
              name: "page1",
              elements: [{ type: "file", name: "attachment", title: "Файл" }],
            },
          ],
        }}
      />,
    );

    const model = createdModels[0] as {
      onClearFiles: { fire: (sender: unknown, options: unknown) => Promise<void> };
    };

    await model.onClearFiles.fire(model, { value: { content: "public/form-1/file-id.txt" }, callback });

    expect(removeFileFromStorage).toHaveBeenCalledWith(
      "public/form-1/file-id.txt",
      { allowAnonymous: true, formId: "form-1" },
    );
    expect(callback).toHaveBeenCalledWith("success");
  });

  it("forces file questions to use server-side uploads instead of inline base64 storage", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [
            {
              name: "page1",
              elements: [{ type: "file", name: "attachment", title: "Файл" }],
            },
          ],
        }}
      />,
    );

    const firstQuestion = (createdModelSchemas[0] as {
      pages?: Array<{ elements?: Array<Record<string, unknown>> }>;
    })?.pages?.[0]?.elements?.[0];

    expect(firstQuestion).toEqual(
      expect.objectContaining({
        type: "file",
        name: "attachment",
        storeDataAsText: false,
        waitForUpload: true,
      }),
    );
  });

  it("normalizes numbering flags before creating the SurveyJS runtime model", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          title: "Импортированная форма",
          locale: "ru",
          showQuestionNumbers: "on",
          pages: [
            {
              name: "page1",
              elements: [
                {
                  type: "text",
                  name: "question1",
                  title: "Первый вопрос",
                  showNumber: true,
                  hideNumber: true,
                },
                {
                  type: "panel",
                  name: "panel1",
                  title: "Панель",
                  showNumber: true,
                  showQuestionNumbers: "on",
                  elements: [
                    {
                      type: "text",
                      name: "nested",
                      title: "Вложенный вопрос",
                      showNumber: true,
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(createdModelSchemas[0]).toMatchObject({
      title: "Импортированная форма",
      locale: "ru",
      showQuestionNumbers: false,
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "text",
              name: "question1",
              title: "Первый вопрос",
              showNumber: false,
            },
            {
              type: "panel",
              name: "panel1",
              title: "Панель",
              showNumber: false,
              showQuestionNumbers: "off",
              elements: [
                {
                  type: "text",
                  name: "nested",
                  title: "Вложенный вопрос",
                  showNumber: false,
                },
              ],
            },
          ],
        },
      ],
    });

    const firstQuestion = (createdModelSchemas[0] as {
      pages?: Array<{ elements?: Array<{ hideNumber?: boolean }> }>;
    })?.pages?.[0]?.elements?.[0];

    expect(firstQuestion?.hideNumber).toBeUndefined();
  });
});
