# Light Workspace v2 本地资源

五个 SVG 从仓库第一版 Figma 的 `get_design_context` 资源导出中原样下载，未手工重画。页面使用 16×16 CSS mask 继承前景色。设计源、组件节点及文件 SHA-256 见 [manifest.json](manifest.json)；临时资源下载地址不作为长期依赖保存。

仓库 `.gitattributes` 对这些导出资源关闭文本行尾转换，保证 Windows checkout 后仍保持原始字节与校验值。

Geist 可变字体来自 [Vercel 官方仓库固定提交](https://github.com/vercel/geist-font/tree/10dc7658f13c38a474cde201bb09a4617267545b)，源路径为 `fonts/Geist/webfonts/Geist[wght].woff2`。同时保存官方 [OFL.txt](OFL.txt)，遵循 SIL Open Font License 1.1。全部资源本地加载，无 CDN 或字体服务请求。
