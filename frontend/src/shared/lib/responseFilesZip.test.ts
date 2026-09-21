import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadSurveyFile } from "../api/storage";
import { createResponseFilesZip } from "./responseFilesZip";

vi.mock("../api/storage", () => ({ downloadSurveyFile: vi.fn() }));
const schema = { pages: [{ elements: [{ type: "file", name: "files", title: "Документы" }] }] };
const responses = [{ id: "r1", form_id: "form", created_at: "2026-09-13", data: { files: [
  { name: "report.pdf", content: "first" }, { name: "report.pdf", content: "second" },
] } }];
const bytes = (content: string) => ({ arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as Blob;
const readBlob = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

describe("files ZIP export", () => {
  beforeEach(() => vi.resetAllMocks());

  it("writes the original bytes of every file with unique paths and progress", async () => {
    vi.mocked(downloadSurveyFile).mockResolvedValueOnce(bytes("PDF 1")).mockResolvedValueOnce(bytes("PDF 2"));
    const onProgress = vi.fn();
    const result = await createResponseFilesZip(responses, schema, { onProgress });
    expect(result).toMatchObject({ downloaded: 2, failed: 0 });
    const zip = await JSZip.loadAsync(await readBlob(result!.blob));
    expect(await Promise.all(Object.values(zip.files).map(file => file.async("string")))).toEqual(["PDF 1", "PDF 2"]);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it("includes a missing-file list and succeeds with the remaining files", async () => {
    vi.mocked(downloadSurveyFile).mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce(bytes("PDF 2"));
    const result = await createResponseFilesZip(responses, schema);
    expect(result).toMatchObject({ downloaded: 1, failed: 1 });
    const zip = await JSZip.loadAsync(await readBlob(result!.blob));
    expect(await zip.file("Не удалось скачать.txt")!.async("string")).toContain("1_report.pdf");
    expect(Object.values(zip.files).filter(file => file.name.endsWith(".pdf"))).toHaveLength(1);
  });

  it("rejects the entire archive when concurrent files exceed the byte budget", async () => {
    vi.mocked(downloadSurveyFile).mockResolvedValue(bytes("123456"));
    await expect(createResponseFilesZip(responses, schema, { maxBytes: 10 })).rejects.toThrow("64 МБ");
  });

  it("does not create empty archives or disguise total failures as success", async () => {
    expect(await createResponseFilesZip([], schema)).toBeNull();
    vi.mocked(downloadSurveyFile).mockRejectedValue(new Error("403"));
    await expect(createResponseFilesZip(responses, schema)).rejects.toThrow("Не удалось скачать вложения");
  });

  it("cancels instead of downloading a partial archive after navigation", async () => {
    const controller = new AbortController();
    vi.mocked(downloadSurveyFile).mockImplementation(async () => { controller.abort(); return bytes("file"); });
    await expect(createResponseFilesZip(responses, schema, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
