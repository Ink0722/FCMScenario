"""Check current file paths, document pairs, hashes and relative Markdown links."""
from pathlib import Path
from urllib.parse import unquote
import json,re,hashlib
ROOT=Path(__file__).resolve().parent.parent

def main():
 index=json.loads((ROOT/'research/case_index.json').read_text());assert len(index)==20
 docs=0;links=0
 for row in index:
  case=ROOT/'cases'/row['folder'];research=ROOT/'research'/row['number'];m=json.loads((research/'pdf_documents.json').read_text())
  assert case.exists() and research.exists()
  assert {p.name for p in case.iterdir() if p.is_dir()}=={'latex'},case
  expected={'material.md','notes.md'}|{d['pdf'] for d in m['documents']}
  assert {p.name for p in case.iterdir() if p.is_file() and p.name!='.DS_Store'}==expected,case
  for doc in m['documents']:
   pdf=case/doc['pdf'];tex=case/doc['latex_source'];source=research/doc['content_source']
   assert pdf.exists() and tex.exists() and source.exists(),doc['document_id']
   assert pdf.stem==tex.stem,doc['document_id']
   assert hashlib.sha256(pdf.read_bytes()).hexdigest()==doc['pdf_sha256'],doc['document_id']+' PDF hash'
   assert hashlib.sha256(tex.read_bytes()).hexdigest()==doc['latex_sha256'],doc['document_id']+' LaTeX hash'
   assert doc['document_id']==pdf.name[:5]
   if row['number']!='01' and m.get('content_revision'):assert hashlib.sha256(source.read_bytes()).hexdigest()==m['content_revision']['current_sha256']
   docs+=1
  for name in ['material.md','notes.md']:
   p=case/name
   for target in re.findall(r'\]\(([^\n)]+)\)',p.read_text()):
    target=target.strip('<>')
    if target.startswith(('http:','https:','app:','#','/Users/ink/Downloads/')):continue
    rel=unquote(target.split('#')[0]);assert (p.parent/rel).exists(),(p,target)
    links+=1
 assert docs==42
 for p in (ROOT/'research').rglob('source_manifest.json'):
  data=json.loads(p.read_text());records=data if isinstance(data,list) else data.get('sources',[])
  for item in records:
   if not isinstance(item,dict):continue
   file=item.get('file')
   if file and item.get('status')=='downloaded':
    source=p.parent/file;assert source.exists(),source
    if item.get('sha256'):assert hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256'],source
 from materials import load_bundle
 bundle=load_bundle(ROOT)
 assert len(bundle['scenarios'])==20
 print('Shared copy and 20 canonical materials verified.')
 print('20 cases,',docs,'PDF/LaTeX pairs,',links,'local Markdown links verified; source download hashes intact.')

if __name__=='__main__':main()
