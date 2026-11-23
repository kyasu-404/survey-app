import { Inflate, zipSync, strToU8, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { requireValue } from './security.mjs';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MAX_UNCOMPRESSED_OOXML_BYTES = 100 * 1024 * 1024;
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink',
]);
const relsParser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: false });
const xmlCharacters = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
function relationshipAttribute(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|apos|quot);/gi, (_, ref) => {
    if (!ref.startsWith('#')) return xmlCharacters[ref];
    const point = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    requireValue(Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff),
      'Некорректный XML в OOXML');
    return String.fromCodePoint(point);
  }).trim();
}
function relationshipElement(node, parents) {
  const names = Object.keys(node).filter(key => key !== ':@');
  requireValue(names.length === 1, 'Некорректные связи OOXML');
  const [name] = names;
  const [prefix, local = prefix, extra] = name.split(':');
  requireValue(extra === undefined, 'Некорректные связи OOXML');
  const attributes = { ...parents, ...node[':@'] };
  const namespace = attributes[name.includes(':') ? '@_xmlns:' + prefix : '@_xmlns'];
  requireValue(namespace === PACKAGE_REL_NS, 'Некорректные связи OOXML');
  return { local, attributes, children: node[name] };
}
const relationshipNodes = nodes => nodes.filter(node => !Object.hasOwn(node, '?xml') && !Object.hasOwn(node, '#text'));
function validateRelationships(xml) {
  const roots = relationshipNodes(relsParser.parse(xml));
  requireValue(roots.length === 1, 'Некорректные связи OOXML');
  const root = relationshipElement(roots[0]);
  requireValue(root.local === 'Relationships', 'Некорректные связи OOXML');
  for (const node of relationshipNodes(root.children)) {
    const rel = relationshipElement(node, root.attributes);
    requireValue(rel.local === 'Relationship' && relationshipNodes(rel.children).length === 0, 'Некорректные связи OOXML');
    const mode = relationshipAttribute(node[':@']?.['@_TargetMode']).toLowerCase();
    const type = relationshipAttribute(node[':@']?.['@_Type']);
    const target = relationshipAttribute(node[':@']?.['@_Target']);
    requireValue(type && target && (!mode || mode === 'internal' || mode === 'external'), 'Некорректные связи OOXML');
    if (mode !== 'external') {
      requireValue(!/^(?:[a-z][a-z\d+.-]*:|\/\/)|\\/i.test(target), 'Некорректные связи OOXML');
      continue;
    }
    const web = URL.canParse(target) ? new URL(target) : null;
    requireValue(HYPERLINK_TYPES.has(type) && web && ['https:', 'http:'].includes(web.protocol) && !web.username && !web.password,
      'Внешние ресурсы и ссылки в OOXML не поддерживаются');
  }
}

function validateExtraFields(buffer, start, size) {
  const end = start + size;
  for (let p = start; p < end;) {
    requireValue(p + 4 <= end, 'Повреждён ZIP');
    const kind = buffer.readUInt16LE(p);
    const next = p + 4 + buffer.readUInt16LE(p + 2);
    // Exclude ZIP64 and the alternate filename in Info-ZIP Unicode Path.
    requireValue(kind !== 1 && kind !== 0x7075 && next <= end, 'ZIP64 или повреждённый OOXML не поддерживается');
    p = next;
  }
}

function validateLocalLayout(buffer, members, directoryOffset) {
  members.sort((first, second) => first.localOffset - second.localOffset);
  let cursor = 0;
  for (const [index, member] of members.entries()) {
    requireValue(member.localOffset === cursor, 'Повреждён ZIP');
    const next = members[index + 1]?.localOffset ?? directoryOffset;
    const dataEnd = member.dataOffset + member.compressedBytes;
    if (member.flags & 8) {
      const size = next - dataEnd;
      requireValue(size === 12 || (size === 16 && buffer.readUInt32LE(dataEnd) === 0x08074b50), 'Повреждён ZIP');
      const descriptor = next - 12;
      requireValue(buffer.readUInt32LE(descriptor) === member.crc
        && buffer.readUInt32LE(descriptor + 4) === member.compressedBytes
        && buffer.readUInt32LE(descriptor + 8) === member.bytes, 'Повреждён ZIP');
    } else {
      requireValue(dataEnd === next, 'Повреждён ZIP');
    }
    cursor = next;
  }
}

