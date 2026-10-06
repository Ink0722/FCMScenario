import Foundation
import CoreGraphics
import PDFKit
import AppKit
let root = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath:CommandLine.arguments[1])
    : URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent()
let pending=root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.rendering.pdf")
let input=FileManager.default.fileExists(atPath:pending.path) ? pending : root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.pdf")
let pdf=PDFDocument(url:input)!
let qa=URL(fileURLWithPath:"/tmp/scminna_01_pdf_qa_minimal");try FileManager.default.createDirectory(at:qa,withIntermediateDirectories:true)
var extracted=""
for i in 0..<pdf.pageCount{
 let page=pdf.page(at:i)!;extracted += "\n--- PAGE \(i+1) ---\n"+(page.string ?? "")
 let bounds=page.bounds(for:.mediaBox),scale:CGFloat=1.5
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(bounds.width*scale),pixelsHigh:Int(bounds.height*scale),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 let gc=NSGraphicsContext(bitmapImageRep:rep)!;NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=gc
 gc.cgContext.setFillColor(CGColor(gray:1,alpha:1));gc.cgContext.fill(CGRect(x:0,y:0,width:bounds.width*scale,height:bounds.height*scale));gc.cgContext.scaleBy(x:scale,y:scale);page.draw(with:.mediaBox,to:gc.cgContext)
 NSGraphicsContext.restoreGraphicsState();try rep.representation(using:.png,properties:[:])!.write(to:qa.appendingPathComponent("page_\(i+1).png"))
}
try extracted.write(to:qa.appendingPathComponent("extracted.txt"),atomically:true,encoding:.utf8)
let metadata:[String:Any] = ["pages":pdf.pageCount,"characters":extracted.count]
try JSONSerialization.data(withJSONObject:metadata,options:.prettyPrinted).write(to:qa.appendingPathComponent("layout.json"))
print("Pages: \(pdf.pageCount)\nQA: \(qa.path)")
