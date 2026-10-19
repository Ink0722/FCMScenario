# 阅读与任务插画

日期：2026-10-18；首次使用界面版本：0.6.0。

另有四幅同系列[扩展插画及预览](reserve/README.md)，包含阅读、对比资料、交流与收好记录主题；原稿、网页版和完整提示词保存在 reserve/ 中。其中“收好记录”自 0.6.1 起应用在 Profile 页，其余三幅继续备用。

页面目前使用三幅由内置 image_gen 图像生成工具制作的装饰插画。生成背景为透明；没有将参考截图中的旅行景观、文字或界面组件复制到素材中。

| 用途 | 原始文件 | 网页资源 |
| --- | --- | --- |
| 登录页标题、完成页复用 | reading-watercolor.png | ../../public/illustrations/reading-watercolor.webp |
| 任务选择页标题 | task-folder-watercolor.png | ../../public/illustrations/task-folder-watercolor.webp |
| Profile 采集页标题 | reserve/originals/filed-notes.png | ../../public/illustrations/filed-notes-watercolor.webp |

原始 PNG 均为 1536 × 1024，包含透明通道。网页使用保留透明度的 WebP（cwebp quality 88、alpha quality 100），保留原始 PNG，便于后续导出。三幅图均无文字、数字、金融走势、币种或推荐倾向；作为装饰，HTML 中使用空 alt 和 aria-hidden。资产通过本站点提供，不调用外部图像服务。Profile 插画直接复用原有 WebP，生成提示词见 [扩展插画提示词](reserve/prompts.md)。

## Prompt：入口主插画

Use case: illustration-story.
Asset type: decorative illustration for a desktop financial decision research website's sign-in page, transparent PNG, landscape composition 3:2.
Primary request: a beautifully hand-painted watercolor still life about reading and making one's own decisions. A small open book, two loose blank document sheets, one sage-green pencil, and two little warm ivory and pale apricot paper notes resting together on a quiet desk. Subjects arranged as a single low, horizontal group, with a gently curved page and a restrained natural sense of movement.
Style/medium: refined editorial watercolor on fine paper, translucent layers of pigment, softly irregular pencil contours, delicate visible brushwork and slight granulation, sophisticated and light, not a flat vector icon, not a cartoon or a UI mockup. White and warm ivory papers, sage and muted celadon green covers, touches of slate blue and pale apricot, graphite fine details.
Composition: all objects fully inside the frame; low centered still life filling roughly 85 percent width and 65 percent height; generous transparent margin; visually balanced, viewed from an elevated three-quarter angle. Soft watercolor shadows and a few very faint blue-green paint washes immediately under the objects fading into true transparency.
Constraints: actual transparent background including around watercolor edges; no text, no letters, no numbers, no labels, no logos, no people, no faces, no currency, no charts, no arrows, no recommendation symbols, no landscapes, no mountains, no plants. Quiet, welcoming, carefully drawn but not cute. Produce only the illustration asset.

## Prompt：任务小插画

Use case: illustration-story.
Asset type: a small decorative illustration for a desktop research website's task-selection header, transparent PNG, landscape 3:2 composition.
Primary request: a single compact still life of a sage-green paper folder holding three ivory paper sheets. The front sheet is a simple blank checklist with three small empty square outlines and short pale graphite horizontal strokes, no writing. One separate pale apricot index card rests at the base of the folder. All sheets appear as one collection, no rankings, no selected checks.
Style/medium: refined hand-painted editorial watercolor on fine paper, translucent pigment, softly irregular graphite outlines, delicate brushwork and slight granulation, sophisticated and light, not a flat vector icon, not cartoon, not 3D. Closely match this palette and material treatment: muted sage/celadon green folder, warm ivory paper, pale slate blue shadows, subtle pale apricot accent. A restrained natural handmade charm.
Composition: elevated three-quarter view, folder slightly open to show sheets, complete objects centered, fill around 75 percent of width and 70 percent of height, generous transparent margins, silhouette stays legible when displayed at 180px wide; a little very pale blue-green watercolor shadow directly under the objects fades into true transparency.
Constraints: actual transparent background including around watercolor edges; no text, no letters, no numbers, no labels, no logos, no people, no faces, no currency, no charts, no arrows, no checkmarks or reward symbols, no landscapes, no mountains, no plants. Produce only this illustration asset.

