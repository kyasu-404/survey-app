import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
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
test('OOXML rejects mismatched ZIP counts before unchecked members are decompressed',()=>{
  const files=unzipSync(blankDocx());
  files['word/vbaProject.bin']=new Uint8Array([1,2,3]);
  const archive=Buffer.from(zipSync(files));
  const end=archive.length-22;
  archive.writeUInt16LE(1,end+10);
  assert.throws(()=>validateDocx(archive,1024*1024));
});
test('OOXML rejects ZIP64 and multidisk directory metadata',()=>{
  for(const mutate of [
    b=>b.writeUInt16LE(1,b.length-18),
    b=>b.writeUInt16LE(0xffff,b.length-14),
    b=>b.writeUInt32LE(0x07064b50,b.length-42),
    b=>b.writeUInt32LE(1,b.length-10),
  ]){
    const archive=Buffer.from(blankDocx());mutate(archive);
    assert.throws(()=>validateDocx(archive,1024*1024));
  }
});

test('OOXML rejects a forged small size before inflating the full oversized member',()=>{
 const files=unzipSync(blankDocx());
 files['word/oversized.bin']=new Uint8Array(41*1024*1024);
 const archive=Buffer.from(zipSync(files,{level:9}));
 let offset=archive.readUInt32LE(archive.length-22+16);
 const entries=archive.readUInt16LE(archive.length-22+10);
 for(let i=0;i<entries;i++){
  const size=archive.readUInt16LE(offset+28), extra=archive.readUInt16LE(offset+30), comment=archive.readUInt16LE(offset+32);
  if(archive.subarray(offset+46,offset+46+size).toString()==='word/oversized.bin'){
   const local=archive.readUInt32LE(offset+42);
   archive.writeUInt32LE(1,offset+24);archive.writeUInt32LE(1,local+22);
  }
  offset+=46+size+extra+comment;
 }
 assert.throws(()=>validateDocx(archive,1024*1024));
 assert.ok(validateDocx(blankDocx(),1024*1024)['word/document.xml']);
});

test('OOXML streaming inflation preserves binary members spanning compressed chunks',()=>{
 const files=unzipSync(blankDocx());
 const binary=randomBytes(96*1024);
 files['word/media/image.bin']=binary;
 const archive=Buffer.from(zipSync(files,{level:6}));
 assert.deepEqual(Buffer.from(validateDocx(archive,1024*1024)['word/media/image.bin']),binary);
});
