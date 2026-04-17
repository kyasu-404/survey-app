import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const {
  componentCollectionAdd,
  componentCollectionGetByName,
  createdModels,
  createdModelSchemas,
  includeUIStateEvent,
  mutateAsync,
  registeredCustomQuestionTypes,
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
    includeUIStateEvent: { current: true },
    mutateAsync: vi.fn().mockRejectedValue(new Error("api failed")),
    registeredCustomQuestionTypes,
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
  Model: class {
    locale = "ru";
    completeText = "";
    completedHtml = "";
    data: Record<string, unknown> = {};
    fitToContainer = true;
    currentPageNo = 0;
    uiState: Record<string, unknown> = {};
    questionNames: string[] = [];
    onCompleting = new FakeSurveyEvent();
    onUploadFiles = new FakeSurveyEvent();
    onDownloadFile = new FakeSurveyEvent();
    onClearFiles = new FakeSurveyEvent();
    onOpenDropdownMenu = new FakeSurveyEvent();
    onValueChanged = new FakeSurveyEvent();
    onCurrentPageChanged = new FakeSurveyEvent();
    onUIStateChanged = includeUIStateEvent.current ? new FakeSurveyEvent() : undefined;
    doComplete = vi.fn();

    constructor(schema: Record<string, unknown> & { pages?: Array<{ elements?: Array<{ type: string; name: string }> }> }) {
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
  },
}));

vi.mock("survey-react-ui", () => ({
  Survey: ({
    model,
  }: {
    model: {
      completeText: string;
      data: Record<string, unknown>;
      questionNames: string[];
      onCompleting: { fire: (arg: unknown, options: unknown) => Promise<void> };
    };
  }) => (
    <div>
      <div data-testid="survey-question-names">{model.questionNames.join(",")}</div>
      <div className="sd-body__navigation">
        <button
          className="sd-btn sd-btn--action"
          onClick={async () => {
            model.data = { email: "a@b.com" };
            await model.onCompleting.fire(model, { allowComplete: true, allow: true });
          }}
        >
          {model.completeText || "Отправить"}
        </button>
      </div>
    </div>
  ),
}));

vi.mock("../submit-response/useSubmitResponse", () => ({
  useSubmitResponseMutation: () => ({
    mutateAsync,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../shared/api/storage", () => ({
  getStoragePathFromSurveyFileValue: vi.fn(),
  removeFileFromStorage: vi.fn(),
  resolveSurveyFileValueContent: vi.fn(),
  uploadFileToStorage,
}));

describe("SurveyFormRenderer", () => {
  beforeEach(() => {
    createdModels.length = 0;
    createdModelSchemas.length = 0;
    registeredCustomQuestionTypes.clear();
    showToast.mockClear();
    mutateAsync.mockClear();
    componentCollectionAdd.mockClear();
    componentCollectionGetByName.mockClear();
    uploadFileToStorage.mockReset();
    mutateAsync.mockRejectedValue(new Error("api failed"));
    includeUIStateEvent.current = true;
    window.localStorage.clear();
  });

  it("shows error toast when API submission fails", async () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });

  it("adds a submitting hook while the response is being sent", async () => {
    let resolveMutation!: () => void;
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve;
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
    window.localStorage.setItem(
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

  it("saves respondent draft data and UI state when answers change", async () => {
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

    expect(JSON.parse(window.localStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}")).toMatchObject({
      data: { email: "draft@example.com" },
      uiState: { questions: { email: { collapsed: false } } },
      currentPageNo: 0,
      updatedAt: expect.any(String),
    });
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

    expect(JSON.parse(window.localStorage.getItem("survey-response:draft:user-1:form-1") ?? "{}")).toMatchObject({
      data: { email: "draft@example.com" },
      updatedAt: expect.any(String),
    });
  });

  it("uses a stable anonymous respondent draft key when no user id is available", async () => {
    window.localStorage.setItem("survey-response:draft:anonymous-id", "anon-browser");

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

    expect(JSON.parse(window.localStorage.getItem("survey-response:draft:anon-browser:form-1") ?? "{}")).toMatchObject({
      data: { name: "Анонимный респондент" },
    });
  });

  it("drops stale respondent drafts instead of restoring them", () => {
    window.localStorage.setItem(
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
    expect(window.localStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
  });

  it("clears the respondent draft after a successful submission", async () => {
    mutateAsync.mockResolvedValueOnce(undefined);
    window.localStorage.setItem(
      "survey-response:draft:user-1:form-1",
      JSON.stringify({
        data: { email: "saved@example.com" },
        updatedAt: new Date().toISOString(),
      }),
    );

    render(<SurveyFormRenderer formId="form-1" respondentId="user-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("survey-response:draft:user-1:form-1")).toBeNull();
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
});
