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
doc=json.loads((r/'prospectus.json').read_text())
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
