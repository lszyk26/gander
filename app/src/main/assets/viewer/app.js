"use strict";

var vwParams = new URLSearchParams(location.search);
var vwName = vwParams.get("name") || "file";
var vwExt = (vwParams.get("ext") || "").toLowerCase();

function vwStatus(msg) {
  var el = document.getElementById("vw-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "vw-status";
    el.className = "vw-status";
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.className = "vw-status";
  el.textContent = msg;
  el.style.display = "";
}

function vwStatusDone() {
  var el = document.getElementById("vw-status");
  if (el) el.style.display = "none";
}

function vwError(title, detail) {
  var el = document.getElementById("vw-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "vw-status";
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.className = "vw-status vw-error";
  el.style.display = "";
  el.innerHTML = "";
  var t = document.createElement("div");
  t.className = "vw-error-title";
  t.textContent = title;
  var d = document.createElement("div");
  d.className = "vw-error-detail";
  d.textContent = detail || "";
  el.appendChild(t);
  el.appendChild(d);
}

/*
 * The card a viewer shows instead of its document when the WebView is too old for the
 * library that draws it, and whether it showed it. Called before the viewer reads a
 * byte, and a true answer means stop: the card is the whole page.
 *
 * Kotlin decides, and says so on the URL. webview=<major>&needs=<floor> arrive only when
 * the engine about to render is older than the library supports; PDFs, Word documents
 * and Markdown each have a floor, and WebViewFloor.kt says where each number comes from.
 * That is a version read from the system rather than a timeout or a feature sniff, so
 * the same phone gets the same answer every time.
 *
 * locked=1 arrives when the reader has no way to update the WebView, which is the case on
 * a phone whose manufacturer supplies it and allows no replacement. Telling those readers
 * to go and update it is the one thing the card must not do. On such a phone the version
 * sometimes cannot be read at all, and then locked=1 arrives without a major beside it,
 * which is why this gates on either parameter rather than on the version.
 *
 * Once the card is up nothing may replace it, which is why window.onerror goes. pdf.html
 * fetches its renderer after this file whatever happens, an engine that old often cannot
 * parse it, and that failure would land in the handler at the foot of this file and swap
 * the card for the parser's complaint. That is what issue #31 was, on WebView 64. The
 * Word and Markdown libraries load ahead of this file, so their failures never reach it.
 */
function vwWebViewTooOld(what) {
  var have = vwParams.get("webview");
  var locked = vwParams.get("locked");
  if (!have && !locked) return false;
  vwNeedsNewerWebView(what, have, vwParams.get("needs"), locked);
  window.onerror = null;
  return true;
}

/*
 * what is the format as the sentences need it, plural and capitalised: "PDFs", "Word
 * documents", "Markdown files". No floor is written here. The number arrives in the query
 * string so that raising one stays a one-constant edit in Kotlin, which means every
 * sentence has to work without it too.
 *
 * No card says what else still opens. On the oldest engines that see one, other formats
 * fail as well: on the WebView 64 of issue #31, PDFs, Word documents and Markdown all did.
 */
function vwNeedsNewerWebView(what, have, needs, locked) {
  if (locked) {
    vwError(
      what + " cannot be shown on this phone",
      (needs
        ? what + " need the browser engine built into your phone to be version " +
          needs + " or newer, and this one is " + (have || "older") + ". "
        : what + " need a newer browser engine than the one built into your phone. ") +
      "On this phone that engine comes from the manufacturer and cannot be " +
      "updated or replaced, so installing Android System WebView will not help."
    );
    return;
  }
  vwError(
    "Android System WebView is too old to show " + what,
    "Gander opens " + what + " using Android System WebView, the browser engine built " +
    "into your phone. " +
    (have && needs
      ? what + " need version " + needs + " or newer, and this one is " + have + ". "
      : "") +
    "Updating Android System WebView and reopening the file will fix it."
  );
}

/*
 * Publish the height the reader can actually see as --vw-fit, for the viewers that
 * centre a document short enough to fit on the screen.
 *
 * 100vh is not reliably that height. These pages carry no viewport meta, so the WebView
 * lays out at 980 CSS px and scales that to the screen, and the initial containing block
 * is fixed at the 980-wide geometry. A page whose content is wider than 980 overflows,
 * loadWithOverviewMode zooms further out to fit it, and the reader can then see more CSS
 * px of height than 100vh reports. Measured on the phone: an ordinary widescreen deck is
 * 1279 px wide and shows 2467 px of height against a 100vh that stays at 1886.
 *
 * window.innerHeight is the number that is right, and it is the one to use rather than
 * visualViewport.height, which shrinks as the reader pinches in. Centring against that
 * would move the document under the gesture; innerHeight holds still through a pinch and
 * changes only when the screen does.
 *
 * Call this once the document is in the DOM, because it is the content overflowing that
 * changes the answer and no resize is fired when that happens. The listener bound here is
 * for rotation, which does fire one, and is the only word the page gets: ViewerActivity
 * declares configChanges and never rebuilds. It binds on first call rather than on load
 * so that the viewers with nothing to centre do not carry it.
 */
var vwFitBound = false;

function vwFitHeight() {
  if (!vwFitBound) {
    vwFitBound = true;
    addEventListener("resize", vwFitHeight);
  }
  document.documentElement.style.setProperty("--vw-fit", window.innerHeight + "px");
  // A document wider than the layout zooms the page out, which changes what a dp is here
  vwPlaceTop();
}

/*
 * The room a document leaves at its top for the title bar Gander floats over it, which goes up
 * out of sight as the reader scrolls down. Issue #40.
 *
 * top= on the URL, and "t" over the channel when it changes, give the bar's height in dp, and
 * --vw-top is that in this page's CSS px at its widest zoom, kept clear by app.css. vv.width *
 * vv.scale is the WebView's width in dp at any pinch and innerWidth what the page fits across it
 * at the widest, so the two say what a dp is here. --vw-bar-gone is how much of the bar is out
 * of sight, in the same px, for whatever on the page is held under it.
 */
var vwTopDp = Number(vwParams.get("top")) || 0;
var vwTopPx = 0;
var vwTopBound = false;
var vwBarGoneDp = 0;
var vwBarGonePx = 0;

function vwPlaceTop() {
  if (!vwTopDp && !vwTopPx) return;
  if (!vwTopBound) {
    vwTopBound = true;
    // Turning the phone changes the width a dp is measured against
    addEventListener("resize", vwPlaceTop);
  }
  var vv = window.visualViewport;
  var across = vv && vv.scale > 0 ? vv.width * vv.scale : 0;
  var perDp = across > 0 && window.innerWidth > 0 ? window.innerWidth / across : 1;
  var px = vwTopDp * perDp;
  var gone = vwBarGoneDp * perDp;
  var root = document.documentElement.style;
  if (px !== vwTopPx) {
    vwTopPx = px;
    root.setProperty("--vw-top", px + "px");
  }
  if (gone !== vwBarGonePx) {
    vwBarGonePx = gone;
    root.setProperty("--vw-bar-gone", gone + "px");
  }
}

vwPlaceTop();

/*
 * The app on the bar, over the channel, from whichever script holds it: "t<dp>" its height, which
 * the search bar under it adds to, and "b<dp>" how much of it has gone up out of sight, sent as it
 * follows the reader's scrolling. Answers whether the message was one of those.
 */
function vwBarSaid(msg) {
  var verb = msg.charAt(0);
  if (verb === "t") {
    vwTopDp = Number(msg.slice(1)) || 0;
    vwPlaceTop();
    return true;
  }
  if (verb === "b") {
    vwBarGoneDp = Number(msg.slice(1)) || 0;
    vwPlaceTop();
    return true;
  }
  return false;
}

/*
 * Gives each sheet its own paper size for print, which Chromium then fits to the paper
 * chosen. Without it an A4 page printed on Letter runs on to a second, nearly empty sheet.
 * A named page per size, since a document can turn some of its pages sideways.
 */
function vwPrintSizes(sheets) {
  var rules = "";
  var names = {};
  for (var i = 0; i < sheets.length; i++) {
    var style = sheets[i].style;
    if (!style.width || !style.minHeight) continue;
    var size = style.width + " " + style.minHeight;
    if (!names[size]) {
      names[size] = "vw-sheet-" + i;
      rules += "@page " + names[size] + " { size: " + size + "; } ";
    }
    style.page = names[size];
  }
  if (!rules) return;
  var css = document.createElement("style");
  css.textContent = "@media print { " + rules + "}";
  document.head.appendChild(css);
}

/*
 * Takes the address off every link in a rendered document that is not a web or mail
 * address, a phone number or a jump within the page.
 *
 * docx-preview copies a link's target out of the file into href without looking at it,
 * and PPTXjs and SheetJS write theirs into markup too, so a crafted document can carry
 * a javascript: link, or one to another of Gander's pages. The page's policy already
 * refuses to run the first and ViewerActivity to open the second; this makes both
 * plain text, which is also what they look like to anyone who taps them. A list of
 * what may stay rather than of what must go, because browsers read "java\nscript:" as
 * javascript: and a list of bad schemes would have to know every such spelling.
 */
function vwDisarmLinks(root) {
  var links = root.querySelectorAll("a[href], area[href]");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href").trim();
    if (href.charAt(0) === "#") continue;
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
    if (scheme && /^(https?|mailto|tel)$/i.test(scheme[1])) continue;
    links[i].removeAttribute("href");
  }
}

function vwDocUrl() {
  return "/doc/file" + (vwExt ? "." + vwExt : "");
}

/*
 * How large a document has to be before the card goes up for reading it.
 *
 * .vw-wait holds the card back for 700 ms by animating its visibility, and only the
 * page's main thread can end that. Every page but the PDF one reads its document in
 * one piece on that thread, and a document fetched well inside the hold gave it no
 * chance to: the hold ran out unseen, and a spreadsheet of thirty thousand rows left
 * the reader on a blank page for the seconds it took to read, where before the hold
 * they were shown the card. Past this size the card goes up at once, and is given a
 * frame to be drawn in, before the reading starts.
 *
 * A megabyte is a judgment rather than a measurement. Below it, reading is short
 * enough that the hold covers it in the files .vw-wait was measured on; above it, a
 * card that comes and goes quickly costs less than a blank page for a slow one.
 */
var VW_BUSY_BYTES = 1024 * 1024;

/* [doc], once the card is on screen if [size] says reading it will take a while. */
function vwShowBusy(doc, size) {
  var el = document.getElementById("vw-status");
  if (size < VW_BUSY_BYTES || !el || el.style.display === "none") return doc;
  el.classList.remove("vw-wait");
  return new Promise(function (resolve) {
    // The frame the card is drawn in comes after this callback, and the timeout after it
    requestAnimationFrame(function () { setTimeout(function () { resolve(doc); }, 0); });
  });
}

/* Fetch the document being viewed. kind: "buffer" | "text" */
function vwFetchDoc(kind) {
  return fetch(vwDocUrl()).then(function (r) {
    if (!r.ok) throw new Error("Could not read the file (HTTP " + r.status + ")");
    return kind === "text" ? r.text() : r.arrayBuffer();
  }).then(function (doc) {
    return vwShowBusy(doc, kind === "text" ? doc.length : doc.byteLength);
  });
}

/* Anything can be asked for as text, including a multi-gigabyte binary, so the
   text viewer reads a page at a time and lets the reader ask for the next one
   rather than committing the whole file to the DOM up front. */
var VW_TEXT_PAGE = 5 * 1024 * 1024;

/* Encoding of a file from its byte order mark, if it has one. The decoder
   strips the mark itself. */
function vwEncodingOf(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
  return "utf-8";
}

/*
 * Opens the document for paged reading. Resolves to { next }, where next()
 * resolves to { text, bytes, done } for the next VW_TEXT_PAGE bytes.
 */
function vwOpenText() {
  return vwOpenTextPages().then(function (doc) {
    // A page is read into the DOM in one piece, like any other document: see VW_BUSY_BYTES
    var next = doc.next;
    doc.next = function () {
      return next().then(function (page) { return vwShowBusy(page, page.bytes); });
    };
    return doc;
  });
}

function vwOpenTextPages() {
  return fetch(vwDocUrl()).then(function (r) {
    if (!r.ok) throw new Error("Could not read the file (HTTP " + r.status + ")");

    // One streaming decoder across every page, so a multi-byte character split
    // by a page boundary still comes out whole. Decoding stays lenient, so an
    // unfamiliar encoding degrades to replacement characters rather than an error
    var decoder = null;
    function decode(bytes, last) {
      if (!decoder) decoder = new TextDecoder(vwEncodingOf(bytes));
      return { text: decoder.decode(bytes, { stream: !last }), bytes: bytes.length, done: last };
    }

    // A WebView too old for the Streams API has to buffer the whole body
    if (!r.body || !r.body.getReader) {
      return r.arrayBuffer().then(function (buf) {
        var all = new Uint8Array(buf);
        var off = 0;
        return {
          next: function () {
            var end = Math.min(off + VW_TEXT_PAGE, all.length);
            var page = all.subarray(off, end);
            off = end;
            return Promise.resolve(decode(page, off >= all.length));
          }
        };
      });
    }

    var reader = r.body.getReader();
    var pending = [];
    var held = 0;
    var ended = false;

    return {
      next: function () {
        // Overshoot the page by a chunk rather than stopping level with it, so
        // a file that ends exactly on the boundary is known to be finished and
        // does not offer an empty page
        function pump() {
          if (ended || held > VW_TEXT_PAGE) return Promise.resolve();
          return reader.read().then(function (res) {
            if (res.done) { ended = true; return; }
            pending.push(res.value);
            held += res.value.length;
            return pump();
          });
        }
        return pump().then(function () {
          var take = Math.min(held, VW_TEXT_PAGE);
          var page = new Uint8Array(take);
          var off = 0;
          while (off < take) {
            var chunk = pending[0];
            var n = Math.min(chunk.length, take - off);
            page.set(chunk.subarray(0, n), off);
            off += n;
            if (n === chunk.length) pending.shift();
            else pending[0] = chunk.subarray(n);
          }
          held -= take;
          return decode(page, ended && held === 0);
        });
      }
    };
  });
}

/*
 * Whether most of text's letters are in a right-to-left script, or null when it has none or the
 * engine cannot tell scripts apart. Not its first letter: a file in Arabic or Hebrew often opens
 * with an English name or header. Script extensions (scx) take in the tatweel, U+0640, which
 * Arabic and Persian text draws rules with: its own script is Common, so a rule of it would count
 * against. A \p{} literal would stop engines below Chromium 64 parsing this file, so the patterns
 * are built when asked for.
 */
function vwMostlyRightToLeft(text) {
  var letter, rtlLetter;
  try {
    letter = new RegExp("\\p{L}", "gu");
    rtlLetter = new RegExp("(?=\\p{L})[\\p{scx=Arabic}\\p{scx=Hebrew}\\p{scx=Syriac}" +
      "\\p{scx=Thaana}\\p{scx=Nko}\\p{scx=Adlam}]", "gu");
  } catch (e) {
    return null;
  }
  var all = (text.match(letter) || []).length;
  return all ? (text.match(rtlLetter) || []).length * 2 > all : null;
}

/* How much of a document the count reads. Its opening tells as well as the whole, and counting
   megabytes at once holds hundreds of megabytes of matches. */
var VW_DIRECTION_SAMPLE = 64 * 1024;

var VW_JSON_INDENT = "  ";

/*
 * The largest document worth laying out, in characters.
 *
 * Laying out costs little; drawing the result costs a great deal, because a
 * minified megabyte becomes about a hundred thousand lines. Measured at 390x844
 * with the processor slowed fourfold, which is roughly a mid-range phone: 1 MB
 * takes 1.0 s to lay out and draw against 0.4 s drawn as it came, 2 MB takes
 * 2.3 s against 0.7 s, and 5 MB takes 5.7 s against 1.8 s and needs 96 MB of
 * heap. Tripling the time a large file takes to open is not a trade its reader
 * asked for, and past a hundred thousand lines nobody is reading by scrolling
 * anyway: they are searching, which works either way.
 *
 * A first page shorter than this is also certain to be the whole file, since a
 * page that is not the last is always VW_TEXT_PAGE bytes, and that many bytes
 * cannot decode to fewer characters than this.
 */
var VW_JSON_MAX = 1024 * 1024;

/*
 * The most a layout may come to, past which the file is shown as it came.
 *
 * VW_JSON_MAX bounds what goes in, and what comes out can be far more. Every line
 * is indented by its depth, so a file nested deep grows with the square of how
 * deep: forty kilobytes of brackets inside brackets, which JSON.parse accepts, came
 * to more characters than a string can hold, and the page opened on an error rather
 * than on the file. And bare numbers are two characters a line, so a megabyte of
 * them is five times the hundred thousand lines the cap was measured against.
 */
var VW_JSON_MAX_OUT = 4 * VW_JSON_MAX;
var VW_JSON_MAX_LINES = 150 * 1000;

/*
 * Lays a JSON document out over several lines, indented by depth. Answers null
 * if the text is not JSON, and the caller then shows the file as it is.
 *
 * Only the whitespace between tokens is rewritten; every value is copied
 * through exactly as it was written. That distinction is the whole point. The
 * obvious implementation, JSON.parse followed by JSON.stringify, is a rewrite
 * rather than a reformat: it rounds any number past 2^53 to a different number,
 * turns 1.0 into 1 and 1e5 into 100000, keeps only the last of a set of
 * duplicate keys, and moves keys that look like integers to the front of their
 * object. A viewer that quietly altered what a file said would be worse than
 * one that was hard to read.
 *
 * JSON.parse is still what decides whether the text is JSON. With the grammar
 * proved sound, the pass below only has to know whether it is inside a string.
 */
function vwFormatJson(text) {
  try {
    JSON.parse(text);
  } catch (e) {
    return null;
  }

  var pads = [""];
  function pad(depth) {
    while (pads.length <= depth) pads.push(pads[pads.length - 1] + VW_JSON_INDENT);
    return pads[depth];
  }

  var out = [];
  var n = text.length;
  var depth = 0;
  var i = 0;
  var size = n;
  var lines = 1;

  function newline() {
    var indent = pad(depth);
    out.push("\n", indent);
    size += 1 + indent.length;
    lines++;
  }

  // A container that has just opened and is still empty. Breaking the line is
  // put off until something turns up inside it, so that {} and [] stay whole.
  var fresh = false;
  function begin() {
    if (fresh) {
      newline();
      fresh = false;
    }
  }

  while (i < n) {
    if (size > VW_JSON_MAX_OUT || lines > VW_JSON_MAX_LINES) return null;
    var c = text.charAt(i);

    if (c === '"') {
      begin();
      var str = i;
      i++;
      while (i < n) {
        var s = text.charAt(i);
        i++;
        if (s === "\\") i++;      // whatever follows an escape is not the end
        else if (s === '"') break;
      }
      out.push(text.slice(str, i));
    } else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;                        // the spacing the file came with is dropped
    } else if (c === "{" || c === "[") {
      begin();
      out.push(c);
      depth++;
      fresh = true;
      i++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (fresh) fresh = false;
      else newline();
      out.push(c);
      i++;
    } else if (c === ",") {
      out.push(",");
      newline();
      i++;
    } else if (c === ":") {
      out.push(": ");
      size++;
      i++;
    } else {
      // A number, or true, false or null. In sound JSON it runs until the next
      // structural character, so it can be copied in one piece.
      begin();
      var lit = i;
      while (i < n && '{}[],: \t\n\r"'.indexOf(text.charAt(i)) < 0) i++;
      out.push(text.slice(lit, i));
    }
  }

  return out.join("");
}

