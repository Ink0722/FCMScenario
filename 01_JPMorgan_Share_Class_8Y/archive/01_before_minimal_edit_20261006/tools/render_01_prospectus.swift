import Foundation
import CoreGraphics
import CoreText
import PDFKit
import AppKit
let root=URL(fileURLWithPath:CommandLine.arguments[1])
let doc=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.json"))) as! [String:Any]
let chapters=doc["chapters"] as! [[String:Any]]
let W:CGFloat=595.28,H:CGFloat=841.89,left:CGFloat=46,width:CGFloat=503.28,top:CGFloat=57,bottom:CGFloat=773
func attributed(_ s:String,_ size:CGFloat,_ bold:Bool=false)->NSAttributedString{
 let font=CTFontCreateWithName((bold ? "PingFangSC-Semibold" : "Songti SC") as CFString,size,nil)
 let style=NSMutableParagraphStyle();style.lineSpacing=1.8;style.lineBreakMode = .byWordWrapping
 return NSAttributedString(string:s,attributes:[.font:font,.foregroundColor:CGColor(gray:0.08,alpha:1),.paragraphStyle:style])
}
func height(_ s:String,_ size:CGFloat,_ w:CGFloat,_ bold:Bool=false)->CGFloat{
 let a=attributed(s,size,bold)
 return ceil(CTFramesetterSuggestFrameSizeWithConstraints(CTFramesetterCreateWithAttributedString(a),CFRangeMake(0,a.length),nil,CGSize(width:w,height:10000),nil).height)+3
}
struct Draw {var text:String;var x:CGFloat;var y:CGFloat;var w:CGFloat;var size:CGFloat;var bold:Bool;var row:Bool=false;var shade:Bool=false;var rowH:CGFloat=0}
var body:[[Draw]]=[[]],labels:[String]=[chapters[0]["title"] as! String],starts:[Int]=[],tocEntries:[(String,Int,Bool)]=[],y=top
func newPage(_ title:String){body.append([]);labels.append(title);y=top}
func space(_ need:CGFloat,_ title:String){if y+need>bottom{newPage(title)}}
func put(_ s:String,_ size:CGFloat,_ bold:Bool,_ before:CGFloat,_ after:CGFloat,_ label:String,keep:CGFloat=0){
 let hh=height(s,size,width,bold);space(hh+before+keep,label);y+=before
 body[body.count-1].append(Draw(text:s,x:left,y:y,w:width,size:size,bold:bold));y+=hh+after
}
func rowHeight(_ row:[String],_ widths:[CGFloat],_ bold:Bool)->CGFloat{max(23,row.enumerated().map{height($0.element,9.2,widths[$0.offset]-12,bold)+8}.max()!)}
func putRow(_ row:[String],_ widths:[CGFloat],_ bold:Bool){
 let hh=rowHeight(row,widths,bold);var x=left
 for (i,s) in row.enumerated(){body[body.count-1].append(Draw(text:s,x:x+6,y:y+4,w:widths[i]-12,size:9.2,bold:bold,row:true,shade:bold,rowH:hh));x+=widths[i]}
 y+=hh
}
func lead(_ b:[String:Any])->CGFloat {
 if b["type"] as! String == "table" {return 60}
 return height(b["text"] as! String,b["type"] as! String == "heading" ? 11.2 : 10.3,width,b["type"] as! String == "heading")+10
}
for ch in chapters{
 let label=ch["title"] as! String
 let blocks=ch["blocks"] as! [[String:Any]]
 let firstSpace=blocks.prefix(2).map{lead($0)}.reduce(0,+)
 space(height(label,16,width,true)+20+firstSpace,label)
 put(label,16,true,12,8,label,keep:firstSpace);starts.append(body.count+2);tocEntries.append((label,body.count+2,true))
 for (bi,b) in blocks.enumerated(){
  switch b["type"] as! String{
  case "heading":
   let t=b["text"] as! String;let nextSpace = bi+1 < blocks.count ? lead(blocks[bi+1]) : 0;put(t,11.2,true,7,3,label,keep:nextSpace)
   let selected:Set<String>=["投资策略的补充说明","投资风险","临时防御性头寸","购买基金份额","销售费用","12b-1分销费","网络登记与分转代理费用","交换基金份额","赎回基金份额","分配与税务","持有人对账单及报告","代理投票记录","组合持仓披露"]
   if selected.contains(t){tocEntries.append((t,body.count+2,false))}
  case "paragraph":put(b["text"] as! String,10.3,false,0,4,label)
  case "footnote":put(b["text"] as! String,8.5,false,0,4,label)
  case "table":
   let head=b["headers"] as! [String],rows=b["rows"] as! [[String]],ws=(b["widths"] as! [Double]).map{CGFloat($0)*width}
   space(rowHeight(head,ws,true)+rowHeight(rows[0],ws,false),label);putRow(head,ws,true)
   for row in rows{let rh=rowHeight(row,ws,false);if y+rh>bottom{newPage(label);putRow(head,ws,true)};putRow(row,ws,false)}
   y+=6
  default:fatalError("Unknown block")
  }
 }
}
let count=body.count+2
let dest=root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.pdf")
let temp=root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.rendering.pdf")
var media=CGRect(x:0,y:0,width:W,height:H)
let ctx=CGContext(temp as CFURL,mediaBox:&media,[kCGPDFContextTitle:doc["title"] as! String,kCGPDFContextAuthor:"匿名改编资料"] as CFDictionary)!
func drawText(_ s:String,_ x:CGFloat,_ yy:CGFloat,_ w:CGFloat,_ size:CGFloat,_ bold:Bool=false){
 let a=attributed(s,size,bold),hh=height(s,size,w,bold)
 let frame=CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(a),CFRangeMake(0,a.length),CGPath(rect:CGRect(x:x,y:H-yy-hh,width:w,height:hh),transform:nil),nil)
 guard CTFrameGetVisibleStringRange(frame).length==a.length else{fatalError("Clipped text")}
 ctx.saveGState();ctx.textMatrix = .identity;CTFrameDraw(frame,ctx);ctx.restoreGState()
}
func begin(_ n:Int,_ label:String){
 ctx.beginPDFPage(nil)
 drawText("基金M　｜　招募说明书",left,25,width,8.5,true)
 drawText(label,left,39,width,8)
 ctx.setStrokeColor(CGColor(gray:0.65,alpha:1));ctx.setLineWidth(0.4);ctx.move(to:CGPoint(x:left,y:H-50));ctx.addLine(to:CGPoint(x:W-left,y:H-50));ctx.strokePath()
 drawText("匿名改编 · 模拟研究资料",left,H-33,width-60,8)
 drawText("\(n)",W-left-35,H-33,35,8)
}
let cover=doc["cover"] as! [String:String]
begin(1,"")
drawText(cover["title"]!,left,160,width,34,true)
drawText(cover["subtitle"]!,left,219,width,24,true)
drawText(cover["classes"]!,left,300,width,12)
drawText(cover["description"]!,left,430,width,11)
drawText(cover["notice"]!,left,700,width,9)
ctx.endPDFPage()
begin(2,"目录");drawText("目录",left,75,width,20,true)
var ty:CGFloat=130
for entry in tocEntries{drawText(entry.0,left+(entry.2 ? 0 : 14),ty,width-54,10.5,entry.2);drawText("\(entry.1)",W-left-30,ty,30,10.5);ty+=24}
drawText("各章节中列示的账户资格、费用减免、销售费、交易及支付条件，应按其具体适用范围执行。",left,ty+35,width,10.3)
ctx.endPDFPage()
var manifest:[[String:Any]]=[]
for (i,items) in body.enumerated(){
 begin(i+3,labels[i]);var end:CGFloat=top
 for item in items{
  if item.row{
   let cellRect=CGRect(x:item.x-6,y:H-(item.y-4)-item.rowH,width:item.w+12,height:item.rowH)
   if item.shade{ctx.setFillColor(CGColor(gray:0.93,alpha:1));ctx.fill(cellRect)}
   ctx.setStrokeColor(CGColor(gray:0.65,alpha:1));ctx.setLineWidth(0.35);ctx.stroke(cellRect)
  }
  drawText(item.text,item.x,item.y,item.w,item.size,item.bold)
  end=max(end,item.row ? item.y-4+item.rowH : item.y+height(item.text,item.size,item.w,item.bold))
 }
 guard end<=bottom else{fatalError("Page overflow")}
 manifest.append(["page":i+3,"contentBottom":Double(end),"availableBottom":Double(bottom)])
 ctx.endPDFPage()
}
ctx.closePDF()
let pdf=PDFDocument(url:temp)!
guard pdf.pageCount==count else{fatalError("Page count")}
let qa=URL(fileURLWithPath:"/tmp/scminna_01_pdf_qa_source_style");try FileManager.default.createDirectory(at:qa,withIntermediateDirectories:true)
var extracted=""
for i in 0..<pdf.pageCount{
 let page=pdf.page(at:i)!;extracted += "\n--- PAGE \(i+1) ---\n"+(page.string ?? "")
 let bounds=page.bounds(for:.mediaBox),scale:CGFloat=1.5
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(W*scale),pixelsHigh:Int(H*scale),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 let gc=NSGraphicsContext(bitmapImageRep:rep)!;NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=gc
 gc.cgContext.setFillColor(CGColor(gray:1,alpha:1));gc.cgContext.fill(CGRect(x:0,y:0,width:bounds.width*scale,height:bounds.height*scale));gc.cgContext.scaleBy(x:scale,y:scale);page.draw(with:.mediaBox,to:gc.cgContext)
 NSGraphicsContext.restoreGraphicsState();try rep.representation(using:.png,properties:[:])!.write(to:qa.appendingPathComponent("page_\(i+1).png"))
}
try extracted.write(to:qa.appendingPathComponent("extracted.txt"),atomically:true,encoding:.utf8)
try JSONSerialization.data(withJSONObject:["pages":count,"chapters":zip(chapters,starts).map{["title":$0.0["title"]!,"page":$0.1]},"layout":manifest],options:.prettyPrinted).write(to:qa.appendingPathComponent("layout.json"))
try Data(contentsOf:temp).write(to:dest,options:.atomic);try FileManager.default.removeItem(at:temp)
print("Pages: \(count)\nPDF: \(dest.path)\nQA: \(qa.path)")
