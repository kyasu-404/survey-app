function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getTitle(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  if (isRecord(value)) return getTitle(value.ru ?? value.default, fallback);
  return fallback;
}

export function getArchiveQuestions(schema) {
  const fileQuestions = [];
  const organizationPaths = [];
  let visited = 0;
  const visit = (value, path, depth) => {
    if (!isRecord(value)) return;
    if (++visited > 10_000 || depth > 32) throw new Error('Слишком сложная структура формы для выгрузки файлов');
    const name = typeof value.valueName === 'string' && value.valueName ? value.valueName : value.name;
    const answerPath = typeof name === 'string' ? [...path, name] : path;
    if (typeof name === 'string') {
      if (value.type === 'file') {
        fileQuestions.push({ title: getTitle(value.title, name), path: answerPath });
        return;
      }
      if (value.type === 'organization') {
        organizationPaths.push(answerPath);
        return;
      }
    }
    const nestedPath = value.type === 'paneldynamic' ? [...answerPath, null] : path;
    for (const key of ['pages', 'elements', 'templateElements']) {
      if (Array.isArray(value[key])) value[key].forEach(child => visit(child, nestedPath, depth + 1));
    }
    if (value.type === 'matrixdynamic' || value.type === 'matrixdropdown') {
      const rowPath = [...answerPath, null];
      if (Array.isArray(value.columns)) {
        value.columns.forEach(column => {
          if (isRecord(column)) visit({ ...column, type: column.cellType ?? value.cellType }, rowPath, depth + 1);
        });
      }
      if (Array.isArray(value.detailElements)) value.detailElements.forEach(child => visit(child, rowPath, depth + 1));
    }
  };
  visit(schema, [], 0);
  return { fileQuestions, organizationPaths };
}

function valuesAtPath(data, path) {
  let values = [data];
  for (const segment of path) {
    values = values.flatMap(value => {
      // Null selects each dynamic row, whether saved as an array or a map.
      if (segment === null) return Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
      return isRecord(value) && Object.hasOwn(value, segment) ? [value[segment]] : [];
    });
  }
  return values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => isRecord(value) || (typeof value === 'string' && value !== ''));
}

export function safeArchiveName(value, fallback, maxLength = 100) {
  const clean = value.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '') || fallback;
  const extension = clean.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const short = clean.length > maxLength ? clean.slice(0, maxLength - extension.length).toWellFormed() + extension : clean;
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(short) ? `_${short}` : short;
}

function getOrganizationLabel(data, paths, labels) {
  if (!labels.size) return undefined;
  for (const path of paths) {
    for (const value of valuesAtPath(data, path)) {
      const label = labels.get(value);
      if (label?.trim()) return label;
    }
  }
}

export function collectResponseAttachments(responses, { fileQuestions, organizationPaths }, organizationLabels, responseNumbers) {
  // Mixing saved page positions with export positions can reuse a number.
  const numbers = responseNumbers && responses.every(response => responseNumbers.has(response.id)) ? responseNumbers : undefined;
  return responses.flatMap((response, responseIndex) => {
    const label = getOrganizationLabel(response.data, organizationPaths, organizationLabels);
    const number = String(numbers?.get(response.id) ?? responseIndex + 1).padStart(3, '0');
    const responseFolder = `${safeArchiveName(label ?? '', 'Ответ', 48)} — ${number}`;
    return fileQuestions.flatMap((question, questionIndex) => {
      const folder = fileQuestions.length === 1
        ? responseFolder
        : `${responseFolder}/${questionIndex + 1}_${safeArchiveName(question.title, 'Файлы', 60)}`;
      return valuesAtPath(response.data, question.path).map((value, fileIndex) => {
        const name = typeof value.name === 'string' ? value.name : 'файл';
        return { archivePath: `${folder}/${fileIndex + 1}_${safeArchiveName(name, 'файл')}`, value };
      });
    });
  });
}
