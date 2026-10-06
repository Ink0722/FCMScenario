from pathlib import Path
import json,re,hashlib,shutil,subprocess,tempfile
case=Path('/Users/ink/Desktop/Scminna/01_JPMorgan_Share_Class_8Y');base=case.name
archive=case/'archive/before_native_pdf_format_20261006';archive.mkdir(parents=True,exist_ok=True)
for name in [f'{base}_Prospectus.pdf',f'{base}_Prospectus.json',f'{base}_Notes.md',f'{base}_Material.md']:
 if not (archive/name).exists():shutil.copy2(case/name,archive/name)
ns={'__file__':str(case/'tools/build_01_prospectus.py')};exec((case/'tools/build_01_prospectus.py').read_text().split('body=serialize(p.root)')[0],ns)
root=ns['p'].root;entries=ns['entries'];first=ns['first']
import sys
sys.path.insert(0,str(case.parent/'tools'))
import pdf_document_layout as layout
config=json.loads((case/'tools/pdf_documents.json').read_text());doc=config['documents'][0]
inline=layout.inline;esc=layout.escape
used=[];excluded=[];tables=0;source_page=-2;table_layouts=[];page_labels={};page_overrides={}
toc_pages={e['id']:int(e['zh']) for e in entries if 'U010'<=e['id']<='U048' and e['zh'].isdigit()}
toc_targets={}
for i,e in enumerate(entries):
 if e['id'] in toc_pages or e['id']=='U050':
  toc_targets[e['id']]=next(x['id'] for x in entries[51:] if x['zh']==entries[i-1]['zh'])
target_ids=set(toc_targets.values())
def references(s):
 return re.sub(r'第(\d+)页',lambda m:'第'+r'\pageref{'+('unitU475' if m[1]=='13' else 'originalpage'+m[1])+'}页' if int(m[1])<=28 else m[0],s)

def allunits(n):
 if hasattr(n,'unit'):return [n]
 return [x for c in n.children for x in allunits(c)]

def celltext(n):
 us=allunits(n);used.extend(x.unit for x in us)
 return r'\newline '.join(r'\pageref{unit'+toc_targets[x.unit]+'}' if x.unit in toc_targets else references(inline(x.translation)) for x in us if x.translation.strip())

def footer(n):
 us=allunits(n)
 return bool(us) and all(re.fullmatch(r'\d+',x.translation) or x.translation in ['2011年5月27日','M系列美国股票基金'] for x in us) and any(x.translation=='M系列美国股票基金' or x.translation=='2011年5月27日' for x in us)

def maketable(n):
 global tables
 trs=[x for x in n.children if x.tag=='tr']
 if not trs:
  return ''.join(render(c) for c in n.children)
 if footer(n):excluded.extend(x.unit for x in allunits(n));return ''
 if sum(bool(allunits(tr)) for tr in trs)==1:
  us=allunits(n)
  if us and (us[0].translation.strip()=='•' or us[0].translation.strip().isdigit()):return r'\noindent '+ ' '.join(celltext(td) for tr in trs for td in tr.children if td.tag=='td' and allunits(td))+r'\par\smallskip'
  return ''.join(render(td) for tr in trs for td in tr.children if td.tag=='td')
 if any(c.tag=='table' for tr in trs for td in tr.children for c in td.children):return ''.join(render(td) for tr in trs for td in tr.children if td.tag=='td')
 grid=[];maxcols=0
 for tr in trs:
  row=[];col=0
  for td in [c for c in tr.children if c.tag=='td']:
   span=int(td.attrs.get('colspan','1'));row.append((col,span,td));col+=span
  maxcols=max(maxcols,col);grid.append(row)
 if not allunits(n):return ''
 ids=[x.unit for x in allunits(n)]
 # The source uses spacer columns and separate percent signs in the fee tables.
 if 'U070' in ids or 'U482' in ids:groups=[[0],[1,2,3,4],[5,6,7,8],[9,10,11,12]]
 elif 'U057' in ids:groups=[[0],[1,2],[3,4],[5,6]]
 elif any(x.translation=='购买后的年数' for x in allunits(n)):groups=[[0],list(range(1,maxcols))]
 else:
  occupied=set()
  for row in grid:
   for col,span,td in row:
    if allunits(td) and span<maxcols:occupied.add(col)
  if not occupied:return ''.join(render(td) for tr in trs for td in tr.children if td.tag=='td')
  groups=[[i] for i in sorted(occupied)]
 if len(groups)==1:return ''.join(render(td) for tr in trs for td in tr.children if td.tag=='td')
 prefix=[];rows=[]
 for row in grid:
  filled=[(c,span,td) for c,span,td in row if allunits(td)]
  if not filled:continue
  if len(filled)==1 and filled[0][1]>=maxcols-1:
   prefix.append(r'\noindent\textbf{'+celltext(filled[0][2])+r'}\par\smallskip');continue
  cells=[]
  for g in groups:
   nodes=[td for c,span,td in row if c in g]
   # Join adjacent numeric fragments without changing any source text unit.
   cells.append(' '.join(celltext(td) for td in nodes if allunits(td)))
  rows.append(cells)
 if not rows:return '\n'.join(prefix)
 count=len(groups);tables+=1
 weights=layout.column_weights([[re.sub(r'\\[A-Za-z]+\{?|[{}]','',c) for c in row] for row in rows])
 table_layouts.append({'weights':weights})
 specs=''.join(r'>{\raggedright\arraybackslash}p{'+str(w)+r'\dimexpr\linewidth-'+str(2*count)+r'\tabcolsep\relax}' for w in weights)
 rowtex=lambda c:' & '.join(c)+(r' \\*' if not any(c[1:]) else r' \\')
 header=r'\rowcolor{TableHead} '+rowtex([r'\textbf{'+c+'}' for c in rows[0]])
 body=[rowtex(row)+(r' \addlinespace[3pt]' if i<len(rows)-2 else '') for i,row in enumerate(rows[1:])]
 return '\n'.join([r'\Needspace{8\baselineskip}']+prefix+[r'\begingroup\small\setlength{\tabcolsep}{4pt}\renewcommand{\arraystretch}{1.35}',r'\begin{longtable}{'+specs+'}',r'\toprule',header,r'\midrule\endfirsthead',r'\toprule',header,r'\midrule\endhead',r'\midrule\endfoot',r'\bottomrule\endlastfoot']+body+[r'\end{longtable}\endgroup'])

