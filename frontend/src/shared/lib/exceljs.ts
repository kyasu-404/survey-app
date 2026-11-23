import excelJsAsset from "exceljs/dist/exceljs.bare.min.js?url";

type ExcelJSModule = typeof import("exceljs");

let browserLoad: Promise<ExcelJSModule> | undefined;

export function loadExcelJS(): Promise<ExcelJSModule> {
  if (!import.meta.env.PROD || import.meta.env.SSR) {
    return import("exceljs");
  }

  // The browser distribution is a local Vite asset shared by the page and
  // workers. Each realm loads it lazily from the same cacheable URL. Vite's
  // browser target already provides the APIs supplied by the polyfilled build.
  browserLoad ??= import(/* @vite-ignore */ excelJsAsset).then(() => {
    const excel = (globalThis as typeof globalThis & { ExcelJS?: ExcelJSModule }).ExcelJS;
    if (!excel?.Workbook) throw new Error("Не удалось загрузить обработчик XLSX");
    return excel;
  }).catch((error: unknown) => {
    browserLoad = undefined;
    throw error;
  });
  return browserLoad;
}
