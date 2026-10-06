"""Shared native PDF typography; formatting only, no financial text rewriting."""
import re,subprocess,tempfile,shutil
from pathlib import Path

def escape(s):
 mapping={'\\':r'\textbackslash{}','&':r'\&','%':r'\%','$':r'\$','#':r'\#','_':r'\_','{':r'\{','}':r'\}','~':r'\textasciitilde{}','^':r'\textasciicircum{}'}
 return ''.join(mapping.get(c,c) for c in s)

def escaped_text(s):
 parts=re.split(r'((?:https?://)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:/[A-Za-z0-9/_.?%=-]*)?)',s)
 return ''.join(r'\url{'+x+'}' if i%2 else escape(x) for i,x in enumerate(parts))

def inline(s):
 return ''.join(r'\textbf{'+escaped_text(x)+r'}' if i%2 else escaped_text(x) for i,x in enumerate(s.split('**')))

def paragraph(s):
 if '**' in s:return inline(s)
 # Apply the same emphasis to all short clause labels, including both options.
 m=re.match(r'^(\([A-Za-z0-9]+\)|（[A-Za-z0-9一二三四五六七八九十]+）)\s*([^。！？；]{1,35}[。：])',s)
 if not m:m=re.match(r'^(\d+\.|[a-z]\.)\s*([^？?]{1,60}[？?])',s)
 if not m:m=re.match(r'^([^。！？；]{2,18}：)',s)
 if m:return r'\textbf{'+escaped_text(m.group(0))+r'}'+escaped_text(s[m.end():])
 return inline(s)

def heading(s,level):
 cmd={1:'section',2:'subsection',3:'subsubsection'}[min(3,max(1,level))]
 return '\\'+cmd+'*{'+escape(s)+'}'

def table(lines):
 rows=[[c.strip() for c in x.strip().strip('|').split('|')] for x in lines if not re.fullmatch(r'[\s|:\-]+',x)]
 count=len(rows[0]);assert all(len(row)==count for row in rows)
 weights={2:[.68,.32],3:[.24,.38,.38],4:[.26,.14,.27,.33],5:[.14,.13,.15,.29,.29],6:[.30,.14,.14,.14,.14,.14],7:[.24,.13,.13,.13,.10,.10,.17]}.get(count,[1/count]*count)
 specs=''.join(r'>{\raggedright\arraybackslash}p{'+str(round(w,5))+r'\dimexpr\linewidth-'+str(2*count)+r'\tabcolsep\relax}' for w in weights)
 row=lambda cells:' & '.join(inline(c) for c in cells)+r' \\'
 h=r'\rowcolor{TableHead} '+row(rows[0])
 return '\n'.join([r'\Needspace{5\baselineskip}',r'\begingroup\small\setlength{\tabcolsep}{4pt}\renewcommand{\arraystretch}{1.35}',r'\begin{longtable}{'+specs+'}',r'\toprule',h,r'\midrule\endfirsthead',r'\toprule',h,r'\midrule\endhead',r'\midrule\endfoot',r'\bottomrule\endlastfoot']+[row(c)+(r' \addlinespace[3pt]' if i<len(rows)-2 else '') for i,c in enumerate(rows[1:])]+[r'\end{longtable}\endgroup'])

def preamble(case_name,title,doc_id):
 s=r'''\documentclass[UTF8,fontset=none,11pt,a4paper]{ctexart}
\usepackage[left=21mm,right=21mm,top=27mm,bottom=22mm,headheight=26pt,headsep=6mm]{geometry}
\usepackage{fontspec}
\setmainfont{texgyretermes-regular.otf}[BoldFont=texgyretermes-bold.otf,ItalicFont=texgyretermes-italic.otf]
\setCJKmainfont{Songti.ttc}[Path=/System/Library/Fonts/Supplemental/,FontIndex=6,AutoFakeBold=2]
\setCJKsansfont{Songti.ttc}[Path=/System/Library/Fonts/Supplemental/,FontIndex=6,AutoFakeBold=2]
\usepackage[table]{xcolor}
\definecolor{TableHead}{HTML}{EEF0ED}
\definecolor{Muted}{HTML}{666C68}
\usepackage{booktabs,longtable,array,fancyhdr,needspace,xurl}
\usepackage[unicode,hidelinks]{hyperref}
\urlstyle{same}
\linespread{1.32}
\setlength{\parindent}{2em}
\setlength{\parskip}{3pt}
\setlength{\LTpre}{8pt}\setlength{\LTpost}{10pt}
\ctexset{section={format=\fontsize{15}{20}\selectfont\bfseries,beforeskip=18pt,afterskip=8pt},subsection={format=\fontsize{12}{16}\selectfont\bfseries,beforeskip=12pt,afterskip=6pt},subsubsection={format=\normalsize\bfseries,beforeskip=9pt,afterskip=4pt}}
\pagestyle{fancy}\fancyhf{}
\renewcommand{\headrulewidth}{.3pt}
\renewcommand{\footrulewidth}{0pt}
'''
 s+=r'\fancyhead[L]{\parbox[b]{\linewidth}{\fontsize{8}{10}\selectfont\color{Muted}'+escape(case_name+'·'+title)+r'}}'+'\n'
 s+=r'\fancyfoot[C]{\small\color{Muted}\thepage}'+'\n'
 s+=r'\hypersetup{pdftitle={'+escape(title)+r'},pdfsubject={'+escape('仅供模拟使用·'+case_name+'·'+doc_id)+r'},pdfauthor={金融决策模拟材料}}'+'\n'
 return s

def document_start(case_name,title,doc_id):
 return preamble(case_name,title,doc_id)+r'\begin{document}'+'\n'+r'{\noindent\fontsize{20}{25}\selectfont\bfseries '+escape(title)+r'\par}'+'\n'+r'\vspace{7pt}{\noindent\small\color{Muted}'+escape('仅供模拟使用·'+case_name+'·'+doc_id)+r'\par}\vspace{10pt}'+'\n'

def compile_pdf(texfile,pdf):
 with tempfile.TemporaryDirectory(prefix='scminna_doc_',dir='/tmp') as temp:
  command=['/Library/TeX/texbin/xelatex','-interaction=nonstopmode','-halt-on-error','-output-directory='+temp,str(texfile)]
  for _ in range(2):
   result=subprocess.run(command,capture_output=True,text=True,cwd=texfile.parent)
   if result.returncode:raise RuntimeError(result.stdout[-5000:])
  log=Path(temp,texfile.with_suffix('.log').name).read_text(errors='replace')
  overflow=[x for x in log.splitlines() if 'Overfull' in x]
  if overflow:raise RuntimeError('Layout overflow: '+'\n'.join(overflow))
  shutil.copy2(Path(temp,texfile.with_suffix('.pdf').name),pdf)
  return int(re.search(r'Output written on .*?\((\d+) pages?',result.stdout,re.S).group(1))