major={'U051','U240','U285','U313','U475','U661','U700','U790','U837','U951','U955'}
def render(n):
 global source_page
 if hasattr(n,'unit'):
  used.append(n.unit);t=n.translation
  anchor=r'\phantomsection\label{unit'+n.unit+'}' if n.unit in target_ids else ''
  if n.unit=='U000':return '' # Supplied as the document title.
  if not t.strip():return ''
  if re.fullmatch(r'\d+\.',t.strip()) or t.strip()=='•':return r'\noindent '+inline(t)+' '
  if n.unit in major:return r'\section*{'+esc(t)+r'}'+anchor+'\n'
  if n.unit=='U007':return r'\section*{目录}'+'\n'
  bold=first(n,'b');font=first(n,'font')
  fullbold=bold is not None and re.sub(r'\s+',' ',bold.text()).strip()==re.sub(r'\s+',' ',n.text()).strip()
  if fullbold and len(t)<90:
   level=2 if font and int(font.attrs.get('size','2'))>=3 else 3
   return layout.heading(t,level)+anchor+'\n'
  return references(layout.paragraph(t))+'\n\n'+anchor
 if n.tag=='p' and 'page-break-before:always' in n.attrs.get('style','').replace(' ',''):
  source_page+=1
  if 1<=source_page<=28:return r'\par\phantomsection\label{originalpage'+str(source_page)+'}'+'\n'
  return ''
 if n.tag=='table':return maketable(n)+'\n'
 if n.tag in ['head','script','style','h5']:return ''
 return ''.join(render(c) for c in n.children)
body=render(root)
expected={x['id'] for x in entries};assert set(used)|set(excluded)==expected,(expected-set(used)-set(excluded));assert len(used)==len(set(used)),'Duplicate text units'
tex=layout.document_start(config['case_name'],doc['title'],doc['document_id'])+body+r'\end{document}'
texfile=case/'tools'/f'{base}_Prospectus.tex';texfile.write_text(tex)
with tempfile.TemporaryDirectory(prefix='scminna_01_native_',dir='/tmp') as tmp:
 for _ in range(2):
  result=subprocess.run(['/Library/TeX/texbin/xelatex','-interaction=nonstopmode','-halt-on-error','-output-directory='+tmp,str(texfile)],capture_output=True,text=True,cwd=case/'tools')
  if result.returncode:print(result.stdout[-5000:]);raise SystemExit(result.returncode)
 log=Path(tmp,texfile.with_suffix('.log').name).read_text()
 aux=Path(tmp,texfile.with_suffix('.aux').name).read_text()
 page_labels={label:page for label,page in re.findall(r'\\newlabel\{(originalpage\d+|unitU\d+)\}\{\{[^}]*\}\{(\d+)\}',aux)}
 assert all('unit'+u in page_labels for u in target_ids),('Missing pagination labels',page_labels)
 for e in entries:
  t=e['zh']
  if e['id'] in toc_targets:page_overrides[e['id']]=page_labels['unit'+toc_targets[e['id']]]
  elif re.search(r'第\d+页',t):page_overrides[e['id']]=re.sub(r'第(\d+)页',lambda m:'第'+page_labels.get('unitU475' if m[1]=='13' else 'originalpage'+m[1],m[1])+'页',t)
 overflow=[x for x in log.splitlines() if 'Overfull' in x]
 print('Overflow:',overflow)
 if overflow:raise SystemExit('Check layout before replacing PDF')
 shutil.copy2(Path(tmp,texfile.with_suffix('.pdf').name),case/f'{base}_Prospectus.pdf')
 print(re.search(r'Output written on .*?\((\d+) pages',result.stdout,re.S).group(1)+' pages',len(used),'rendered text units',len(excluded),'removed repeated footer units',tables,'tables')

(case/'tools/prospectus_pdf_unit_map.json').write_text(json.dumps(dict(rendered_ids=used,removed_repeated_footer_ids=excluded,source_units=len(entries),tables=tables,body_unchanged=True,rendered_text_overrides=page_overrides,override_scope='TOC and internal page references updated to current PDF pagination only'),ensure_ascii=False,indent=2)+'\n')
doc.update(pages=int(re.search(r'Output written on .*?\((\d+) pages',result.stdout,re.S).group(1)),pdf_sha256=hashlib.sha256((case/doc['pdf']).read_bytes()).hexdigest(),tables=table_layouts,rendering='native_xelatex',qa_status='compiled_no_overflow')
(case/'tools/pdf_documents.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
