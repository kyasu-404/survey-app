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
const relsParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false });
function validateRelationships(xml) {
  const parsed = relsParser.parse(xml);
  const raw = parsed?.Relationships?.Relationship;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const rel of list) {
    if (String(rel?.['@_TargetMode'] || '').toLowerCase() !== 'external') continue;
    const type = String(rel?.['@_Type'] || '');
    const target = String(rel?.['@_Target'] || '').trim();
    requireValue(type.endsWith('/hyperlink') && /^https?:\/\//i.test(target),
      'Внешние ресурсы и ссылки в OOXML не поддерживаются');
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
    for (let p = offset + 46 + nameSize; p < offset + 46 + nameSize + extra;) {
      requireValue(p + 4 <= offset + 46 + nameSize + extra, 'Повреждён ZIP');
      const kind = buffer.readUInt16LE(p), size = buffer.readUInt16LE(p + 2);
      requireValue(kind !== 1 && p + 4 + size <= offset + 46 + nameSize + extra, 'ZIP64 или повреждённый OOXML не поддерживается');
      p += 4 + size;
    }
    const localOffset = buffer.readUInt32LE(offset + 42);
    requireValue(localOffset + 30 <= directoryOffset && buffer.readUInt32LE(localOffset) === 0x04034b50, 'Повреждён ZIP');
    const localNameSize = buffer.readUInt16LE(localOffset + 26);
    const localExtraSize = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameSize + localExtraSize;
    requireValue(dataOffset + compressedBytes <= directoryOffset, 'Повреждён ZIP');
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameSize).toString('utf8');
    requireValue(localName === name && buffer.readUInt16LE(localOffset + 8) === compression, 'Повреждён ZIP');
    if (!(flags & 8)) {
      requireValue(
        buffer.readUInt32LE(localOffset + 14) === crc
        && buffer.readUInt32LE(localOffset + 18) === compressedBytes
        && buffer.readUInt32LE(localOffset + 22) === bytes,
        'Повреждён ZIP',
      );
    }
    total += bytes;
    requireValue(!(flags & 1) && total <= MAX_UNCOMPRESSED_OOXML_BYTES && bytes <= 40 * 1024 * 1024,
      'Зашифрованный или слишком большой распакованный OOXML');
    requireValue(!name.startsWith('/') && !name.includes('..') && !name.includes('\\') && !['__proto__', 'constructor', 'prototype'].includes(name) && !names.has(name), 'Некорректные пути в OOXML');
    requireValue(!/vbaProject|activeX\/|macrosheets\/|embeddings\//i.test(name), 'Макросы, ActiveX и встроенные объекты не поддерживаются');
    names.add(name); members.push({ name, compression, crc, compressedBytes, bytes, dataOffset }); offset = nextOffset;
  }
  requireValue(offset === end, 'Повреждён каталог ZIP');
  const files = Object.create(null);
  let extractedBytes = 0;
  try {
    for (const member of members) {
      const { name, compression, crc, compressedBytes, bytes, dataOffset } = member;
      const output = new Uint8Array(bytes);
      let written = 0;
      const consume = chunk => {
        written += chunk.length;
        extractedBytes += chunk.length;
        requireValue(written <= bytes && written <= 40 * 1024 * 1024 && extractedBytes <= MAX_UNCOMPRESSED_OOXML_BYTES,
          'Слишком большой распакованный OOXML');
        output.set(chunk, written - chunk.length);
      };
      if (compression === 0) consume(buffer.subarray(dataOffset, dataOffset + compressedBytes));
      else {
        // Small input chunks bound each inflation allocation before consume can
        // reject a forged size; never trust a ZIP size as fflate's output cap.
        const inflater = new Inflate(consume);
        for (let start = 0; start < compressedBytes; start += 1024) {
          inflater.push(buffer.subarray(dataOffset + start, dataOffset + Math.min(start + 1024, compressedBytes)), start + 1024 >= compressedBytes);
        }
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
