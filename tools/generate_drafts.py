from pathlib import Path
import json,re,sys,hashlib
from pdf_document_layout import document_start,heading,paragraph,table,column_weights,compile_pdf
root=Path(__file__).resolve().parent.parent

def build_case(number):
 d=root/'research'/f'{number:02d}';mp=d/'pdf_documents.json';config=json.loads(mp.read_text());output=root/'build/drafts'/f'{number:02d}';output.mkdir(parents=True,exist_ok=True)
 for doc in config['documents']:
  if doc.get('format')=='aligned_source_units':continue
  lines=(d/doc['content_source']).read_text().splitlines()[doc['start_line']:doc['end_line']];body=[];i=0;tables=[]
  while i<len(lines):
   line=lines[i].strip()
   if str(doc['start_line']+i) in doc.get('omitted_source_lines',{}):i+=1;continue
   for old,new in doc.get('rendered_text_replacements',{}).items():line=line.replace(old,new)
   if not line:i+=1;continue
   if i==0 and doc.get('leading_source_heading')==line:i+=1;continue
   if line.startswith('|'):
    block=[]
    while i<len(lines) and lines[i].strip().startswith('|'):block.append(lines[i]);i+=1
    rows=[[c.strip() for c in x.strip().strip('|').split('|')] for x in block if not re.fullmatch(r'[\s|:\-]+',x)]
    tables.append({'header':rows[0],'weights':column_weights(rows)})
    body.append(table(block));continue
   key=re.sub(r'^#{1,6}\s+','',line)
   if key in doc.get('body_labels',[]):
    body.append(paragraph(key)+'\n\n');i+=1;continue
   if key in doc['headings']:
    level=doc.get('heading_overrides_by_source_line',{}).get(str(doc['start_line']+i),doc['headings'][key]['level'])
    body.append(heading(key,level));i+=1;continue
   if line.startswith('### '):body.append(heading(key,2));i+=1;continue
   if line.startswith('#### '):body.append(heading(key,3));i+=1;continue
   body.append(paragraph(line)+'\n\n');i+=1
  tex=document_start(config['case_name'],doc['title'],doc['document_id'])+'\n'.join(body)+r'\end{document}'
  tf=output/Path(doc['pdf']).with_suffix('.tex').name;tf.write_text(tex)
  pages=compile_pdf(tf,output/doc['pdf']);doc.update(pages=pages,pdf_sha256=hashlib.sha256((output/doc['pdf']).read_bytes()).hexdigest(),rendering='native_xelatex',tables=tables,content_sha256=hashlib.sha256('\n'.join(lines).encode()).hexdigest(),qa_status='compiled_no_overflow')
  print(doc['document_id'],pages,doc['title'],flush=True)
 (output/'pdf_documents.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
 for n in [int(x) for x in sys.argv[1:]] or list(range(1,21)):
  if n==1:
   import subprocess
   subprocess.run([sys.executable,str(root/'research/01/generation/generate_prospectus.py')],check=True)
  else:build_case(n)