/* Byte count as a short human size, for "showing the first N" notices. */
function vwFormatSize(bytes) {
  var mb = bytes / (1024 * 1024);
  if (mb < 1) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + " MB";
}

window.onerror = function (message) {
  vwError("Something went wrong while rendering", String(message));
};

/*
 * Simplified Chinese for the viewer pages.
 *
 * The pages are English in their markup and in what their scripts say, and the Kotlin side
 * has no way to hand a whole resource file across. So ViewerActivity puts the language it
 * is running in on the URL as lang=<code>, and this rewrites what the page shows: the text
 * already in the markup, and every node the viewers add afterwards, which is why it watches
 * the document rather than walking it once.
 *
 * The rewrite is a lookup, not a translation engine: a string is replaced only when it is a
 * key in the table below, or matches one of the patterns that cover the sentences a viewer
 * builds by joining words to numbers. Anything else stays as it is, so a message added to a
 * viewer later shows in English rather than in Chinese with an English clause in the middle.
 * Nothing here runs on a page opened in another language, which also leaves the browser
 * tests, which never pass lang, exactly as they were.
 */
(function () {
  var lang = (vwParams.get("lang") || "").toLowerCase();
  if (lang.indexOf("zh") !== 0) return;

  /* Whole strings, compared after their leading and trailing space is trimmed. */
  var ZH = {
    /* Page titles and the line a viewer shows while it works. */
    "PDF document": "PDF 文档",
    "Word document": "Word 文档",
    "Spreadsheet": "表格",
    "Presentation": "演示文稿",
    "Markdown": "Markdown",
    "Text": "文本",
    "Image": "图片",
    "Book": "电子书",
    "Document": "文档",
    "3D model": "3D 模型",
    "Unknown format": "未知格式",
    "Rendering document…": "正在渲染文档…",
    "Rendering…": "正在渲染…",
    "Rendering slides…": "正在渲染幻灯片…",
    "Rendering slides… ": "正在渲染幻灯片…",
    "Loading…": "正在加载…",
    "Loading spreadsheet…": "正在加载表格…",
    "Opening document…": "正在打开文档…",
    "Opening book…": "正在打开电子书…",
    "Opening model…": "正在打开模型…",

    /* Chrome: books, the text viewer, the card for a format with no viewer. */
    "Show more": "显示更多",
    "Contents": "目录",
    "Previous": "上一页",
    "Next": "下一页",
    "Close": "关闭",
    "Copy address": "复制地址",
    "This link leaves the book": "此链接会离开本书",
    "Gander opens no web address. Copy it to open it in a browser.":
      "Gander 不会打开任何网址。复制后可在浏览器中打开。",
    "Gander doesn't recognize this format": "Gander 无法识别此格式",
    "View as text": "按文本查看",
    "If it isn't text, you'll see random characters.": "如果不是文本，你只会看到乱码。",
    "Open in simple view": "以简易视图打开",
    "Shows the pages as pictures, without search, text selection or form entries.":
      "以图片形式显示页面，无法搜索、选择文字或填写表单。",

    /* The heading of a card that says why a document is not on the screen. */
    "Could not render this PDF": "无法渲染此 PDF",
    "Could not render this Word document": "无法渲染此 Word 文档",
    "Could not render this presentation": "无法渲染此演示文稿",
    "Could not render this Markdown file": "无法渲染此 Markdown 文件",
    "Could not open this document": "无法打开此文档",
    "Could not open this spreadsheet": "无法打开此表格",
    "Could not open this book": "无法打开此电子书",
    "Could not show this model": "无法显示此模型",
    "Could not display this image": "无法显示此图片",
    "Could not read this file": "无法读取此文件",
    "Could not read the rest of this file": "无法读取此文件的其余部分",
    "This PDF could not be read": "无法读取此 PDF",
    "This PDF needs a password": "此 PDF 需要密码",
    "This file is not a PDF that can be read": "此文件不是可读取的 PDF",
    "This book is locked": "本书已锁定",
    "This model is too large to show": "此模型太大，无法显示",
    "This model is empty": "此模型为空",
    "3D models cannot be shown on this phone": "此手机无法显示 3D 模型",
    "Something went wrong while rendering": "渲染时出现问题",
    "This page could not be drawn": "无法绘制此页面",
    "Not a page.": "不是页面。",
    "Its renderer stopped.": "其渲染器已停止。",

    /* And the sentence under that heading. */
    "This is not a Word document.": "这不是 Word 文档。",
    "This is not a Word document: it has no text inside it.": "这不是 Word 文档：其中没有文本。",
    "This Word document is damaged.": "此 Word 文档已损坏。",
    "This Word document is damaged: its table stream is missing.":
      "此 Word 文档已损坏：缺少表格流。",
    "This Word document is too large to open here.": "此 Word 文档太大，无法在此打开。",
    "This document is too large to open here.": "此文档太大，无法在此打开。",
    "This document is nested too deeply to read.": "此文档嵌套层级过深，无法读取。",
    "This is not an OpenDocument text document.": "这不是 OpenDocument 文本文档。",
    "This file has no document inside it.": "此文件内部没有文档。",
    "The file is empty.": "文件为空。",
    "The workbook has no sheets": "工作簿中没有工作表",
    "This document is protected by a password, and Gander cannot open password-protected Word documents.":
      "此文档受密码保护，Gander 无法打开加密的 Word 文档。",
    "This document is protected by a password, and Gander cannot open password-protected OpenDocument files.":
      "此文档受密码保护，Gander 无法打开加密的 OpenDocument 文件。",
    "It is not an EPUB, or the file is damaged.": "它不是 EPUB，或者文件已损坏。",
    "It is protected against copying (DRM), so only the app of the shop or library it came from can open it.":
      "它受复制保护（DRM），只有提供它的商店或图书馆的应用才能打开。",
    "One of the book's own files is not sound XML.": "本书的某个内部文件不是有效的 XML。",
    "This part of the book could not be read.": "本书的这一部分无法读取。",
    "The book lists no chapters.": "本书没有列出任何章节。",
    "The book does not say where its chapters are listed.": "本书未说明章节列表的位置。",
    "It may be damaged, or made in a way the simple view can't draw.":
      "它可能已损坏，或用简易视图无法绘制的方式制作。",
    "The simple view, which this phone gets for PDFs, can't open a PDF that needs one.":
      "此手机的 PDF 使用简易视图，无法打开需要密码的 PDF。",
    "Gander could not read the file it was given. Opening it again usually settles this.":
      "Gander 无法读取拿到的文件内容。重新打开通常就能解决。",
    "The phone ran out of graphics memory while reading it.": "读取时手机的显存不足。",
    "There are no triangles in it to draw.": "其中没有可绘制的三角形。",
    "This is a legacy Office format (.ppt). If you re-save it as .pptx, Gander can display it.":
      "这是旧版 Office 格式（.ppt）。如果另存为 .pptx，Gander 就能显示。",
    "This .pptx may use features the built-in renderer does not understand yet.":
      "此 .pptx 可能用到了内置渲染器尚不支持的功能。",
    "Updating Android System WebView and reopening the file will fix it.":
      "更新 Android System WebView 后重新打开文件即可解决。",
    "An update to Android System WebView can turn it back on.":
      "更新 Android System WebView 可以重新开启它。",
    "Gander draws them with WebGL, and Android System WebView has turned WebGL off on this phone, which it does when the phone's graphics driver is known to misbehave. An update to Android System WebView can turn it back on.":
      "Gander 用 WebGL 绘制它们，而此手机的 Android System WebView 已关闭 WebGL——手机的显卡驱动被判定有问题时就会这样。更新 Android System WebView 可以重新开启。",
    "It does not begin the way an STL file does: as text starting with the word solid, or as a binary header followed by a count of triangles.":
      "它的开头不像 STL 文件：既不是以单词 solid 开头的文本，也不是后接三角形数量的二进制头。",
    "It does not begin the way an OpenDocument, Rich Text or Word 97-2003 file does. If it was saved by an older Word, Word 2 say, Gander cannot read it; re-saving it in any of those three formats will help.":
      "它的开头不像 OpenDocument、RTF 或 Word 97-2003 文件。如果它由更早版本的 Word（比如 Word 2）保存，Gander 就无法读取；用这三种格式之一另存即可。",

    /* The pieces a viewer puts in the corner of a picture it cannot draw. */
    "A chart that cannot be shown here": "此处无法显示的图表",
    "A diagram that cannot be shown here": "此处无法显示的示意图",
    "A picture in a format that cannot be shown here": "格式不受支持、无法在此显示的图片",
    "A picture that cannot be shown here": "此处无法显示的图片",
    "A shape that cannot be shown here": "此处无法显示的形状",
    "A table that cannot be shown here": "此处无法显示的表格",
    "An object that cannot be shown here": "此处无法显示的对象"
  };

  /* Sentences a viewer joins words and numbers into, matched whole. */
  var ZH_PATTERNS = [
    [/^Android System WebView is too old to show (.+)$/, "Android System WebView 版本过低，无法显示$1"],
    [/^(.+) cannot be shown on this phone$/, "此手机无法显示$1"],
    [
      /^(.+) need the browser engine built into your phone to be version (\d+) or newer, and this one is (.+)\. On this phone that engine comes from the manufacturer and cannot be updated or replaced, so installing Android System WebView will not help\.$/,
      "$1 需要手机内置的浏览器引擎为 $2 或更高版本，而这台手机是 $3。此手机的该引擎由厂商提供，无法更新或替换，所以安装 Android System WebView 也没用。"
    ],
    [
      /^(.+) need a newer browser engine than the one built into your phone\. On this phone that engine comes from the manufacturer and cannot be updated or replaced, so installing Android System WebView will not help\.$/,
      "$1 需要比手机内置版本更新的浏览器引擎。此手机的该引擎由厂商提供，无法更新或替换，所以安装 Android System WebView 也没用。"
    ],
    [
      /^Gander opens (.+) using Android System WebView, the browser engine built into your phone\. (.+)$/,
      "Gander 使用手机内置的浏览器引擎 Android System WebView 打开$1。$2"
    ],
    [
      /^(.+) need version (\d+) or newer, and this one is (.+)\. Updating Android System WebView and reopening the file will fix it\.$/,
      "$1 需要 $2 或更高版本，而这台手机是 $3。更新 Android System WebView 后重新打开文件即可。"
    ],
    [
      /^Gander draws up to (.+) triangles on a phone with this much memory, and this model has (.+)\.$/,
      "这台手机的内存下，Gander 最多绘制 $1 个三角形，而这个模型有 $2 个。"
    ],
    [/^Showing the first (.+) of this file\.$/, "已显示此文件的前 $1。"],
    [
      /^The simple view shows the first (\d+) of this PDF's (\d+) pages\.$/,
      "简易视图只显示此 PDF 共 $2 页中的前 $1 页。"
    ],
    [/^Could not read the file \(HTTP (\d+)\)$/, "无法读取文件（HTTP $1）"],
    [/^The graphics driver refused a program: (.*)$/, "显卡驱动拒绝了一个程序：$1"],
    [/^The graphics driver refused a shader: (.*)$/, "显卡驱动拒绝了一个着色器：$1"],
    [
      /^It is either damaged or not a PDF at all, whatever it happens to be named\. Every other format Gander opens still works\.$/,
      "它要么已损坏，要么根本不是 PDF，无论文件名叫什么。Gander 支持的其他格式仍然正常。"
    ]
  ];

  /* 1.2 million reads as 120 万, in the figure a triangle count is given in. */
  function zhFigure(text) {
    return text.replace(/(\d+(?:\.\d+)?) million/, function (all, n) {
      return Math.round(Number(n) * 100) + " 万";
    });
  }

  function zhFor(text) {
    var trimmed = text.replace(/^\s+|\s+$/g, "");
    if (!trimmed) return null;
    if (Object.prototype.hasOwnProperty.call(ZH, trimmed)) {
      return text.replace(trimmed, ZH[trimmed]);
    }
    for (var i = 0; i < ZH_PATTERNS.length; i++) {
      var rule = ZH_PATTERNS[i];
      if (rule[0].test(trimmed)) {
        var said = zhFigure(trimmed.replace(rule[0], rule[1]));
        return text.replace(trimmed, said);
      }
    }
    return null;
  }

  /* Writing a node tells the observer about it, and it must not read that as a change. */
  var writing = false;

  function zhNode(node) {
    if (writing) return;
    var said = zhFor(node.nodeValue);
    if (said === null || said === node.nodeValue) return;
    writing = true;
    node.nodeValue = said;
    writing = false;
  }

  var ZH_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];

  function zhAttributes(el) {
    if (writing || !el.getAttribute) return;
    for (var i = 0; i < ZH_ATTRIBUTES.length; i++) {
      var name = ZH_ATTRIBUTES[i];
      var value = el.getAttribute(name);
      if (!value) continue;
      var said = zhFor(value);
      if (said === null || said === value) continue;
      writing = true;
      el.setAttribute(name, said);
      writing = false;
    }
  }

  function zhTree(root) {
    if (root.nodeType === 3) zhNode(root);
    else if (root.nodeType === 1) zhAttributes(root);
    if (!root.querySelectorAll) return;
    var texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (texts.nextNode()) zhNode(texts.currentNode);
    var withAttributes = root.querySelectorAll("[title],[aria-label],[placeholder],[alt]");
    for (var i = 0; i < withAttributes.length; i++) zhAttributes(withAttributes[i]);
  }

  document.documentElement.lang = "zh-Hans-CN";
  if (document.title) {
    var title = zhFor(document.title);
    if (title !== null) document.title = title;
  }
  zhTree(document.body || document.documentElement);

  if (typeof MutationObserver === "function") {
    new MutationObserver(function (records) {
      if (writing) return;
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === "characterData") {
          zhNode(record.target);
        } else {
          for (var j = 0; j < record.addedNodes.length; j++) zhTree(record.addedNodes[j]);
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
})();
