import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {zipSync} from 'fflate';
import {sign,verify,encrypt,decrypt,saveUrl,documentKey} from '../src/security.mjs';
import {blankDocx,validateDocx} from '../src/docx.mjs';
test('JWT rejects tampering, wrong algorithm, expiry and other keys',()=>{
  const jwt=sign({exp:100,sub:'employee'},'secret');assert.equal(verify(jwt,'secret',99).sub,'employee');
  assert.throws(()=>verify(jwt,'secret',100));assert.throws(()=>verify(jwt,'other',99));
  assert.throws(()=>verify(jwt.replace(/.$/,'z'),'secret',99));
  assert.throws(()=>verify('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.','secret'));
});
test('AES-GCM encrypts secret and detects ciphertext changes',()=>{
  const key=randomBytes(32),encrypted=encrypt('secret',key);assert.equal(decrypt(encrypted,key),'secret');assert.ok(!encrypted.includes('secret'));
  assert.throws(()=>decrypt(encrypted,randomBytes(32)));
});
test('save URL only permits configured ONLYOFFICE cache; signed query survives internal rewrite',()=>{
  const settings={public_url:'https://docs.example.test',internal_url:'http://onlyoffice'};
  assert.equal(saveUrl('https://docs.example.test/cache/files/key/output.docx?md5=abc',settings),'http://onlyoffice/cache/files/key/output.docx?md5=abc');
  for(const u of ['http://169.254.169.254/cache/files/a','https://docs.example.test.evil/cache/files/a','https://docs.example.test@evil/cache/files/a','https://docs.example.test/healthcheck','file:///etc/passwd','https://docs.example.test/cache/files/../../secret']) assert.throws(()=>saveUrl(u,settings));
});
test('OOXML validation rejects fake and macro-enabled files',()=>{
  const files=validateDocx(blankDocx(),1024*1024);
  assert.ok(files['word/document.xml']);
  assert.throws(()=>validateDocx(Buffer.from('fake.docx'),1024));
  files['word/vbaProject.bin']=new Uint8Array([1]);assert.throws(()=>validateDocx(Buffer.from(zipSync(files)),1024*1024));
});
test('document session key stable until version advances',()=>{
  const id=randomUUID();assert.equal(documentKey({id,version:1}),documentKey({id,version:1}));assert.notEqual(documentKey({id,version:1}),documentKey({id,version:2}));
});
