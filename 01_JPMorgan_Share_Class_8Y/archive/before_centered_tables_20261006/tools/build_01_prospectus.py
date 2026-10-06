# coding: utf-8
from html.parser import HTMLParser
from html import escape
from pathlib import Path
import json,re
class N:
 def __init__(self,tag='',attrs=(),data=''):self.tag=tag;self.attrs=dict(attrs);self.children=[];self.data=data
 def text(self):return self.data if not self.tag else ''.join(c.text() for c in self.children)
class Parser(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=N('root');self.stack=[self.root]
 def handle_starttag(self,t,a):
  if t in ['p','table','h5','hr','tr','td']:
   for i in range(len(self.stack)-1,0,-1):
    if self.stack[i].tag=='p':self.stack=self.stack[:i];break
  n=N(t,a);self.stack[-1].children.append(n)
  if t not in ['meta','img','br','hr','input','link']:self.stack.append(n)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,d):self.stack[-1].children.append(N(data=d))
def descendants(n,t):return any(c.tag==t or descendants(c,t) for c in n.children)
def walk(n):
 text=re.sub(r'\s+',' ',n.text()).strip()
 if n.tag=='p' and text and not descendants(n,'table'):units.append((n,text));return
 if n.tag=='td' and text and not descendants(n,'p') and not descendants(n,'table'):units.append((n,text));return
 for c in n.children:walk(c)

r=Path(__file__).resolve().parent.parent
doc=json.loads((r/'01_JPMorgan_Share_Class_8Y_Prospectus.json').read_text())
p=Parser();p.feed((r/doc['source']).read_text());units=[];walk(p.root)
entries=doc['entries'];assert len(entries)==len(units)
for i,((n,text),entry) in enumerate(zip(units,entries)):
 assert entry['source']==text,(i,text)
 n.translation=entry['zh'];n.unit=entry['id']

def first(n,tag):
 if n.tag==tag:return n
 for c in n.children:
  found=first(c,tag)
  if found:return found
 return None

def attrs(a):return ''.join(' '+k+'="'+escape(v or '',quote=True)+'"' for k,v in a.items())

def serialize(n):
 if not n.tag:
  s=n.data
  s=s.replace('Table of Contents','目录').replace('(under','（低于')
  return escape(s)
 if n.tag in ['root','html','body']:return ''.join(serialize(c) for c in n.children)
 if n.tag in ['head','img','meta','script','link','h5','hr']:return ''
 a=n.attrs.copy()
 if n.tag=='p' and not n.text().strip():a['class']=(a.get('class','')+' source-spacer').strip()
 if 'href' in a and not a['href'].startswith('#'):a['href']='#'
 if hasattr(n,'translation'):
  font=first(n,'font');fa=font.attrs.copy() if font else {'size':'2'}
  original_bold=first(n,'b');z=escape(n.translation)
  if original_bold:
   bt=re.sub(r'\s+',' ',original_bold.text()).strip()
   if bt==re.sub(r'\s+',' ',n.text()).strip():z='<b>'+z+'</b>'
   elif n.translation.find('。')>=0 and len(bt)<60:
    pos=n.translation.find('。')+1;z='<b>'+escape(n.translation[:pos])+'</b>'+escape(n.translation[pos:])
  content='<font'+attrs(fa)+'>'+z+'</font>'
  a['data-source-unit']=n.unit
  if n.translation in ['A类','B类','S类']:a['style']=a.get('style','')+';white-space:nowrap'
 else:content=''.join(serialize(c) for c in n.children)
 if n.tag in ['br','hr','img','meta','input','link']:return '<'+n.tag+attrs(a)+'>'
 return '<'+n.tag+attrs(a)+'>'+content+'</'+n.tag+'>'
body=serialize(p.root)
parts=re.split(r"<p[^>]*page-break-before:always[^>]*>\s*</p>",body,flags=re.I)
parts=[x for x in parts if re.sub(r'<[^>]+>','',x).strip()]
assert len(parts)==31,len(parts)
css="""@page{size:A4;margin:12mm 13mm 14mm}body{margin:0;color:#111;font-size:9pt}font,p,td,div{font-family:'Songti SC','SimSun',serif!important}font[size='1']{font-size:7.5pt}font[size='2']{font-size:9pt}font[size='3']{font-size:12pt}font[size='4']{font-size:14pt}font[size='5']{font-size:18pt}font[size='6']{font-size:24pt}font[size='7']{font-size:28pt}p{line-height:1.2}table{border-collapse:collapse}td{overflow-wrap:break-word}a{color:inherit;text-decoration:none}.source-page{break-before:page;position:relative}.source-page:first-child{break-before:auto}.source-note{font-family:'PingFang SC',sans-serif!important;font-size:7pt;color:#555;margin-bottom:9pt}thead{display:table-header-group}"""
body=''.join('<section id="page-'+str(i)+'" class="source-page"><div class="source-note">历史披露逐段中文译本 · 匿名模拟资料 · '+('封面' if i==0 else '目录' if i==1 else '原印刷页 '+str(i-1) if i<30 else '封底')+'</div>'+chunk+'</section>' for i,chunk in enumerate(parts))
navigation=[(1,'目录'),(2,'风险／回报摘要'),(5,'关于基金的更多资料'),(8,'基金管理及行政'),(11,'购买基金份额'),(15,'销售费用'),(18,'交换基金份额'),(20,'赎回基金份额'),(23,'持有人信息'),(25,'基金的风险与回报元素'),(29,'财务亮点'),(30,'如何联系我们')]
nav='<nav class="reader-nav" aria-label="说明书导航"><div class="nav-label">文件目录</div>'+''.join('<a href="#page-'+str(i)+'">'+label+'</a>' for i,label in navigation)+'</nav>'
# Headings link to their source unit, so navigation does not depend on page estimates.
nav_ids=['U008','U051','U240','U285','U313','U475','U661','U700','U790','U837','U951','U955']
import re as _re
for (page,label),unit in zip(navigation,nav_ids):
 if label!='目录':
  nav=nav.replace('href="#page-'+str(page)+'"','href="#'+unit+'"')
  body=body.replace('data-source-unit="'+unit+'"','id="'+unit+'" data-source-unit="'+unit+'"')
chrome='<header class="reader-toolbar"><div class="reader-title">基金M · 招募说明书<span class="reader-subtitle">中文参考资料</span></div><div class="reader-controls"><button type="button" data-size="-1" aria-label="减小字号">A−</button><span id="font-size-status" style="font-size:12px;color:#727b76" aria-live="polite">17px</span><button type="button" data-size="1" aria-label="增大字号">A＋</button><a href="#page-1">目录</a><a href="01_JPMorgan_Share_Class_8Y_Prospectus.pdf">PDF</a></div></header>'
css+=(r/'tools/01_prospectus_reader.css').read_text()
script=(r/'tools/01_prospectus_reader.js').read_text()
body=chrome+nav+'<main>'+body+'</main><script>'+script+'</script>'
html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>基金M招募说明书</title><style>'+css+'</style></head><body>'+body+'</body></html>'
(r/'01_JPMorgan_Share_Class_8Y_Prospectus.html').write_text(html)
print('HTML: 31 source pages; '+str(len(entries))+' aligned source units')
