"""Compile the editable, authoritative LaTeX files. Never regenerate their text."""
from pathlib import Path
import argparse,json,hashlib,shutil
from pdf_document_layout import compile_pdf
ROOT=Path(__file__).resolve().parent.parent

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('cases',nargs='*',type=int,help='Case numbers; default: all 20')
 parser.add_argument('--document',help='Only this document ID, e.g. 14-02')
 parser.add_argument('--check',action='store_true',help='Compile into ignored build/ without replacing formal PDFs')
 args=parser.parse_args();selected=set(args.cases);records=[];found=False
 for mp in sorted((ROOT/'research').glob('[0-9][0-9]/pdf_documents.json')):
  config=json.loads(mp.read_text());number=int(config['case_number'])
  if selected and number not in selected:continue
  case=ROOT/config['case_folder'];changed=False
  for doc in config['documents']:
   if args.document and args.document!=doc['document_id']:continue
   found=True;tex=case/doc['latex_source'];formal=case/doc['pdf']
   dest=ROOT/'build/check'/str(config['case_number'])/doc['pdf']
   dest.parent.mkdir(parents=True,exist_ok=True)
   pages=compile_pdf(tex,dest);digest=hashlib.sha256(dest.read_bytes()).hexdigest()
   if not args.check:
    shutil.copy2(dest,formal);doc.update(pages=pages,pdf_sha256=digest,latex_sha256=hashlib.sha256(tex.read_bytes()).hexdigest(),qa_status='compiled_no_overflow');changed=True
   records.append({'document_id':doc['document_id'],'pages':pages,'expected_pages_before_build':doc['pages'],'formal_pdf_replaced':not args.check,'latex_source':str(tex.relative_to(ROOT)),'output':str(dest.relative_to(ROOT)),'pdf_sha256':digest,'overflow':False})
   print(doc['document_id'],pages,'pages',flush=True)
  if changed:
   mp.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
   data=mp.parent/('prospectus.json' if number==1 else 'reference.json');info=json.loads(data.read_text());info.update(documents=config['documents'],pages=sum(d['pages'] for d in config['documents']),qa_status='compiled_no_overflow')
   if number==1:info['pdf_layout'].update(pages=config['documents'][0]['pages'],pdf_sha256=config['documents'][0]['pdf_sha256'])
   data.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
   for qa in (mp.parent/'qa').glob('*_qa.json'):
    info=json.loads(qa.read_text());info['qa_status']='requires_text_and_visual_recheck';qa.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
 if not found:parser.error('No document matched the requested case/document')
 (ROOT/'build/pdf_compile_report.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
 print('Compiled',len(records),'documents. Formal LaTeX files were not changed.')

if __name__=='__main__':main()
