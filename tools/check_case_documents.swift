import Foundation
import AppKit
import PDFKit
let root=URL(fileURLWithPath:"/Users/ink/Desktop/Scminna")
let qa=URL(fileURLWithPath:"/tmp/scminna_split_pdf_qa")
try FileManager.default.createDirectory(at:qa,withIntermediateDirectories:true)
var records=[[String:Any]]()
let layouts:[[Double]]=[[1],[0.68,0.32],[0.24,0.38,0.38],[0.38,0.31,0.31],[0.26,0.14,0.27,0.33],[0.52,0.16,0.16,0.16],[0.14,0.13,0.15,0.29,0.29],[0.30,0.14,0.14,0.14,0.14,0.14],[0.24,0.13,0.13,0.13,0.10,0.10,0.17]]
for caseDir in try FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:nil).sorted(by:{$0.path<$1.path}) {
 let manifest=caseDir.appendingPathComponent("tools/pdf_documents.json")
 guard FileManager.default.fileExists(atPath:manifest.path) else{continue}
 let config=try JSONSerialization.jsonObject(with:Data(contentsOf:manifest)) as! [String:Any]
 for doc in config["documents"] as! [[String:Any]] {
  let id=doc["document_id"] as! String,file=caseDir.appendingPathComponent(doc["pdf"] as! String)
  guard let pdf=PDFDocument(url:file) else{fatalError("Missing PDF \(id)")}
  var text="",coltext="";var sizes=[[Double]]();var shortLines=[[String:Any]]()
  for i in 0..<pdf.pageCount {
   let p=pdf.page(at:i)!,box=p.bounds(for:.mediaBox)
   let area=CGRect(x:0,y:65,width:box.width,height:box.height-130)
   let lines=(p.selection(for:area)?.selectionsByLine() ?? []).sorted{a,b in
    let x=a.bounds(for:p),y=b.bounds(for:p);return abs(x.midY-y.midY)>2 ? x.midY>y.midY : x.minX<y.minX
   }
   text += lines.compactMap{$0.string}.joined(separator:"\n")+"\n"
   for line in lines {
    let value=(line.string ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
    if value.range(of:"^[\\p{Han}]{1,2}[。，；：！？、）]?\\s*$",options:.regularExpression) != nil {
     let b=line.bounds(for:p)
     shortLines.append(["page":i+1,"text":value,"x":b.minX,"y":b.minY])
    }
   }
   sizes.append([box.width,box.height])
  }
  let documentTables=doc["tables"] as? [[String:Any]] ?? []
  let documentLayouts=documentTables.compactMap{$0["weights"] as? [Double]}
  for weights in [[1.0]] + documentLayouts + (documentLayouts.isEmpty ? layouts : []) {
   for col in 0..<weights.count {
    coltext += "\nCOLUMN\n"
    for i in 0..<pdf.pageCount {
     let p=pdf.page(at:i)!,box=p.bounds(for:.mediaBox),margin=21.0*72/25.4,width=box.width-2*margin
     let preceding=weights.prefix(col).reduce(0,+)*(width-8*Double(weights.count))+8*Double(col)
     let colwidth=weights[col]*(width-8*Double(weights.count))+8
     let area=CGRect(x:margin+preceding,y:65,width:colwidth,height:box.height-130)
     let lines=(p.selection(for:area)?.selectionsByLine() ?? []).sorted{a,b in
      let x=a.bounds(for:p),y=b.bounds(for:p);return abs(x.midY-y.midY)>2 ? x.midY>y.midY : x.minX<y.minX
     }
     coltext += lines.compactMap{$0.string}.joined(separator:"\n")+"\n"
    }
   }
  }
  try text.write(to:qa.appendingPathComponent(id+"_text.txt"),atomically:true,encoding:.utf8)
  try coltext.write(to:qa.appendingPathComponent(id+"_columns.txt"),atomically:true,encoding:.utf8)
  // Render every page into a contact sheet; save the first page at readable resolution.
  let rows=(pdf.pageCount+1)/2
  let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:920,pixelsHigh:rows*660,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  let gc=NSGraphicsContext(bitmapImageRep:rep)!;NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=gc
  NSColor(calibratedWhite:0.91,alpha:1).setFill();NSRect(x:0,y:0,width:920,height:rows*660).fill()
  for i in 0..<pdf.pageCount {
   let p=pdf.page(at:i)!,image=p.thumbnail(of:NSSize(width:890,height:1260),for:.mediaBox)
   let y=CGFloat(rows-1-i/2)*660+15;image.draw(in:NSRect(x:CGFloat(i%2)*460+7,y:y,width:445,height:630))
   if i==0,let tiff=image.tiffRepresentation,let ir=NSBitmapImageRep(data:tiff){try ir.representation(using:.png,properties:[:])!.write(to:qa.appendingPathComponent(id+"_first.png"))}
  }
  NSGraphicsContext.restoreGraphicsState();try rep.representation(using:.png,properties:[:])!.write(to:qa.appendingPathComponent(id+"_contact.png"))
  let whole=(0..<pdf.pageCount).map{pdf.page(at:$0)?.string ?? ""}.joined(separator:"\n")
  records.append(["document_id":id,"case":config["case_number"]!,"pdf":file.path,"pages":pdf.pageCount,"text_characters":text.count,"whole_text":whole,"short_cjk_lines":shortLines])
  print("\(id): \(pdf.pageCount) pages")
 }
}
try JSONSerialization.data(withJSONObject:records,options:.prettyPrinted).write(to:qa.appendingPathComponent("report.json"))
