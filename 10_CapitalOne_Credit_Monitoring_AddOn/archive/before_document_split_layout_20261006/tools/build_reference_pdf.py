from pathlib import Path
import json,re,subprocess,tempfile,shutil,sys
case=Path(__file__).resolve().parent.parent
source=next(case.glob('*_Reference.txt'))
metadata=json.loads(source.with_suffix('.json').read_text())
headings={x['heading'] for x in metadata['sections']}
def escape(s):
 mapping={'\\':r'\textbackslash{}','&':r'\&','%':r'\%','$':r'\$','#':r'\#','_':r'\_','{':r'\{','}':r'\}','~':r'\textasciitilde{}','^':r'\textasciicircum{}'}
 return ''.join(mapping.get(c,c) for c in s)
def inline(s):
 return ''.join(r'\textbf{'+escape(x)+r'}' if i%2 else escape(x) for i,x in enumerate(s.split('**')))
def table(lines):
 rows=[[c.strip() for c in x.strip().strip('|').split('|')] for x in lines if not re.fullmatch(r'[\s|:\-]+',x)]
 count=len(rows[0]);assert all(len(row)==count for row in rows)
 weights={2:[.68,.32],3:[.24,.38,.38],4:[.26,.14,.27,.33],5:[.14,.13,.15,.29,.29]}.get(count,[1/count]*count)
 # Include all cell padding in the width budget.
 specs=''.join(r'>{\raggedright\arraybackslash}p{'+str(round(w,5))+r'\dimexpr\linewidth-'+str(2*count)+r'\tabcolsep\relax}' for w in weights)
 row=lambda cells:' & '.join(inline(c) for c in cells)+r' \\'
 h=r'\rowcolor{TableHead} '+row([r for r in rows[0]])
 return '\n'.join([r'\begingroup\small\setlength{\tabcolsep}{4pt}\renewcommand{\arraystretch}{1.35}',r'\begin{longtable}{'+specs+'}',r'\toprule',h,r'\midrule\endfirsthead',r'\toprule',h,r'\midrule\endhead',r'\midrule\endfoot',r'\bottomrule\endlastfoot']+[row(c)+r' \addlinespace[3pt]' for c in rows[1:]]+[r'\end{longtable}\endgroup'])
lines=source.read_text().splitlines();title=lines[0];subtitle=lines[1];body=[];i=2
while i<len(lines):
 line=lines[i].strip()
 if not line:i+=1;continue
 if line.startswith('|'):
  block=[]
  while i<len(lines) and lines[i].strip().startswith('|'):block.append(lines[i]);i+=1
  body.append(table(block));continue
 if line in headings:body.append(r'\section*{'+escape(line)+r'}');i+=1;continue
 if line.startswith('### '):body.append(r'\subsection*{'+escape(line[4:])+r'}');i+=1;continue
 body.append(inline(line)+'\n\n');i+=1
preamble=r'''\documentclass[UTF8,fontset=none,11pt,a4paper]{ctexart}
\usepackage[left=21mm,right=21mm,top=22mm,bottom=22mm,headheight=15pt,headsep=8mm]{geometry}
\usepackage{fontspec}
\setmainfont{texgyretermes-regular.otf}[BoldFont=texgyretermes-bold.otf,ItalicFont=texgyretermes-italic.otf]
\setCJKmainfont{Songti.ttc}[Path=/System/Library/Fonts/Supplemental/,FontIndex=6,AutoFakeBold=2]
\setCJKsansfont{Songti.ttc}[Path=/System/Library/Fonts/Supplemental/,FontIndex=6,AutoFakeBold=2]
\usepackage[table]{xcolor}
\definecolor{TableHead}{HTML}{EEF0ED}
\definecolor{Muted}{HTML}{666C68}
\usepackage{booktabs,longtable,array,fancyhdr,needspace}
\usepackage[unicode,hidelinks]{hyperref}
\linespread{1.30}
\setlength{\parindent}{2em}
\setlength{\parskip}{4pt}
\setlength{\LTpre}{8pt}\setlength{\LTpost}{10pt}
\ctexset{section={format=\large\bfseries,beforeskip=18pt,afterskip=8pt},subsection={format=\normalsize\bfseries,beforeskip=12pt,afterskip=6pt}}
\pagestyle{fancy}\fancyhf{}
\renewcommand{\headrulewidth}{.3pt}
\renewcommand{\footrulewidth}{0pt}
'''
case_num=case.name[:2]
preamble+=r'\fancyhead[L]{\small\color{Muted}'+escape(title)+r'}'+'\n'
preamble+=r'\fancyhead[R]{\small\color{Muted}'+case_num+r'}'+'\n'
preamble+=r'\fancyfoot[C]{\small\color{Muted}\thepage}'+'\n'
preamble+=r'\hypersetup{pdftitle={'+escape(title)+r'},pdfauthor={金融决策模拟材料}}'+'\n'
tex=preamble+r'\begin{document}'+'\n'+r'{\noindent\LARGE\bfseries '+escape(title)+r'\par}'+'\n'+r'\vspace{7pt}{\noindent\small\color{Muted}'+escape(subtitle)+r'\par}\vspace{10pt}'+'\n'+'\n'.join(body)+r'\end{document}'+'\n'
texfile=case/'tools'/source.with_suffix('.tex').name;texfile.write_text(tex)
with tempfile.TemporaryDirectory(prefix='scminna_pdf_',dir='/tmp') as temp:
 command=['/Library/TeX/texbin/xelatex','-interaction=nonstopmode','-halt-on-error','-output-directory='+temp,str(texfile)]
 for _ in range(2):
  result=subprocess.run(command,capture_output=True,text=True,cwd=case/'tools')
  if result.returncode:
   print(result.stdout[-5000:]);sys.exit(result.returncode)
 log=Path(temp,source.with_suffix('.log').name).read_text(errors='replace')
 if 'Overfull \\hbox' in log or 'Overfull \\vbox' in log:
  print('\n'.join(x for x in log.splitlines() if 'Overfull' in x));sys.exit('Layout overflow: inspect before publishing')
 shutil.copy2(Path(temp,source.with_suffix('.pdf').name),source.with_suffix('.pdf'))
 print(case_num, re.search(r'Output written on .*?\((\d+) pages',result.stdout,re.S).group(1)+' pages')
