import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { validateFavicon } from './favicon.mjs';
const require=createRequire(new URL('../../office-service/package.json',import.meta.url));
const xml=require('fast-xml-parser');
const svg=body=>new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`);
const image=readFileSync(new URL('../../frontend/src/img/favicon.png',import.meta.url));
test('accepts real square PNG and a simple SVG',()=>{
 assert.equal(validateFavicon(image,'icon.png',xml).mime,'image/png');
 const result=validateFavicon(svg('<rect width="32" height="32" fill="red"/>'),'icon.svg',xml);
 assert.equal(result.mime,'image/svg+xml');assert.match(new TextDecoder().decode(result.bytes),/<rect/);
});
test('ICO frames must agree with square bounds and contain valid image data',()=>{
 const size=image.readUInt32BE(16);assert.ok(size<=256);
 const ico=Buffer.alloc(22+image.length);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=ico[7]=size===256?0:size;ico.writeUInt32LE(image.length,14);ico.writeUInt32LE(22,18);image.copy(ico,22);
 assert.equal(validateFavicon(ico,'icon.ico',xml).mime,'image/x-icon');
 ico[7]=3;assert.throws(()=>validateFavicon(ico,'icon.ico',xml),/квадратной/);
});
test('rejects spoofed formats, corrupt chunks, oversized and non-square files',()=>{
 for(const [file,name] of [[svg(''),'icon.png'],[image,'icon.jpg'],[new Uint8Array(0),'icon.png'],[new Uint8Array(1048577),'icon.png'],[Buffer.concat([image,Buffer.from('payload')]),'icon.png']])assert.throws(()=>validateFavicon(file,name,xml));
 const corrupted=Buffer.from(image);corrupted[40]^=1;assert.throws(()=>validateFavicon(corrupted,'icon.png',xml));
 assert.throws(()=>validateFavicon(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40"/>'),'icon.svg',xml),/квадратной/);
});
test('SVG rejects active content, CSS, namespaces, external URLs and entity expansion',()=>{
 for(const body of ['<script>alert(1)</script>','<g onload="alert(1)"/>','<foreignObject/>','<image href="https://evil.test/pixel"/>','<use href="#id"/>','<path style="fill:red"/>','<path fill="url(https://evil.test)"/>','<style/>','<animate/>','<g xmlns="https://evil.test"/>','<a/>']) assert.throws(()=>validateFavicon(svg(body),'icon.svg',xml),body);
 for(const body of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>','<?xml-stylesheet href="https://evil.test"?><svg/>']) assert.throws(()=>validateFavicon(new TextEncoder().encode(body),'icon.svg',xml));
});
test('SVG supports paths, gradients and internal references without external resources',()=>{
 assert.equal(validateFavicon(svg('<defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#a)" d="M0 0L32 0L32 32Z"/>'),'icon.svg',xml).extension,'svg');
});
