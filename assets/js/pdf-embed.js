/*
 * pdf-embed.js
 * Shows every page of a PDF in a scrollable box, using Mozilla's pdf.js.
 * Works on phones as well as desktops, and links inside the PDF stay
 * clickable. If pdf.js cannot load, it falls back to the browser's own
 * PDF viewer in an iframe.
 *
 * Markup it expects (see _includes/pdf-embed.html):
 *   <div class="pdf-embed" data-src="/files/file.pdf">
 *     <div class="pdf-embed__pages"></div>
 *   </div>
 */

// pdf.js is loaded from the jsDelivr CDN. To self-host instead, copy the
// pdfjs-dist package into your repo and set data-pdfjs="/path/to/it/" on
// the .pdf-embed element.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/";

let pdfjsPromise = null;

function loadPdfjs(base) {
  if (!pdfjsPromise) {
    // The "legacy" build supports older browsers (e.g. older iPhones).
    pdfjsPromise = import(base + "legacy/build/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base + "legacy/build/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsPromise;
}

function showFallback(pagesBox, src) {
  pagesBox.textContent = "";
  const frame = document.createElement("iframe");
  frame.className = "pdf-embed__frame";
  frame.src = src + "#view=FitH";
  frame.title = "PDF document";
  pagesBox.appendChild(frame);
}

async function setup(box) {
  const src = box.dataset.src;
  const base = box.dataset.pdfjs || PDFJS_BASE;
  const pagesBox = box.querySelector(".pdf-embed__pages");

  let pdf;
  try {
    const pdfjs = await loadPdfjs(base);
    pdf = await pdfjs.getDocument({
      url: src,
      standardFontDataUrl: base + "standard_fonts/",
      cMapUrl: base + "cmaps/",
      cMapPacked: true,
      wasmUrl: base + "wasm/",
      iccUrl: base + "iccs/",
    }).promise;
  } catch (err) {
    console.warn("pdf-embed: using the browser's PDF viewer instead.", err);
    showFallback(pagesBox, src);
    return;
  }

  // One wrapper per page: a canvas for the page image, plus links on top.
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const links = (await page.getAnnotations()).filter(
      (a) => a.subtype === "Link" && a.url
    );
    const wrap = document.createElement("div");
    wrap.className = "pdf-embed__page";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    pages.push({ page, wrap, canvas, links });
  }
  pagesBox.textContent = "";
  pages.forEach((p) => pagesBox.appendChild(p.wrap));

  let drawnWidth = 0;
  let generation = 0;

  async function draw() {
    const style = getComputedStyle(pagesBox);
    const width = Math.floor(
      pagesBox.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
    );
    if (width <= 0 || Math.abs(width - drawnWidth) < 2) return;
    drawnWidth = width;
    const gen = ++generation;
    // Render at screen resolution so text stays sharp on high-DPI screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    for (const p of pages) {
      const scale = width / p.page.getViewport({ scale: 1 }).width;
      const cssViewport = p.page.getViewport({ scale });
      const pixelViewport = p.page.getViewport({ scale: scale * dpr });

      // Draw into a fresh canvas and swap it in, so resizing never flashes blank.
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(pixelViewport.width);
      canvas.height = Math.floor(pixelViewport.height);
      await p.page.render({ canvas, viewport: pixelViewport }).promise;
      if (gen !== generation) return; // a newer resize took over

      p.wrap.style.width = width + "px";
      p.canvas.replaceWith(canvas);
      p.canvas = canvas;

      // Clickable areas over the PDF's own links.
      p.wrap.querySelectorAll(".pdf-embed__link").forEach((el) => el.remove());
      for (const link of p.links) {
        const [x1, y1] = cssViewport.convertToViewportPoint(link.rect[0], link.rect[1]);
        const [x2, y2] = cssViewport.convertToViewportPoint(link.rect[2], link.rect[3]);
        const a = document.createElement("a");
        a.className = "pdf-embed__link";
        a.href = link.url;
        a.title = link.url.replace(/^mailto:/, "");
        if (!link.url.startsWith("mailto:")) {
          a.target = "_blank";
          a.rel = "noopener";
        }
        a.style.left = Math.min(x1, x2) + "px";
        a.style.top = Math.min(y1, y2) + "px";
        a.style.width = Math.abs(x2 - x1) + "px";
        a.style.height = Math.abs(y2 - y1) + "px";
        p.wrap.appendChild(a);
      }
    }
  }

  await draw();

  // Redraw when the box changes width (window resize, phone rotation).
  let timer;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  }).observe(pagesBox);
}

document.querySelectorAll(".pdf-embed[data-src]").forEach((box) => {
  setup(box).catch((err) => {
    console.warn("pdf-embed: using the browser's PDF viewer instead.", err);
    showFallback(box.querySelector(".pdf-embed__pages"), box.dataset.src);
  });
});
