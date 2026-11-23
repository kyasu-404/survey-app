import { Workbook } from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ORGANIZATIONS_XLSX_BYTES, exportOrganizationsXlsx, parseOrganizationsXlsx } from "./xlsx";

async function spreadsheet(rows: unknown[][]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Организации");
  sheet.addRow(["Тип ОУ", "Номер", "Алиасы", "Email"]);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Uint8Array.from(new Uint8Array(buffer));
  return { name: "organizations.xlsx", size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
}

describe("organization XLSX import", () => {
  it("rejects an oversized file before reading its bytes", async () => {
    const arrayBuffer = vi.fn();
    const file = { name: "large.xlsx", size: MAX_ORGANIZATIONS_XLSX_BYTES + 1, arrayBuffer } as unknown as File;
    await expect(parseOrganizationsXlsx(file)).rejects.toThrow("10 МБ");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("accepts the inclusive size boundary and preserves real XLSX parsing/normalization", async () => {
    const file = await spreadsheet([["Школа", "1", "ГБОУ", "SCHOOL@example.invalid"], ["УДОД", "", "ДДТ", "ddt@example.invalid"]]);
    const bounded = { ...file, size: MAX_ORGANIZATIONS_XLSX_BYTES } as File;
    await expect(parseOrganizationsXlsx(bounded)).resolves.toEqual([
      { organization_type: "school", number: "1", alias: "ГБОУ", email: "school@example.invalid" },
      { organization_type: "udod", number: null, alias: "ДДТ", email: "ddt@example.invalid" },
    ]);
  });

  it("retains the record limit", async () => {
    const file = await spreadsheet(Array.from({ length: 5001 }, (_, i) => ["school", String(i), "School", "school@example.invalid"]));
    await expect(parseOrganizationsXlsx(file)).rejects.toThrow("5000 организаций");
  });
});


describe("organization XLSX worker transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("transfers the upload buffer and terminates the worker after a normal response", async () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      terminate: vi.fn(),
      postMessage: vi.fn(() => {
        queueMicrotask(() => worker.onmessage?.({ data: {
          ok: true,
          operation: "parse",
          rows: [{ organization_type: "school", number: "1", alias: "ГБОУ", email: "school@example.invalid" }],
        } }));
      }),
    };
    const constructor = vi.fn(function Worker() { return worker; });
    vi.stubGlobal("Worker", constructor);
    const bytes = new ArrayBuffer(8);
    const file = { size: bytes.byteLength, arrayBuffer: async () => bytes } as File;
    await expect(parseOrganizationsXlsx(file)).resolves.toEqual([
      { organization_type: "school", number: "1", alias: "ГБОУ", email: "school@example.invalid" },
    ]);
    expect(constructor).toHaveBeenCalledWith(expect.any(URL), { type: "module" });
    expect(worker.postMessage).toHaveBeenCalledWith({ operation: "parse", bytes }, [bytes]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("reports a worker error and terminates the worker", async () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      terminate: vi.fn(),
      postMessage: vi.fn(() => {
        queueMicrotask(() => worker.onmessage?.({ data: { ok: false, message: "Ожидаются столбцы" } }));
      }),
    };
    vi.stubGlobal("Worker", function Worker() { return worker; });
    const file = { size: 1, arrayBuffer: async () => new ArrayBuffer(1) } as File;

    await expect(parseOrganizationsXlsx(file)).rejects.toThrow("Ожидаются столбцы");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("exports a valid workbook in the fallback and imports the same organizations", async () => {
    vi.stubGlobal("Worker", undefined);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:organizations");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const organization = {
        id: "fixture", organization_type: "kindergarten" as const, number: "18", alias: "Детский сад",
        email: "school@example.invalid", is_archived: false, created_at: "", updated_at: "",
      };
      await exportOrganizationsXlsx([organization]);
      const [blob] = createObjectURL.mock.calls[0];
      expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const reader = new FileReader();
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      await expect(parseOrganizationsXlsx({ size: bytes.byteLength, arrayBuffer: async () => bytes } as File))
        .resolves.toEqual([{ organization_type: "kindergarten", number: "18", alias: "Детский сад", email: "school@example.invalid" }]);
    } finally {
      click.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
