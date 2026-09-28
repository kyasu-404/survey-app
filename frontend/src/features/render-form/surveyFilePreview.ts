// Reuse local bytes during upload. After reload, draft previews obtain a short
// signed URL only after the server verifies this browser's upload capability.
export function readLocalSurveyFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать выбранный файл"));
    reader.readAsDataURL(file);
  });
}