export function validateOffice(buffer, maxBytes, format = 'docx') {
  requireValue(buffer.length > 0 && buffer.length <= maxBytes, 'Превышен допустимый размер офисного файла', 413);
  // Inspect the ZIP central directory before decompressing to stop ZIP bombs.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  requireValue(end >= 0, 'Файл не является OOXML (ZIP)');
  const entries = buffer.readUInt16LE(end + 10);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  const directorySize = buffer.readUInt32LE(end + 12);
  requireValue(buffer.readUInt16LE(end + 4) === 0 && buffer.readUInt16LE(end + 6) === 0
    && buffer.readUInt16LE(end + 8) === entries && entries !== 0xffff
    && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length
    && directoryOffset + directorySize === end
    && (end < 20 || buffer.readUInt32LE(end - 20) !== 0x07064b50),
  'Многотомный, ZIP64 или повреждённый OOXML не поддерживается');
  let offset = directoryOffset, total = 0;
  requireValue(entries > 0 && entries < 10000, 'Слишком много элементов в OOXML');
  const names = new Set(), members = [];
  for (let i = 0; i < entries; i++) {
    requireValue(offset + 46 <= end && buffer.readUInt32LE(offset) === 0x02014b50, 'Повреждён ZIP');
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const bytes = buffer.readUInt32LE(offset + 24);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameSize + extra + comment;
    requireValue(nextOffset <= end && nameSize > 0 && (compression === 0 || compression === 8)
      && (compression !== 0 || compressedBytes === bytes), 'Повреждён ZIP');
    requireValue(!(flags & ~0x080e) && buffer.readUInt16LE(offset + 34) === 0, 'Неподдерживаемые параметры ZIP');
    validateExtraFields(buffer, offset + 46 + nameSize, extra);
    const localOffset = buffer.readUInt32LE(offset + 42);
    requireValue(localOffset + 30 <= directoryOffset && buffer.readUInt32LE(localOffset) === 0x04034b50, 'Повреждён ZIP');
    const localNameSize = buffer.readUInt16LE(localOffset + 26);
    const localExtraSize = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameSize + localExtraSize;
    requireValue(dataOffset + compressedBytes <= directoryOffset, 'Повреждён ZIP');
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameSize);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameSize);
    requireValue(localName.equals(nameBytes) && buffer.readUInt16LE(localOffset + 8) === compression
      && buffer.readUInt16LE(localOffset + 6) === flags, 'Повреждён ZIP');
    validateExtraFields(buffer, localOffset + 30 + localNameSize, localExtraSize);
    for (const [fieldOffset, value] of [[14, crc], [18, compressedBytes], [22, bytes]]) {
      const localValue = buffer.readUInt32LE(localOffset + fieldOffset);
      requireValue(localValue === value || ((flags & 8) && localValue === 0), 'Повреждён ZIP');
    }
    const name = nameBytes.toString('utf8');
    requireValue(Buffer.from(name).equals(nameBytes), 'Некорректные имена ZIP');
    total += bytes;
    requireValue(!(flags & 1) && total <= MAX_UNCOMPRESSED_OOXML_BYTES && bytes <= 40 * 1024 * 1024,
      'Зашифрованный или слишком большой распакованный OOXML');
    requireValue(!name.startsWith('/') && !name.includes('..') && !name.includes('\\') && !['__proto__', 'constructor', 'prototype'].includes(name) && !names.has(name.toLowerCase()) && !/[:\x00-\x1f\x7f]/.test(name), 'Некорректные пути в OOXML');
    requireValue(!/vbaProject|activeX\/|macrosheets\/|embeddings\//i.test(name), 'Макросы, ActiveX и встроенные объекты не поддерживаются');
    names.add(name.toLowerCase()); members.push({ name, flags, compression, crc, compressedBytes, bytes, localOffset, dataOffset }); offset = nextOffset;
  }
  requireValue(offset === end, 'Повреждён каталог ZIP');
  validateLocalLayout(buffer, members, directoryOffset);
  const files = Object.create(null);
  let extractedBytes = 0;
  try {
    for (const member of members) {
      const { name, compression, crc, compressedBytes, bytes, dataOffset } = member;
      if (compression === 0) {
        const output = buffer.subarray(dataOffset, dataOffset + compressedBytes);
        requireValue(crc32(output) === crc, 'Контрольная сумма ZIP не совпадает с каталогом');
        files[name] = output;
        continue;
      }
      const output = new Uint8Array(bytes);
      let written = 0;
      const consume = chunk => {
        written += chunk.length;
        extractedBytes += chunk.length;
        requireValue(written <= bytes && written <= 40 * 1024 * 1024 && extractedBytes <= MAX_UNCOMPRESSED_OOXML_BYTES,
          'Слишком большой распакованный OOXML');
        output.set(chunk, written - chunk.length);
      };
      // Small input chunks bound allocations before consume rejects an
      // incorrect size. fflate does not use the ZIP member size as an output cap.
      const inflater = new Inflate(consume);
      for (let start = 0; start < compressedBytes; start += 1024) {
        inflater.push(buffer.subarray(dataOffset + start, dataOffset + Math.min(start + 1024, compressedBytes)), start + 1024 >= compressedBytes);
      }
      requireValue(written === bytes && crc32(output) === crc, 'Размер или контрольная сумма ZIP не совпадают с каталогом');
      files[name] = output;
    }
  } catch { requireValue(false, 'Не удалось прочитать офисный файл'); }
  for (const name of ['[Content_Types].xml', '_rels/.rels', ...(format === 'xlsx' ? ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'] : ['word/document.xml'])]) {
    requireValue(files[name], 'Отсутствует обязательный компонент DOCX');
  }
  for (const name of Object.keys(files)) {
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const xml = strFromU8(files[name]);
    requireValue(!/<!DOCTYPE|<!ENTITY/i.test(xml) && XMLValidator.validate(xml) === true, 'Некорректный XML в OOXML');
    if (/\.rels$/i.test(name)) validateRelationships(xml);
  }
  requireValue(strFromU8(files['[Content_Types].xml']).includes(format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), 'Формат содержимого не совпадает с расширением. Макросы не поддерживаются');
  return files;
}
export const validateDocx = (buffer, maxBytes) => validateOffice(buffer, maxBytes, 'docx');
export function blankDocx() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr></w:body></w:document>'),
  }, { level: 6 }));
}
