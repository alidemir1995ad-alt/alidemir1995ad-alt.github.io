/*
 * pdf-embed.js (version 2)
 * Shows a PDF inside a web page using Mozilla's pdf.js.
 *  - Short documents (up to 4 pages, e.g. a CV) are drawn in full; on
 *    phones the pages simply stack.
 *  - Long documents (e.g. a paper) stay in a scroll box on every screen,
 *    and only the pages near the visible area are drawn, so a 50-page
 *    paper does not slow the page down or exhaust a phone's memory.
 *  - Links stay clickable: web and e-mail links open normally; links to
 *    other places in the PDF (citations, tables, sections) scroll there.
 *  - If pdf.js cannot load, the browser's own PDF viewer is used instead.
 *
 * Markup it expects (see _includes/pdf-embed.html):
 *   <div class="pdf-embed" data-src="/files/file.pdf">
 *     <span class="pdf-embed__count"></span>
 *     <div class="pdf-embed__pages"></div>
 *   </div>
 */

// pdf.js is loaded from the jsDelivr CDN. To self-host instead, copy the
// pdfjs-dist package into your repo and set data-pdfjs="/path/to/it/" on
// the .pdf-embed element.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/";
const LONG_DOC = 4; // more pages than this = "long document" behaviour

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
  const counter = box.querySelector(".pdf-embed__count");

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

  const total = pdf.numPages;
  const long = total > LONG_DOC;
  if (long) box.classList.add("pdf-embed--long");

  // One placeholder per page, sized to the page's shape before anything is drawn.
  const loaded = await Promise.all(
    Array.from({ length: total }, (_, i) => pdf.getPage(i + 1))
  );
  pagesBox.textContent = "";
  const pages = loaded.map((page, i) => {
    const vp = page.getViewport({ scale: 1 });
    const wrap = document.createElement("div");
    wrap.className = "pdf-embed__page";
    wrap.style.aspectRatio = vp.width + " / " + vp.height;
    pagesBox.appendChild(wrap);
    return { num: i + 1, page, wrap, canvas: null, task: null, linked: false, near: !long };
  });

  // ---- drawing ----------------------------------------------------------
  const maxDpr = long ? 2 : 3; // sharp on high-DPI screens, but memory-safe
  let queue = Promise.resolve();

  function schedule(p) {
    queue = queue.then(() => draw(p)).catch(() => {});
    return queue;
  }

  async function draw(p) {
    if (!p.near) return; // scrolled away before its turn came
    const cssWidth = p.wrap.clientWidth;
    if (!cssWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const target = Math.round(cssWidth * dpr);
    if (p.canvas && Math.abs(p.canvas.width - target) < 4) return; // already sharp
    if (!p.linked) {
      await addLinks(p);
      p.linked = true;
    }
    if (!p.near) return; // scrolled away while the links were loading
    const vp = p.page.getViewport({ scale: target / p.page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    p.task = p.page.render({ canvas, viewport: vp });
    try {
      await p.task.promise;
    } catch (e) {
      return; // cancelled because the page scrolled far away
    } finally {
      p.task = null;
    }
    if (!p.near) {
      canvas.width = 0; // scrolled away while drawing: discard
      return;
    }
    if (p.canvas) p.canvas.replaceWith(canvas);
    else p.wrap.prepend(canvas);
    p.canvas = canvas;
  }

  function release(p) {
    if (p.task) p.task.cancel();
    if (p.canvas) {
      p.canvas.width = 0; // frees the pixel memory immediately
      p.canvas.remove();
      p.canvas = null;
    }
  }

  // ---- links --------------------------------------------------------------
  async function addLinks(p) {
    const vp = p.page.getViewport({ scale: 1 });
    const annots = await p.page.getAnnotations();
    for (const a of annots) {
      if (a.subtype !== "Link" || !(a.url || a.dest)) continue;
      const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const el = document.createElement("a");
      el.className = "pdf-embed__link";
      // Percentages, so links stay in place at any width without redrawing.
      el.style.left = (Math.min(x1, x2) / vp.width) * 100 + "%";
      el.style.top = (Math.min(y1, y2) / vp.height) * 100 + "%";
      el.style.width = (Math.abs(x2 - x1) / vp.width) * 100 + "%";
      el.style.height = (Math.abs(y2 - y1) / vp.height) * 100 + "%";
      if (a.url) {
        el.href = a.url;
        el.title = a.url.replace(/^mailto:/, "");
        if (!a.url.startsWith("mailto:")) {
          el.target = "_blank";
          el.rel = "noopener";
        }
      } else {
        el.href = "#";
        el.title = "Go to this place in the document";
        el.addEventListener("click", (e) => {
          e.preventDefault();
          goTo(a.dest);
        });
      }
      p.wrap.appendChild(el);
    }
  }

  async function goTo(dest) {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return;
    const ref = explicit[0];
    const index = typeof ref === "number" ? ref : await pdf.getPageIndex(ref);
    const target = pages[index];
    if (!target) return;
    // Scroll to the exact spot on the page when the link says where.
    let offset = 0;
    const kind = explicit[1] && explicit[1].name;
    const top = kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : null;
    if (typeof top === "number") {
      const vp = target.page.getViewport({ scale: 1 });
      const [, y] = vp.convertToViewportPoint(0, top);
      offset = (y / vp.height) * target.wrap.clientHeight;
    }
    if (long) {
      pagesBox.scrollTo({ top: target.wrap.offsetTop + offset - 8, behavior: "smooth" });
    } else {
      const y = target.wrap.getBoundingClientRect().top + window.scrollY + offset - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  // ---- short documents: draw everything ---------------------------------
  if (!long) {
    for (const p of pages) await schedule(p);
    if (counter) counter.textContent = total > 1 ? total + " pages" : "";
  } else {
    // ---- long documents: draw near the visible area, free far pages -----
    const byWrap = new Map(pages.map((p) => [p.wrap, p]));
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = byWrap.get(e.target);
          p.near = e.isIntersecting;
          if (p.near) schedule(p);
        }
      },
      { root: pagesBox, rootMargin: "100% 0px" }
    );
    const far = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (!e.isIntersecting) release(byWrap.get(e.target));
      },
      { root: pagesBox, rootMargin: "400% 0px" }
    );
    pages.forEach((p) => {
      near.observe(p.wrap);
      far.observe(p.wrap);
    });

    // "Page 3 of 46" indicator.
    let ticking = false;
    const updateCounter = () => {
      ticking = false;
      const line = pagesBox.scrollTop + pagesBox.clientHeight / 3;
      let current = 1;
      for (const p of pages) {
        if (p.wrap.offsetTop <= line) current = p.num;
        else break;
      }
      if (counter) counter.textContent = "Page " + current + " of " + total;
    };
    pagesBox.addEventListener("scroll", () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateCounter);
      }
    });
    updateCounter();
  }

  // Redraw sharper or smaller when the box changes width (resize, rotation).
  let lastWidth = pagesBox.clientWidth;
  let timer;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Math.abs(pagesBox.clientWidth - lastWidth) < 2) return;
      lastWidth = pagesBox.clientWidth;
      pages.forEach((p) => {
        if (p.canvas || !long) schedule(p);
      });
    }, 200);
  }).observe(pagesBox);
}

document.querySelectorAll(".pdf-embed[data-src]").forEach((box) => {
  setup(box).catch((err) => {
    console.warn("pdf-embed: using the browser's PDF viewer instead.", err);
    showFallback(box.querySelector(".pdf-embed__pages"), box.dataset.src);
  });
});
