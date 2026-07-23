import "@testing-library/jest-dom/vitest";

if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать Blob"));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
