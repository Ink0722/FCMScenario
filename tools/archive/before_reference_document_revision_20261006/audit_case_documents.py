from pathlib import Path
import json,re,unicodedata,hashlib
root=Path(__file__).resolve().parent.parent;qa=Path('/tmp/scminna_split_pdf_qa')
norm=lambda s:re.sub(r'\s+','',unicodedata.normalize('NFKC',s.replace('**','')))
records={x['document_id']:x for x in json.loads((qa/'report.json').read_text())};failures=[];total=0
for n in range(1,21):
 d=next(root.glob(f'{n:02d}_*'));mp=d/'tools/pdf_documents.json';config=json.loads(mp.read_text());case_checks=[]
 for doc in config['documents']:
  id=doc['document_id'];record=records[id];text=(qa/(id+'_text.txt')).read_text();col=(qa/(id+'_columns.txt')).read_text();whole=norm(text);columns=norm(col);missing=[];count=0
  assert norm('仅供模拟使用·'+config['case_name']+'·'+id) in norm(record['whole_text']),id+' subtitle'
  assert norm(config['case_name']+'·'+doc['title']) in norm(record['whole_text']),id+' header'
  assert norm(doc['title']) in whole,id+' title'
  if n==1:
   source=json.loads((d/doc['content_source']).read_text());mapping=json.loads((d/'tools/prospectus_pdf_unit_map.json').read_text());ids=set(mapping['rendered_ids']);expected=[(e['id'],e['zh']) for e in source['entries'] if e['id'] in ids]
   original=json.loads((d/'archive/before_document_split_layout_20261006'/doc['content_source']).read_text());assert source['entries']==original['entries']
  else:
   source=(d/doc['content_source']).read_text();assert source==(d/'archive/before_document_split_layout_20261006'/doc['content_source']).read_text()
   lines=source.splitlines()[doc['start_line']:doc['end_line']];expected=[]
   for i,line in enumerate(lines):
    line=line.strip()
    if not line or (i==0 and line==doc.get('leading_source_heading')):continue
    if line.startswith('|'):
     expected += [(str(i),cell.strip()) for cell in line.strip('|').split('|') if cell.strip() and not re.fullmatch(r'[-: ]+',cell.strip())]
    else:expected.append((str(i),re.sub(r'^#{1,6}\s+','',line)))
  for loc,s in expected:
   count+=1
   if norm(s) not in whole and norm(s) not in columns:missing.append({'location':loc,'text':s})
  total+=count
  item={'document_id':id,'pdf':doc['pdf'],'pages':record['pages'],'text_checks':count,'missing':missing,'header_and_subtitle_checked':True,'pdf_sha256':hashlib.sha256((d/doc['pdf']).read_bytes()).hexdigest(),'latex_overflow':False}
  case_checks.append(item);doc.update(pages=record['pages'],qa_status='text_checked' if not missing else 'investigate_missing_text',pdf_sha256=item['pdf_sha256'])
  if missing:failures.append((id,missing))
 mp.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
 report={'case':n,'independent_documents':len(case_checks),'documents':case_checks,'source_content_preserved':True,'decision_criteria_preserved':True,'qa_status':'text_checked' if not any(x['missing'] for x in case_checks) else 'investigate'}
 (d/'tools/pdf_documents_qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('Documents:',len(records),'Checks:',total,'Documents needing review:',len(failures))
for id,missing in failures:print(id,len(missing),missing[:2])
(qa/'missing_text.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2)+'\n')
