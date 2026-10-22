import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "unpdf/pdfjs";

let engine: ReturnType<(typeof import("unpdf/pdfjs"))["resolvePDFJS"]> | undefined;
const loadEngine = () => engine ??= import("unpdf/pdfjs").then((module) => module.resolvePDFJS());

/** Render the actual file, without browser PDF plugins, remote assets or eval. */
export function PdfPreview({ url, title, page = 1, onPage }: { url: string; title: string; page?: number; onPage?: (page: number) => void }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [localPage, setLocalPage] = useState(page);
  const [zoom, setZoom] = useState(100);
  const [width, setWidth] = useState(400);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [retry, setRetry] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const currentPage = Math.min(Math.max(1, onPage ? page : localPage), document?.numPages ?? 1);
  const changePage = (value: number) => onPage ? onPage(value) : setLocalPage(value);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | undefined;
    const controller = new AbortController();
    setDocument(null); setRendered(false); setError(null); setLocalPage(1);
    void (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 409 ? "PDF 已过期，请重新构建后预览。" : `PDF 无法加载（${response.status}），请重试或查看原文件。`);
      if (Number(response.headers.get("content-length")) > 25 * 1024 * 1024) throw new Error("PDF 超出 25 MiB 预览上限，请打开原文件。");
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > 25 * 1024 * 1024 || new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") throw new Error("文件不是有效的可预览 PDF。");
      const pdfjs = await loadEngine();
      if (cancelled) return;
      const loading = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
      task = loading;
      const pdf: PDFDocumentProxy = await loading.promise;
      if (!cancelled) setDocument(pdf);
    })().catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; controller.abort(); void task?.destroy().catch(() => undefined); };
  }, [url, retry]);

  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(120, entry.contentRect.width)); });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let rendering: RenderTask | undefined;
    setRendered(false); setError(null);
    void (async () => {
      const pdfPage = await document.getPage(currentPage);
      if (cancelled || !canvas.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min((width - 32) / natural.width * zoom / 100, 2);
      const view = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(view.width * ratio);
      target.height = Math.floor(view.height * ratio);
      target.style.width = `${Math.floor(view.width)}px`;
      target.style.height = `${Math.floor(view.height)}px`;
      const context = target.getContext("2d");
      if (!context) throw new Error("浏览器无法绘制 PDF，请打开原文件。");
      rendering = pdfPage.render({ canvasContext: context, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
      if (!cancelled) setRendered(true);
    })().catch((reason) => { if (!cancelled) setError(`PDF 页面绘制失败：${(reason as Error).message}`); });
    return () => { cancelled = true; rendering?.cancel(); };
  }, [document, currentPage, width, zoom]);

  return <section className="pdf-preview" title={title} aria-label={title}>
    <div className="pdf-toolbar"><button aria-label={`${title} 上一页`} disabled={!document || currentPage <= 1} onClick={() => changePage(currentPage - 1)}>‹</button><label><input aria-label={`${title} 页码`} type="number" min={1} max={document?.numPages ?? 1} value={currentPage} onChange={(event) => changePage(Math.min(document?.numPages ?? 1, Math.max(1, Number(event.target.value))))} /><span>/ {document?.numPages ?? "—"}</span></label><button aria-label={`${title} 下一页`} disabled={!document || currentPage >= document.numPages} onClick={() => changePage(currentPage + 1)}>›</button><select aria-label={`${title} 缩放`} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={75}>75%</option><option value={100}>适合宽度</option><option value={125}>125%</option><option value={150}>150%</option></select><a href={url} target="_blank" rel="noreferrer" aria-label={`${title} 打开原文件`}>↗</a></div>
    {error && <div role="alert" className="pdf-error"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>重试预览</button><a href={url} target="_blank" rel="noreferrer">打开原文件</a></div>}
    {!rendered && !error && <p className="pdf-loading" role="status">正在加载 PDF 页面…</p>}
    <div className="pdf-viewport" ref={viewport} aria-busy={!rendered && !error}><canvas ref={canvas} role="img" aria-label={`${title} 第 ${currentPage} 页`} data-rendered={rendered} hidden={!rendered || !!error} /></div>
  </section>;
}
