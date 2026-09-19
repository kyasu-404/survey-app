// Keep the original bytes only for this survey instance. Anonymous respondents
// can upload to private Storage, but cannot read it back to create a preview.
export function readLocalSurveyFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать выбранный файл"));
    reader.readAsDataURL(file);
  });
}
