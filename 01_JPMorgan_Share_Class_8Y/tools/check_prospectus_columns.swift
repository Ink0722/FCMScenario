import Foundation
import PDFKit
let root=URL(fileURLWithPath:"/Users/ink/Desktop/Scminna/01_JPMorgan_Share_Class_8Y")
let pdf=PDFDocument(url:root.appendingPathComponent("01_JPMorgan_Share_Class_8Y_Prospectus.pdf"))!
let layouts:[[Double]]=[[1],[0.65,0.35],[0.38,0.31,0.31],[0.52,0.16,0.16,0.16],[0.40,0.15,0.15,0.15,0.15]]
var out=""
for weights in layouts {
 for col in 0..<weights.count {
  out += "\nCOLUMN\n"
  for i in 0..<pdf.pageCount {
   let page=pdf.page(at:i)!,box=page.bounds(for:.mediaBox)
   let margin=21.0*72/25.4,width=box.width-2*margin
   let preceding=weights.prefix(col).reduce(0,+)*(width-8*Double(weights.count))+8*Double(col)
   let colwidth=weights[col]*(width-8*Double(weights.count))+8
   let area=CGRect(x:margin+preceding,y:65,width:colwidth,height:box.height-130)
   let lines=(page.selection(for:area)?.selectionsByLine() ?? []).sorted { a,b in
    let x=a.bounds(for:page),y=b.bounds(for:page)
    return abs(x.midY-y.midY)>2 ? x.midY>y.midY : x.minX<y.minX
   }
   out += lines.compactMap{$0.string}.joined(separator:"\n")+"\n"
  }
 }
}
try out.write(to:URL(fileURLWithPath:"/tmp/scminna_01_native_pdf_qa/column_text.txt"),atomically:true,encoding:.utf8)
