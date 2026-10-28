import { describe,expect,it } from "vitest";
import { normalizeEmbeddingOrigin,validateFaviconFile } from "./api";
import { readFileSync } from "node:fs";
function file(bytes:Uint8Array,name:string) {return {name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)} as File;}
describe("embedding origins",()=>{
 it("normalizes exact sites, ports and international names",()=>{
  expect(normalizeEmbeddingOrigin(" HTTPS://WWW.Example.ru:443/ ")).toBe("https://www.example.ru");
  expect(normalizeEmbeddingOrigin("https://пример.рф")).toBe("https://xn--e1afmkfd.xn--p1ai");
  expect(normalizeEmbeddingOrigin("http://localhost:5173")).toBe("http://localhost:5173");
 });
 it("rejects paths, credentials, wildcards, invalid schemes and port zero",()=>{
  for(const value of ["example.ru","javascript:alert(1)","https://*.example.ru","https://user:password@example.ru","https://example.ru/path","https://example.ru?x=1","https://example.ru/#x","https://example.ru:0","https://example.ru;script-src *"])expect(()=>normalizeEmbeddingOrigin(value)).toThrow();
 });
});
it("validates actual favicon content and square dimensions before preview",async()=>{
 const png=readFileSync('src/img/favicon.png');await expect(validateFaviconFile(file(png,"icon.png"))).resolves.toBeUndefined();
 await expect(validateFaviconFile(file(png,"icon.jpg"))).rejects.toThrow("PNG, SVG и ICO");
 const svg=(text:string)=>file(new TextEncoder().encode(text),"icon.svg");
 await expect(validateFaviconFile(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0L32 32"/></svg>'))).resolves.toBeUndefined();
 await expect(validateFaviconFile(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20"/>'))).rejects.toThrow("квадратной");
 await expect(validateFaviconFile(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><image href="https://evil.test"/></svg>'))).rejects.toThrow("внешние ссылки");
});

it("rejects SVG namespace, attribute, animation and XML variants before preview", async () => {
 const svg=(body:string)=>file(new TextEncoder().encode(body),"icon.svg");
 for (const text of [
  '<svg xmlns="https://foreign.test" viewBox="0 0 32 32"><path/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g xmlns="http://www.w3.org/1999/xhtml"><path/></g></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path unknown="value"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path src="https://evil.test"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><s:path/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><set attributeName="onload" to="alert(1)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><animate/></svg>',
  '<?xml-stylesheet href="https://evil.test"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>',
  '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>&amp;</title></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="20"/>',
 ]) await expect(validateFaviconFile(svg(text)), text).rejects.toThrow();
 const passive = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#a)" d="M0 0L32 32"/></svg>';
 await expect(validateFaviconFile(svg(passive))).resolves.toBeUndefined();
 await expect(validateFaviconFile(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'+'<g>'.repeat(33)+'<path/>'+'</g>'.repeat(33)+'</svg>'))).rejects.toThrow("Слишком сложный SVG");
});
