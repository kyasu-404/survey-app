export const MAX_FAVICON_BYTES = 1024 * 1024;
const fail = message => { throw new Error(message); };
const square = (w, h, max = 512) => {
  if (!Number.isInteger(w) || w !== h || w < 16 || w > max) fail(`Иконка должна быть квадратной, размером от 16 до ${max} пикселей`);
};
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(bytes, max = 512) {
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) fail("Повреждённый PNG-файл");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, data = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + length + 12;
    if (end > bytes.length) fail("Повреждённый PNG-файл");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) fail("Повреждённый PNG-файл");
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) fail("Повреждённый PNG-файл");
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); square(width, height, max);
    } else if (type === "IHDR") fail("Повреждённый PNG-файл");
    if (type === "acTL") fail("Анимированная иконка не поддерживается");
    if (type === "IDAT") data = true;
    offset = end;
    if (type === "IEND") { if (length !== 0) fail("Повреждённый PNG-файл"); ended = true; break; }
  }
  if (!ended || !data || offset !== bytes.length) fail("Повреждённый PNG-файл");
  return { width, height };
}
function ico(bytes) {
  if (bytes.length < 22) fail("Повреждённый ICO-файл");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1 || count < 1 || count > 32 || bytes.length < 6 + count * 16) fail("Повреждённый ICO-файл");
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16, w = bytes[entry] || 256, h = bytes[entry + 1] || 256;
    square(w, h, 256);
    const size = view.getUint32(entry + 8, true), start = view.getUint32(entry + 12, true);
    if (start < 6 + count * 16 || size < 40 || start + size > bytes.length) fail("Повреждённый ICO-файл");
    const frame = bytes.subarray(start, start + size);
    if (frame[0] === 137) {
      const parsed = png(frame, 256); if (parsed.width !== w || parsed.height !== h) fail("Некорректный размер кадра ICO");
    } else {
      const header = view.getUint32(start, true), depth = view.getUint16(start + 14, true);
      if (header !== 40 || view.getInt32(start + 4, true) !== w || view.getInt32(start + 8, true) !== h * 2
        || view.getUint16(start + 12, true) !== 1 || ![1,4,8,24,32].includes(depth) || view.getUint32(start + 16, true) !== 0) fail("Неподдерживаемый кадр ICO");
      const palette = depth <= 8 ? 4 * (view.getUint32(start + 32, true) || 2 ** depth) : 0;
      const pixels = Math.ceil(w * depth / 32) * 4 * h;
      if (header + palette + pixels > size) fail("Повреждённый ICO-файл");
    }
  }
}
const tags = new Set('svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc'.split(' '));
const attributes = new Set('xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity transform id gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity clip-path clip-rule mask maskUnits maskContentUnits preserveAspectRatio'.split(' '));
function svg(bytes, xml) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s[^?]*\?>/, '');
  if (/<!|<\?|&/.test(text) || xml.XMLValidator.validate(text) !== true) fail("SVG должен содержать простую графику без скриптов, стилей, внешних ссылок и XML-сущностей");
  const options = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: false };
  const tree = new xml.XMLParser(options).parse(text);
  if (tree.length !== 1 || !tree[0].svg) fail("Некорректный SVG-файл");
  const dimensions = tree[0][':@'] ?? {};
  if (dimensions['@_xmlns'] !== 'http://www.w3.org/2000/svg') fail("SVG должен содержать xmlns=\"http://www.w3.org/2000/svg\"");
  const box = String(dimensions['@_viewBox'] ?? '').trim().split(/[ ,]+/).map(Number);
  const width = Number(String(dimensions['@_width'] ?? '').replace(/px$/, ''));
  const height = Number(String(dimensions['@_height'] ?? '').replace(/px$/, ''));
  if (box.length === 4 && box.every(Number.isFinite)) square(box[2], box[3]);
  else square(width, height);
  if (dimensions['@_width'] !== undefined || dimensions['@_height'] !== undefined) square(width, height);
  let count = 0;
  function visit(nodes, depth = 0) {
    if (depth > 32) fail("Слишком сложный SVG");
    for (const node of nodes) {
      if (++count > 10000) fail("Слишком сложный SVG");
      for (const [tag, children] of Object.entries(node)) {
        if (tag === ':@' || tag === '#text') continue;
        if (!tags.has(tag)) fail(`Элемент ${tag} не поддерживается в favicon SVG`);
        visit(children, depth + 1);
      }
      for (const [name, value] of Object.entries(node[':@'] ?? {})) {
        if (!attributes.has(name.slice(2)) || typeof value !== 'string' || /[<>\\]/.test(value)) fail(`Атрибут ${name.slice(2)} не поддерживается в favicon SVG`);
        if (/url\s*\(/i.test(value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(value)) fail("Внешние ссылки в SVG запрещены");
        if (name === '@_xmlns' && value !== 'http://www.w3.org/2000/svg') fail("Недопустимое пространство имён SVG");
      }
    }
  }
  visit(tree);
  return new TextEncoder().encode(new xml.XMLBuilder(options).build(tree));
}
export function validateFavicon(bytes, fileName, xml) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FAVICON_BYTES) fail("Размер favicon должен быть от 1 байта до 1 МБ");
  const extension = String(fileName).toLowerCase().split('.').at(-1);
  if (extension === 'png') { png(bytes); return { bytes, extension, mime: 'image/png' }; }
  if (extension === 'ico') { ico(bytes); return { bytes, extension, mime: 'image/x-icon' }; }
  if (extension === 'svg') return { bytes: svg(bytes, xml), extension, mime: 'image/svg+xml' };
  fail("Поддерживаются только PNG, SVG и ICO");
}
