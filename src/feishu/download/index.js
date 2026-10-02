/*
 * MAIN world 入口：把上游「飞书文档 → Markdown」下载能力接上进度上报。
 *
 * ⚠️ 顺序依赖（不要调整这两行的先后，也不要合并成动态 import）：
 * ES 模块按 import 声明顺序求值依赖，所以 ./toast-bridge 必须先求值（它会调用 setToast
 * 安装自己的进度桥接），随后才求值下载脚本。
 *
 * 下载脚本在模块顶层就自执行 main()，并且在第一个 await 之前会同步调用 Toast
 * （例如「滚动中，以便加载文档」「这不是一个飞书文档页面，无法下载为 Markdown」）。
 * 若顺序反了，这些提示会漏到飞书原生的 window.Toast 上。
 *
 * 下载逻辑本体见 src/vendor/converter/scripts/download-lark-docx-as-markdown.ts，
 * 逐字搬自上游仓库，未做任何修改。
 */
import './toast-bridge.js';
import '../../vendor/converter/scripts/download-lark-docx-as-markdown.ts';
