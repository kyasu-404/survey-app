import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {blankDocx,validateDocx} from '../src/docx.mjs';
import {blankXlsx,readTemplate,checkTemplate,templateSources,responseValues,renderTemplate,generateArchive} from '../src/templates.mjs';
const id=randomUUID(),numberId=randomUUID();
const form={title:'Сведения',schema:{pages:[{name:'p',elements:[{type:'text',name:'org',title:'Организация',integrationId:id},{type:'text',inputType:'number',name:'count',integrationId:numberId}]}]}};
const responses=Array.from({length:20},(_,i)=>({id:randomUUID(),created_at:'2026-09-14T10:00:00Z',data:{org:`Организация ${i+1} & <test>`,count:i}}));
test('headings and panels share scoped document paths and dynamic record labels',()=>{
 const field=name=>({type:'text',name,title:name,integrationId:randomUUID()});
 const elements=[
  {type:'sectiontitle',name:'h',title:'Сведения',integrationId:randomUUID()},field('a'),
  {type:'panel',name:'p',title:'Контакты',elements:[field('b'),{type:'sectiontitle',name:'inner',title:'Связь'},field('c')]},
  field('d'),{type:'sectiontitle',name:'h2',title:'Итог'},field('e'),
 ];
 const f={title:'Тест',schema:{pages:[{title:'Страница',elements},{title:'Следующая',elements:[field('outside')]}]}};
 assert.deepEqual(templateSources(f.schema).map(q=>[q.name,q.path]),[['a','Страница / Сведения'],['b','Страница / Сведения / Контакты'],['c','Страница / Сведения / Контакты / Связь'],['d','Страница / Сведения'],['e','Страница / Итог'],['outside','Следующая']]);
 f.schema.pages=[{elements:[{type:'paneldynamic',name:'people',integrationId:id,templateElements:elements}]}];
 const values=responseValues(f,{...responses[0],data:{people:[{a:'А',b:'Б',c:'В',d:'Г',e:'Д',h:'не ответ',p:'не ответ'}]}});
 assert.equal(values.get('question:'+id),'Запись 1\nСведения / a: А\nСведения / Контакты / b: Б\nСведения / Контакты / Связь / c: В\nСведения / d: Г\nИтог / e: Д');
 const xml=strFromU8(unzipSync(renderTemplate(readTemplate(docx(),'docx'),values))['word/document.xml']);
 assert.ok(xml.includes('Сведения / Контакты / Связь / c: В'));assert.ok(xml.includes('<w:br/>'));assert.ok(!xml.includes('не ответ'));
});
test('matrix and Other answers use labels and line breaks in document bindings',()=>{
 const choices=[{value:'a',text:'Первый'},{value:'b',text:'Второй'}];
 const cases=[
  [{type:'dropdown',showOtherItem:true},'other','Свой'],
  [{type:'checkbox',showOtherItem:true,choices},['a','other'],'Первый; Свой'],
  [{type:'matrix',rows:[{value:'r',text:'Строка'}],columns:choices},{r:'b'},'Строка: Второй'],
  [{type:'matrixdropdown',rows:[{value:'r',text:'Строка'}],columns:[{name:'c',title:'Столбец',choices}]},{r:{c:'a'}},'Строка\n  Столбец: Первый'],
  [{type:'matrixdynamic',columns:[{name:'c',title:'Столбец',showOtherItem:true}]},[{c:'other','c-Comment':'Вложенный'}],'Строка 1\nСтолбец: Вложенный'],
  [{type:'multipletext',items:[{name:'a',title:'Имя'},{name:'b',title:'Счёт'}]},{a:'Анна',b:0},'Имя: Анна\nСчёт: 0'],
  [{type:'ranking',choices},['b','a'],'1. Второй\n2. Первый'],
  [{type:'paneldynamic',templateElements:[{type:'dropdown',name:'c',title:'Выбор',showOtherItem:true}]},[{c:'other','c-Comment':'Вложенный'}],'Запись 1\nВыбор: Вложенный'],
 ];
 for(const [definition,value,expected] of cases){
  const f={title:'Тест',schema:{pages:[{elements:[{...definition,name:'q',integrationId:id}]}]}};
  assert.equal(responseValues(f,{...responses[0],data:{q:value,'q-Comment':'Свой'}}).get('question:'+id),expected);
 }
});
test('dynamic panels use field labels and numbered multiline entries in DOCX and XLSX bindings',()=>{
 const panelForm={title:'Сотрудники',schema:{pages:[{elements:[{type:'panel',name:'section',title:'Раздел',elements:[
  {type:'paneldynamic',name:'people',integrationId:id,templateElements:[
   {type:'text',name:'name',title:'Имя'},
   {type:'dropdown',name:'role',title:'Должность',choices:[{value:'teacher',text:'Учитель'}]},
   {type:'panel',name:'details',title:'Данные',elements:[{type:'number',name:'count',title:'Количество'}]},
  ]},
 ]}]}]}};
 const response={...responses[0],data:{people:[{name:'Анна & <тест>',role:'teacher',count:0},{name:'Борис',role:'teacher',count:2}]}};
 const values=responseValues(panelForm,response),expected='Запись 1\nИмя: Анна & <тест>\nДолжность: Учитель\nДанные / Количество: 0\n\nЗапись 2\nИмя: Борис\nДолжность: Учитель\nДанные / Количество: 2';
 assert.equal(values.get('question:'+id),expected);
 const word=strFromU8(unzipSync(renderTemplate(readTemplate(docx(),'docx'),values))['word/document.xml']);
 assert.ok(word.includes('Имя: Анна &amp; &lt;тест&gt;'));assert.ok(word.includes('<w:br/>'));assert.ok(!word.includes('teacher'));
 const excelFiles=unzipSync(renderTemplate(readTemplate(xlsx(),'xlsx'),values));
 const excel=strFromU8(excelFiles['xl/worksheets/sheet1.xml']);
 assert.ok(excel.includes('Запись 1\nИмя: Анна &amp; &lt;тест&gt;'));assert.ok(excel.includes('xml:space="preserve"'));
 assert.ok(strFromU8(excelFiles['xl/styles.xml']).includes('wrapText="1"'));
 assert.ok(strFromU8(excelFiles['[Content_Types].xml']).includes('/xl/styles.xml'));
 assert.ok(strFromU8(excelFiles['xl/_rels/workbook.xml.rels']).includes('/styles'));
 assert.ok(excel.includes('ht="141"'));
});
test('multiline values clone the bound cell style while preserving fonts, borders and other template cells',()=>{
 const files=unzipSync(xlsx());
 files['xl/styles.xml']=strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/></font></fonts><fills count="1"><fill/></fills><borders count="2"><border/><border><left style="thin"/></border></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1"><alignment horizontal="right" wrapText="0"/></xf></cellXfs></styleSheet>');
 const template=readTemplate(Buffer.from(zipSync(files)),'xlsx');
 const result=unzipSync(renderTemplate(template,responseValues(form,{...responses[0],data:{org:'Первая строка\nВторая строка',count:3}})));
 const styles=strFromU8(result['xl/styles.xml']),sheet=strFromU8(result['xl/worksheets/sheet1.xml']);
 assert.ok(styles.includes('count="3"'));
 assert.ok(styles.includes('horizontal="right" wrapText="0"'));
 assert.ok(styles.includes('fontId="1" fillId="0" borderId="1" applyAlignment="1"'));
 assert.ok(styles.includes('horizontal="right" wrapText="1" vertical="top"'));
 assert.ok(sheet.includes('r="B1" s="2"'));assert.ok(sheet.includes('r="B2" s="2"'));
 assert.ok(sheet.includes('<f>C1*2</f>'));assert.ok(sheet.includes('width="32"'));
 assert.ok(strFromU8(template.files['xl/styles.xml']).includes('count="2"'));
});
function docx(){const files=validateDocx(blankDocx(),1024*1024);const control=`<w:sdt><w:sdtPr><w:tag w:val="survey-question:${id}"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>[Организация]</w:t></w:r></w:sdtContent></w:sdt>`;files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('<w:p/>',`<w:p>${control}<w:r><w:t> / </w:t></w:r>${control}</w:p>`));return Buffer.from(zipSync(files));}
function xlsx(){const files=unzipSync(blankXlsx()),name=()=>`_survey_q_${id.replaceAll('-','')}_${randomUUID().replaceAll('-','')}`;files['xl/workbook.xml']=strToU8(strFromU8(files['xl/workbook.xml']).replace('</workbook>',`<definedNames><definedName name="${name()}">'Лист1'!$B$1</definedName><definedName name="${name()}">'Лист1'!$B$2</definedName><definedName name="_survey_q_${numberId.replaceAll('-','')}_${randomUUID().replaceAll('-','')}">'Лист1'!$C$1</definedName></definedNames></workbook>`));files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<sheetData/>','<cols><col min="2" max="2" width="32" customWidth="1"/></cols><sheetData><row r="1"><c r="B1" s="1" t="inlineStr"><is><t>[Организация]</t></is></c><c r="C1" t="inlineStr"><is><t>[Число]</t></is></c><c r="D1"><f>C1*2</f><v>99</v></c></row><row r="2"><c r="B2" s="1" t="inlineStr"><is><t>[Организация]</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A4:D4"/></mergeCells>'));return Buffer.from(zipSync(files));}
test('20 responses create 20 DOCX: independent values, repeated fields, formatting; template unchanged',()=>{
 const bytes=docx(),original=Buffer.from(bytes),archive=unzipSync(generateArchive({bytes,format:'docx',form,responses,name:'Справка.docx'}));assert.equal(Object.keys(archive).length,20);assert.deepEqual(bytes,original);
 Object.values(archive).forEach((file,i)=>{const xml=strFromU8(unzipSync(file)['word/document.xml']);assert.equal((xml.match(new RegExp(`Организация ${i+1} &amp; &lt;test&gt;`,'g'))||[]).length,2);assert.ok(xml.includes('<w:b/>'));assert.ok(xml.includes('w:val="32"'));assert.ok(!xml.includes('survey-question:'));});
 assert.ok(strFromU8(unzipSync(bytes)['word/document.xml']).includes('[Организация]'));
});
test('20 XLSX preserve layout, formulas, numeric zero and repeated fields; text cannot inject formulas',()=>{
 const bytes=xlsx(),original=Buffer.from(bytes),items=unzipSync(generateArchive({bytes,format:'xlsx',form,responses,name:'Макет.xlsx',nameQuestionId:id}));assert.equal(Object.keys(items).length,20);assert.deepEqual(bytes,original);
 Object.values(items).forEach((file,i)=>{const f=unzipSync(file),xml=strFromU8(f['xl/worksheets/sheet1.xml']);assert.ok(xml.includes(`t="n"><v>${i}</v>`));assert.ok(xml.includes('s="1"'));assert.ok(xml.includes('width="32"'));assert.ok(xml.includes('A4:D4'));assert.ok(xml.includes('<f>C1*2</f>'));assert.ok(!xml.includes('<v>99</v>'));assert.ok(!strFromU8(f['xl/workbook.xml']).includes('_survey_q_'));});
 const r={...responses[0],data:{org:'=HYPERLINK("http://evil")',count:0}};
 const xml=strFromU8(unzipSync(renderTemplate(readTemplate(bytes,'xlsx'),responseValues(form,r)))['xl/worksheets/sheet1.xml']);assert.ok(xml.includes('t="inlineStr"'));assert.equal((xml.match(/<f>/g)||[]).length,1);
});
test('renames keep stable ID; deleted question, missing cell, empty template and oversized batches fail',()=>{
 const renamed=structuredClone(form);renamed.schema.pages[0].elements[0].title='Другое название';assert.ok(checkTemplate(readTemplate(docx(),'docx'),renamed).every(b=>!b.error));
 renamed.schema.pages[0].elements=[];assert.throws(()=>generateArchive({bytes:docx(),format:'docx',form:renamed,responses,name:'x.docx'}),/Вопрос удалён/);
 assert.throws(()=>generateArchive({bytes:blankXlsx(),format:'xlsx',form,responses,name:'x.xlsx'}),/нет полей/);
 assert.throws(()=>generateArchive({bytes:docx(),format:'docx',form,responses:Array(501).fill(responses[0]),name:'x.docx'}),/500/);
 const files=unzipSync(xlsx());files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('r="B1"','r="B3"'));assert.ok(checkTemplate(readTemplate(Buffer.from(zipSync(files)),'xlsx'),form).some(b=>b.error));
});
test('reuploaded template retains IDs without DB bindings; system fields and filenames are safe',()=>{
 const bytes=xlsx();assert.equal(readTemplate(bytes,'xlsx').bindings.length,3);const values=responseValues(form,{...responses[0],data:{org:'../../same:name',count:0}});assert.equal(values.get('system:form_title'),'Сведения');assert.match(values.get('system:response_date'),/13:00:00/);
 const files=unzipSync(generateArchive({bytes,format:'xlsx',form,responses:[{...responses[0],data:{org:'../../same:name'}}],name:'a.xlsx',nameQuestionId:id}));assert.ok(Object.keys(files).every(n=>!n.includes('/') && !n.includes('\\')));
});
test('XLSX note tags follow individual cells, survive reupload, and are removed only from generated copies',()=>{
 const files=unzipSync(blankXlsx());
 files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<sheetData/>','<sheetData><row r="3"><c r="C3" t="inlineStr"><is><t>[Организация]</t></is></c><c r="D3" t="inlineStr"><is><t>[Организация]</t></is></c></row></sheetData>'));
 files['xl/worksheets/_rels/sheet1.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/></Relationships>');
 files['xl/comments/comment1.xml']=strToU8(`<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Данные формы</author></authors><commentList><comment ref="C3" authorId="0"><text><t>Данные формы:&#xA;survey-question:${id}&#xA;</t></text></comment><comment ref="D3" authorId="0"><text><r><t>survey-question:${id}</t></r></text></comment><comment ref="E3" authorId="0"><text><t>Обычное примечание</t></text></comment></commentList></comments>`);
 const bytes=Buffer.from(zipSync(files)),template=readTemplate(bytes,'xlsx');assert.equal(template.bindings.length,2);assert.ok(checkTemplate(template,form).every(b=>!b.error));
 const archive=unzipSync(generateArchive({bytes,format:'xlsx',form,responses,name:'Справка.xlsx'}));assert.equal(Object.keys(archive).length,20);
 Object.values(archive).forEach((file,i)=>{const result=unzipSync(file),xml=strFromU8(result['xl/worksheets/sheet1.xml']),notes=strFromU8(result['xl/comments/comment1.xml']);assert.equal((xml.match(new RegExp(`Организация ${i+1} &amp; &lt;test&gt;`,'g'))||[]).length,2);assert.ok(!notes.includes('survey-question:'));assert.ok(notes.includes('Обычное примечание'));});
 assert.equal(readTemplate(bytes,'xlsx').bindings.length,2);
});
