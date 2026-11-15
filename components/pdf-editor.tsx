"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ArrowLeft, ArrowRight, Highlighter, MousePointer2, Pencil, RectangleHorizontal, Type, Crop, Undo2, Redo2 } from "lucide-react";

type Point = { x: number; y: number };
type Viewport = {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => [number, number];
  convertToViewportPoint: (x: number, y: number) => [number, number];
};
type PdfPage = {
  getViewport: (options: { scale: number }) => Viewport;
  render: (options: never) => { promise: Promise<void> };
  cleanup: () => void;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type ToolMode = "text" | "draw" | "highlight" | "rectangle" | "crop";
type TextMark = { id: string; pageIndex: number; kind: "text"; point: Point; text: string; color: string; fontSize: number };
type DrawMark = { id: string; pageIndex: number; kind: "draw"; points: Point[]; color: string; lineWidth: number };
type BoxMark = { id: string; pageIndex: number; kind: "highlight" | "rectangle" | "crop"; x: number; y: number; width: number; height: number; color: string; lineWidth: number };
type Mark = TextMark | DrawMark | BoxMark;
type PageEntry = { id: string; sourceIndex: number | null };

function EditorThumbnail({ pdf, entry, index, active, onSelect, onDragStart, onDragOver, onDrop }: { pdf: PdfDocument; entry: PageEntry; index: number; active: boolean; onSelect: () => void; onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void; onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void; onDrop: (event: React.DragEvent<HTMLButtonElement>) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let page: PdfPage | null = null;
    (async () => {
      try {
        page = await pdf.getPage((entry.sourceIndex ?? pdf.numPages - 1) + 1);
        const viewport = page.getViewport({ scale: 0.19 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        if (entry.sourceIndex === null) {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          await page.render({ canvasContext: context, viewport, canvas } as never).promise;
        }
      } catch { /* Keep the thumbnail placeholder if rendering fails. */ }
      finally { page?.cleanup(); }
    })();
    return () => { page?.cleanup(); };
  }, [pdf, entry.sourceIndex]);
  return <button type="button" draggable className={active ? "editor-thumb active" : "editor-thumb"} aria-label={"Go to page " + (index + 1) + ", drag to reorder"} onClick={onSelect} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}>
    <span className="editor-thumb-paper"><canvas ref={canvasRef} /></span>
    <span className="editor-thumb-number">{index + 1}</span>
    <span className="editor-thumb-grip" aria-hidden="true">⠿</span>
  </button>;
}

function toRgb(hex: string) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

export default function PdfEditor({ file, onExport }: { file: File; onExport: (bytes: Uint8Array) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const activePointsRef = useRef<Point[]>([]);
  const cropResizeRef = useRef<{ id: string; handle: string; start: Point; box: { x: number; y: number; width: number; height: number } } | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PdfDocument | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageOrder, setPageOrder] = useState<PageEntry[]>([]);
  const [draggingPageIndex, setDraggingPageIndex] = useState<number | null>(null);
  const totalPageCount = pageOrder.length;
  const [mode, setMode] = useState<ToolMode>("text");
  const [text, setText] = useState("Your text");
  const [color, setColor] = useState("#e34242");
  const [fontSize, setFontSize] = useState(18);
  const [lineWidth, setLineWidth] = useState(3);
  const [marks, setMarksState] = useState<Mark[]>([]);
  const marksRef = useRef<Mark[]>([]);
  const undoStackRef = useRef<Mark[][]>([]);
  const redoStackRef = useRef<Mark[][]>([]);
  const [, setHistoryVersion] = useState(0);
  const setMarks = (update: Mark[] | ((current: Mark[]) => Mark[])) => {
    const previous = marksRef.current;
    const next = typeof update === "function" ? update(previous) : update;
    if (next === previous) return;
    undoStackRef.current = [...undoStackRef.current.slice(-99), previous];
    redoStackRef.current = [];
    marksRef.current = next;
    setMarksState(next);
    setHistoryVersion((value) => value + 1);
  };
  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(marksRef.current);
    marksRef.current = previous;
    setMarksState(previous);
    setHistoryVersion((value) => value + 1);
  };
  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(marksRef.current);
    marksRef.current = next;
    setMarksState(next);
    setHistoryVersion((value) => value + 1);
  };
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const textDragRef = useRef<{ id: string; start: Point; original: Point } | null>(null);
  const [activePoints, setActivePoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    setLoading(true); setError(""); setDocumentProxy(null); setViewport(null); setPageIndex(0); setPageOrder([]); setDraggingPageIndex(null); marksRef.current = []; undoStackRef.current = []; redoStackRef.current = []; setMarksState([]); setHistoryVersion((value) => value + 1);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        loaded = pdf as unknown as PdfDocument;
        if (cancelled) { await loaded.destroy(); return; }
        setDocumentProxy(loaded); setPageOrder(Array.from({ length: pdf.numPages }, (_, index) => ({ id: "source-" + index, sourceIndex: index }))); setLoading(false);
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "Could not open this PDF."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; if (loaded) void loaded.destroy(); };
  }, [file]);

  useEffect(() => {
    if (!documentProxy || !canvasRef.current) return;
    let cancelled = false;
    let pageToClean: PdfPage | null = null;
    setLoading(true); setError("");
    (async () => {
      try {
        const entry = pageOrder[pageIndex];
        if (!entry) return;
        const page = await documentProxy.getPage((entry.sourceIndex ?? documentProxy.numPages - 1) + 1);
        pageToClean = page;
        const nextViewport = page.getViewport({ scale: 1.15 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(nextViewport.width); canvas.height = Math.ceil(nextViewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create a PDF preview.");
        if (entry.sourceIndex === null) {
          context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          await page.render({ canvasContext: context, viewport: nextViewport, canvas } as never).promise;
        }
        if (!cancelled) { viewportRef.current = nextViewport; setViewport(nextViewport); setLoading(false); }
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "Could not render this page."); setLoading(false); }
      } finally { pageToClean?.cleanup(); }
    })();
    return () => { cancelled = true; };
  }, [documentProxy, pageIndex, pageOrder]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function getPoint(event: React.PointerEvent<SVGSVGElement>): Point | null {
    const activeViewport = viewportRef.current;
    const svg = overlayRef.current;
    if (!activeViewport || !svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (activeViewport.width / rect.width);
    const y = (event.clientY - rect.top) * (activeViewport.height / rect.height);
    const [pdfX, pdfY] = activeViewport.convertToPdfPoint(x, y);
    return { x: pdfX, y: pdfY };
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (loading || !viewport) return;
    const point = getPoint(event);
    if (!point) return;
    if (mode === "text") {
      setSelectedTextId(null);
      if (!text.trim()) { setError("Enter text before placing it on the page."); return; }
      setMarks((current) => [...current, { id: `${Date.now()}-${current.length}`, pageIndex, kind: "text", point, text: text.trim(), color, fontSize }]);
      setError("");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointsRef.current = [point];
    setActivePoints([point]);
  }

  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (textDragRef.current) {
      const drag = textDragRef.current;
      const point = getPoint(event);
      if (point) setMarks((current) => current.map((mark) => mark.kind === "text" && mark.id === drag.id ? { ...mark, point: { x: drag.original.x + point.x - drag.start.x, y: drag.original.y + point.y - drag.start.y } } : mark));
      return;
    }
    const resize = cropResizeRef.current;
    if (resize) {
      const point = getPoint(event);
      if (!point) return;
      const dx = point.x - resize.start.x;
      const dy = point.y - resize.start.y;
      const box = resize.box;
      const minSize = 8;
      let next = { ...box };
      if (resize.handle.includes("w")) { const right = box.x + box.width; next.x = Math.min(right - minSize, box.x + dx); next.width = right - next.x; }
      if (resize.handle.includes("e")) next.width = Math.max(minSize, box.width + dx);
      if (resize.handle.includes("s")) { const top = box.y + box.height; next.y = Math.min(top - minSize, box.y + dy); next.height = top - next.y; }
      if (resize.handle.includes("n")) { next.height = Math.max(minSize, box.height - dy); next.y = box.y + box.height - next.height; }
      setMarks((current) => current.map((mark) => mark.id === resize.id && mark.kind === "crop" ? { ...mark, ...next } : mark));
      return;
    }
    if (!activePointsRef.current.length || mode === "text") return;
    const point = getPoint(event);
    if (!point) return;
    const next = mode === "draw" ? [...activePointsRef.current, point] : [activePointsRef.current[0], point];
    activePointsRef.current = next;
    setActivePoints(next);
  }

  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (textDragRef.current) { textDragRef.current = null; return; }
    if (cropResizeRef.current) { cropResizeRef.current = null; return; }
    if (!activePointsRef.current.length || mode === "text") return;
    const point = getPoint(event);
    const points = point ? (mode === "draw" ? [...activePointsRef.current, point] : [activePointsRef.current[0], point]) : activePointsRef.current;
    if (mode === "draw" && points.length > 1) {
      setMarks((current) => [...current, { id: `${Date.now()}-${current.length}`, pageIndex, kind: "draw", points, color, lineWidth }]);
    } else if ((mode === "highlight" || mode === "rectangle" || mode === "crop") && points.length > 1) {
      const first = points[0], last = points[1];
      const width = Math.abs(last.x - first.x), height = Math.abs(last.y - first.y);
      if (width > 2 && height > 2) {
        const cropMark: BoxMark = { id: `${Date.now()}-${pageIndex}`, pageIndex, kind: mode, x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width, height, color: mode === "crop" ? "#635bdb" : color, lineWidth };
        setMarks((current) => mode === "crop" ? [...current.filter((mark) => !(mark.pageIndex === pageIndex && mark.kind === "crop")), cropMark] : [...current, cropMark]);
      }
    }
    activePointsRef.current = []; setActivePoints(null);
  }

  function viewportPoint(point: Point) { return viewport ? viewport.convertToViewportPoint(point.x, point.y) : [0, 0]; }

  async function exportPdf() {
    if (!marks.length && !pageOrder.some((entry) => entry.sourceIndex === null) && pageOrder.every((entry, index) => entry.sourceIndex === index)) { setError("Add an edit or rearrange/insert a page before exporting."); return; }
    setBusy(true); setError("");
    try {
      const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
      const orderedPdf = await PDFDocument.create();
      const templateSize = sourcePdf.getPages()[sourcePdf.getPageCount() - 1].getSize();
      const sourceIndices = pageOrder.filter((entry) => entry.sourceIndex !== null).map((entry) => entry.sourceIndex as number);
      const copiedPages = await orderedPdf.copyPages(sourcePdf, sourceIndices);
      let copiedIndex = 0;
      for (const entry of pageOrder) {
        if (entry.sourceIndex === null) orderedPdf.addPage([templateSize.width, templateSize.height]);
        else orderedPdf.addPage(copiedPages[copiedIndex++]);
      }
      const font = await orderedPdf.embedFont(StandardFonts.Helvetica);
      for (const mark of marks) {
        const page = orderedPdf.getPages()[mark.pageIndex];
        if (!page) continue;
        const paint = toRgb(mark.color);
        if (mark.kind === "text") page.drawText(mark.text, { x: mark.point.x, y: mark.point.y, size: mark.fontSize, font, color: paint });
        else if (mark.kind === "draw") {
          for (let index = 1; index < mark.points.length; index++) page.drawLine({ start: mark.points[index - 1], end: mark.points[index], thickness: mark.lineWidth, color: paint });
        } else if (mark.kind === "crop") page.setCropBox(mark.x, mark.y, mark.width, mark.height);
        else page.drawRectangle({ x: mark.x, y: mark.y, width: mark.width, height: mark.height, color: paint, opacity: mark.kind === "highlight" ? 0.28 : 0.08, borderColor: paint, borderWidth: mark.kind === "rectangle" ? mark.lineWidth : 0, borderOpacity: 1 });
      }
      onExport(await orderedPdf.save());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the edited PDF.");
    } finally { setBusy(false); }
  }

  const pageMarks = marks.filter((mark) => mark.pageIndex === pageIndex);

  function reorderPages(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= pageOrder.length || to >= pageOrder.length) return;
    const selectedId = pageOrder[pageIndex]?.id;
    const nextOrder = [...pageOrder];
    const [moved] = nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, moved);
    const newIndexById = new Map(nextOrder.map((entry, index) => [entry.id, index]));
    setPageOrder(nextOrder);
    setPageIndex(newIndexById.get(selectedId ?? "") ?? to);
    setMarks((current) => current.map((mark) => {
      const oldPage = pageOrder[mark.pageIndex];
      const nextIndex = oldPage ? newIndexById.get(oldPage.id) : undefined;
      return nextIndex === undefined ? mark : { ...mark, pageIndex: nextIndex };
    }));
    setDraggingPageIndex(null);
    setSelectedTextId(null);
  }
  const activeToolHint = mode === "text" ? "Click the page to place your text." : mode === "draw" ? "Hold and drag to draw." : mode === "highlight" ? "Drag over an area to highlight it." : mode === "crop" ? "Drag to select the area to keep, then drag any of its 8 handles to resize the crop border." : "Drag to add a rectangle.";

  return (
    <section className="pdf-editor" aria-label="PDF editor">
      <div className="editor-toolbar">
        <div className="editor-tool-group">
          <button type="button" className="editor-tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={undoStackRef.current.length === 0} onClick={undo}><Undo2 size={16} /> Undo</button>
          <button type="button" className="editor-tool" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={redoStackRef.current.length === 0} onClick={redo}><Redo2 size={16} /> Redo</button>
          <button type="button" className={mode === "text" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("text")}><Type size={16} /> Text</button>
          <button type="button" className={mode === "draw" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("draw")}><Pencil size={16} /> Draw</button>
          <button type="button" className={mode === "highlight" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("highlight")}><Highlighter size={16} /> Highlight</button>
          <button type="button" className={mode === "rectangle" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("rectangle")}><RectangleHorizontal size={16} /> Rectangle</button>
          <button type="button" className={mode === "crop" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("crop")}><Crop size={16} /> Crop</button>
        </div>
        <div className="editor-settings">
          {mode === "text" && <label className="editor-text-setting"><span>{selectedTextId ? "Edit selected text" : "Text"}</span><input value={text} onChange={(event) => { const value = event.target.value; setText(value); if (selectedTextId) setMarks((current) => current.map((mark) => mark.kind === "text" && mark.id === selectedTextId ? { ...mark, text: value } : mark)); }} maxLength={180} /></label>}
          <label className="editor-color-setting" title="Edit color"><span>Color</span><input aria-label="Edit color" type="color" value={color} onChange={(event) => { const value = event.target.value; setColor(value); if (selectedTextId) setMarks((current) => current.map((mark) => mark.kind === "text" && mark.id === selectedTextId ? { ...mark, color: value } : mark)); }} /></label>
          {mode === "text" ? <label className="editor-range-setting"><span>Size {fontSize}</span><input aria-label="Text size" type="range" min="8" max="96" value={fontSize} onChange={(event) => { const value = Number(event.target.value); setFontSize(value); if (selectedTextId) setMarks((current) => current.map((mark) => mark.kind === "text" && mark.id === selectedTextId ? { ...mark, fontSize: value } : mark)); }} /></label> : <label className="editor-range-setting"><span>Width {lineWidth}</span><input aria-label="Stroke width" type="range" min="1" max="12" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label>}
        </div>
      </div>
      <div className="editor-hint"><MousePointer2 size={14} /> {activeToolHint} Existing PDF text is not directly editable yet; this tool adds content on top.</div>
      {documentProxy && pageOrder.length > 0 && <div className="editor-thumbnails" aria-label="PDF page thumbnails">
        {pageOrder.map((entry, index) => <EditorThumbnail key={entry.id} pdf={documentProxy} entry={entry} index={index} active={index === pageIndex} onSelect={() => { setPageIndex(index); setSelectedTextId(null); }} onDragStart={(event) => { setDraggingPageIndex(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const from = draggingPageIndex ?? Number(event.dataTransfer.getData("text/plain")); reorderPages(from, index); }} />)}
      </div>}
      <div className="editor-page-nav">
        <button type="button" className="editor-nav-button" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15} /> Previous</button>
        <span>Page <strong>{totalPageCount ? pageIndex + 1 : 0}</strong> of {totalPageCount}</span>
        <button type="button" className="editor-nav-button" disabled={!totalPageCount || pageIndex >= totalPageCount - 1 || loading} onClick={() => setPageIndex((current) => Math.min(totalPageCount - 1, current + 1))}>Next <ArrowRight size={15} /></button>
      </div>
      <div className="editor-preview-scroll">
        {loading && <div className="editor-loading">Loading PDF page…</div>}
        {error && <div className="error editor-error" role="alert">{error}</div>}
        <div className="editor-page" style={viewport ? { width: viewport.width, height: viewport.height } : undefined}>
          <canvas ref={canvasRef} className="editor-canvas" />
          {viewport && <svg ref={overlayRef} className="editor-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
            {pageMarks.map((mark) => {
              if (mark.kind === "text") { const [x, y] = viewportPoint(mark.point); return <text key={mark.id} x={x} y={y} fill={mark.color} fontSize={mark.fontSize * 1.15} fontFamily="Arial, sans-serif" style={{ cursor: mode === "text" ? "move" : "default", pointerEvents: mode === "text" ? "all" : "none" }} onPointerDown={(event) => { if (mode !== "text") return; event.stopPropagation(); const start = getPoint(event as unknown as React.PointerEvent<SVGSVGElement>); const svg = overlayRef.current; if (!start || !svg) return; setSelectedTextId(mark.id); setText(mark.text); setColor(mark.color); setFontSize(Math.round(mark.fontSize)); svg.setPointerCapture(event.pointerId); textDragRef.current = { id: mark.id, start, original: mark.point }; }}>{mark.text}</text>; }
              if (mark.kind === "draw") { const points = mark.points.map((point) => viewportPoint(point).join(",")).join(" "); return <polyline key={mark.id} points={points} fill="none" stroke={mark.color} strokeWidth={mark.lineWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" />; }
              const [x1, y1] = viewportPoint({ x: mark.x, y: mark.y + mark.height });
              const [x2, y2] = viewportPoint({ x: mark.x + mark.width, y: mark.y });
              const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottom = Math.max(y1, y2);
              if (mark.kind === "crop") {
                const handles = [
                  { id: "nw", x: left, y: top }, { id: "n", x: (left + right) / 2, y: top }, { id: "ne", x: right, y: top },
                  { id: "e", x: right, y: (top + bottom) / 2 }, { id: "se", x: right, y: bottom }, { id: "s", x: (left + right) / 2, y: bottom },
                  { id: "sw", x: left, y: bottom }, { id: "w", x: left, y: (top + bottom) / 2 },
                ];
                return <g key={mark.id}>
                  <rect x={left} y={top} width={right - left} height={bottom - top} fill="#635bdb" fillOpacity={0.06} stroke="#635bdb" strokeWidth={1.8} strokeDasharray="7 4" />
                  {handles.map((handle) => <circle key={handle.id} cx={handle.x} cy={handle.y} r={6} fill="#ffffff" stroke="#635bdb" strokeWidth={2} style={{ cursor: handle.id === "n" || handle.id === "s" ? "ns-resize" : handle.id === "e" || handle.id === "w" ? "ew-resize" : handle.id === "ne" || handle.id === "sw" ? "nesw-resize" : "nwse-resize", touchAction: "none" }} onPointerDown={(event) => {
                    event.stopPropagation();
                    const start = getPoint(event as unknown as React.PointerEvent<SVGSVGElement>);
                    const svg = overlayRef.current;
                    if (!start || !svg) return;
                    svg.setPointerCapture(event.pointerId);
                    cropResizeRef.current = { id: mark.id, handle: handle.id, start, box: { x: mark.x, y: mark.y, width: mark.width, height: mark.height } };
                  }} />)}
                </g>;
              }
              return <rect key={mark.id} x={left} y={top} width={right - left} height={bottom - top} fill={mark.color} fillOpacity={mark.kind === "highlight" ? 0.28 : 0.08} stroke={mark.kind === "rectangle" ? mark.color : "none"} strokeWidth={mark.lineWidth * 1.15} />;
            })}
            {activePoints && activePoints.length > 0 && (mode === "draw" ? <polyline points={activePoints.map((point) => viewportPoint(point).join(",")).join(" ")} fill="none" stroke={color} strokeWidth={lineWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" /> : activePoints.length > 1 && <rect x={Math.min(viewportPoint(activePoints[0])[0], viewportPoint(activePoints[1])[0])} y={Math.min(viewportPoint(activePoints[0])[1], viewportPoint(activePoints[1])[1])} width={Math.abs(viewportPoint(activePoints[1])[0] - viewportPoint(activePoints[0])[0])} height={Math.abs(viewportPoint(activePoints[1])[1] - viewportPoint(activePoints[0])[1])} fill={color} fillOpacity={mode === "highlight" ? 0.28 : 0.08} stroke={mode === "rectangle" || mode === "crop" ? (mode === "crop" ? "#635bdb" : color) : "none"} strokeWidth={lineWidth * 1.15} strokeDasharray={mode === "crop" ? "7 4" : undefined} />)}
          </svg>}
        </div>
      </div>
      <div className="editor-footer">
        <button type="button" className="editor-clear" disabled={loading || busy || !totalPageCount} onClick={() => { const insertAt = pageIndex + 1; const next = [...pageOrder]; next.splice(insertAt, 0, { id: "blank-" + Date.now(), sourceIndex: null }); setPageOrder(next); setPageIndex(insertAt); setSelectedTextId(null); setError(""); }}>+ Insert blank page after current</button>
        <span>{marks.length} edit{marks.length === 1 ? "" : "s"} added</span>
        {selectedTextId && <button type="button" className="editor-clear" disabled={busy} onClick={() => { setMarks((current) => current.filter((mark) => mark.id !== selectedTextId)); setSelectedTextId(null); setText("Your text"); }}>Delete selected text</button>}
        <button type="button" className="editor-clear" disabled={!marks.length || busy} onClick={() => setMarks([])}>Clear edits</button>
        <button type="button" className="primary editor-export" disabled={(!marks.length && !pageOrder.some((entry) => entry.sourceIndex === null) && pageOrder.every((entry, index) => entry.sourceIndex === index)) || busy || loading} onClick={exportPdf}>{busy ? "Exporting…" : "Export edited PDF"}</button>
      </div>
    </section>
  );
}
