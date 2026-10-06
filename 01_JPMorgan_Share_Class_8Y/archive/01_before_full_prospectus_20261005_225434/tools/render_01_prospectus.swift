import Foundation
import CoreGraphics
import CoreText
import PDFKit
import AppKit

let root = URL(fileURLWithPath:CommandLine.arguments[1])
let data = try Data(contentsOf: root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.json"))
let doc = try JSONSerialization.jsonObject(with:data) as! [String:Any]
let pages = doc["pages"] as! [[String:Any]]
let output = root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.pdf")
let W:CGFloat=595.28, H:CGFloat=841.89, margin:CGFloat=45, usable:CGFloat=505.28
var media=CGRect(x:0,y:0,width:W,height:H)
let context=CGContext(output as CFURL,mediaBox:&media,[kCGPDFContextTitle:doc["title"] as! String,kCGPDFContextAuthor:"实验模拟产品资料"] as CFDictionary)!
let navy=CGColor(red:0.13,green:0.19,blue:0.25,alpha:1)
let ink=CGColor(gray:0.16,alpha:1)
func attributed(_ text:String,_ size:CGFloat,_ bold:Bool=false,_ color:CGColor?=nil)->NSAttributedString {
 let font=CTFontCreateWithName((bold ? "PingFangSC-Semibold" : "PingFangSC-Regular") as CFString,size,nil)
 let style=NSMutableParagraphStyle();style.lineSpacing=3;style.paragraphSpacing=0;style.lineBreakMode = .byWordWrapping
 return NSAttributedString(string:text,attributes:[.font:font,.foregroundColor:color ?? ink,.paragraphStyle:style])
}
func measured(_ a:NSAttributedString,_ width:CGFloat)->CGFloat {
 let fs=CTFramesetterCreateWithAttributedString(a);let s=CTFramesetterSuggestFrameSizeWithConstraints(fs,CFRangeMake(0,a.length),nil,CGSize(width:width,height:10000),nil)
 return ceil(s.height)+3
}
@discardableResult func text(_ s:String,_ x:CGFloat,_ top:CGFloat,_ width:CGFloat,_ size:CGFloat,_ bold:Bool=false,_ color:CGColor?=nil)->CGFloat {
 let a=attributed(s,size,bold,color), height=measured(a,width)
 let path=CGPath(rect:CGRect(x:x,y:H-top-height,width:width,height:height),transform:nil)
 let frame=CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(a),CFRangeMake(0,a.length),path,nil)
 let visible=CTFrameGetVisibleStringRange(frame)
 if visible.length != a.length {fatalError("Text clipping: \(s.prefix(50))")}
 context.saveGState();context.textMatrix = .identity;CTFrameDraw(frame,context);context.restoreGState()
 return height
}
var manifest:[[String:Any]]=[]
for (index,page) in pages.enumerated(){
 context.beginPDFPage(nil)
 _=text("M FUND  /  份额资料",margin,24,usable,9,true,navy)
 context.setStrokeColor(CGColor(gray:0.76,alpha:1));context.setLineWidth(0.5);context.move(to:CGPoint(x:margin,y:H-44));context.addLine(to:CGPoint(x:W-margin,y:H-44));context.strokePath()
 var y:CGFloat=62
 y += text(page["title"] as! String,margin,y,usable,22,true,navy)+6
 y += text(page["subtitle"] as! String,margin,y,usable,11,false,CGColor(gray:0.4,alpha:1))+18
 for block in page["blocks"] as! [[String:Any]] {
  switch block["type"] as! String {
  case "heading":
   y += 4;y += text(block["text"] as! String,margin,y,usable,12.5,true,navy)+4
  case "paragraph":
   y += text(block["text"] as! String,margin,y,usable,11.3)+6
  case "table":
   let heads=block["headers"] as! [String],rows=[heads]+(block["rows"] as! [[String]])
   let widths=(block["widths"] as! [Double]).map{CGFloat($0)*usable}
   for (ri,row) in rows.enumerated(){
    let rowH=max(24,row.enumerated().map{measured(attributed($0.element,10.3,ri==0),widths[$0.offset]-16)+10}.max()!)
    if ri==0{context.setFillColor(CGColor(red:0.91,green:0.93,blue:0.95,alpha:1));context.fill(CGRect(x:margin,y:H-y-rowH,width:usable,height:rowH))}
    var x=margin
    for (ci,cell) in row.enumerated(){
     _=text(cell,x+8,y+5,widths[ci]-16,10.3,ri==0)
     context.setStrokeColor(CGColor(gray:0.78,alpha:1));context.setLineWidth(0.4);context.stroke(CGRect(x:x,y:H-y-rowH,width:widths[ci],height:rowH));x+=widths[ci]
    }
    y += rowH
   }
   y += 8
  default:fatalError("Unknown block")
  }
 }
 if y>H-68{fatalError("Page \(index+1) overflow: \(y)")}
 _=text("基金M · 实验模拟产品资料",margin,H-38,usable-80,8.5,false,CGColor(gray:0.45,alpha:1))
 _=text("\(index+1) / \(pages.count)",W-margin-48,H-38,48,8.5,false,CGColor(gray:0.45,alpha:1))
 context.endPDFPage();manifest.append(["page":index+1,"contentBottom":Double(y),"availableBottom":Double(H-68)])
}
context.closePDF()
let pdf=PDFDocument(url:output)!
let qa=URL(fileURLWithPath:"/tmp/scminna_01_pdf_qa",isDirectory:true);try FileManager.default.createDirectory(at:qa,withIntermediateDirectories:true)
var extracted=""
for i in 0..<pdf.pageCount{
 let page=pdf.page(at:i)!;extracted += "\n--- PAGE \(i+1) ---\n"+(page.string ?? "")
 let bounds=page.bounds(for:.mediaBox);let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(bounds.width*1.5),pixelsHigh:Int(bounds.height*1.5),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 let gc=NSGraphicsContext(bitmapImageRep:bitmap)!;NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=gc
 gc.cgContext.setFillColor(CGColor(gray:1,alpha:1));gc.cgContext.fill(CGRect(x:0,y:0,width:bounds.width*1.5,height:bounds.height*1.5));gc.cgContext.scaleBy(x:1.5,y:1.5);page.draw(with:.mediaBox,to:gc.cgContext)
 NSGraphicsContext.restoreGraphicsState();try bitmap.representation(using:.png,properties:[:])!.write(to:qa.appendingPathComponent("page_\(i+1).png"))
}
try extracted.write(to:qa.appendingPathComponent("extracted.txt"),atomically:true,encoding:.utf8)
let md=try JSONSerialization.data(withJSONObject:manifest,options:[.prettyPrinted]);try md.write(to:qa.appendingPathComponent("layout.json"))
print("PDF: \(output.path)\nPages: \(pdf.pageCount)\nQA: \(qa.path)")
