/* ctxfold — live profiler for the landing page.
 *
 * Drives the existing .ruler and .report components from real profile()
 * output. If this script fails to load, or the bundle is missing, the
 * static markup in index.html stays on screen unchanged.
 *
 * The report is produced by colourising renderProfile() rather than
 * re-rendering from the object, so the page and the CLI can never drift.
 */
(function () {
  "use strict";

  var cf = window.ctxfold;
  if (!cf || typeof cf.profile !== "function") return;

  var input = document.getElementById("pf-input");
  var report = document.getElementById("pf-report");
  var bar = document.getElementById("pf-bar");
  var marks = document.getElementById("pf-marks");
  var note = document.getElementById("pf-note");
  var status = document.getElementById("pf-status");
  var wrap = document.getElementById("pf-tryit");
  if (!input || !report || !bar || !marks || !note) return;

  /* ---------------------------------------------------------------- utils */

  // The markup shipped in index.html is both the no-JS fallback and the
  // designed empty state. Snapshot it at load so clearing the box restores
  // it, rather than leaving a stale result under an empty textarea.
  var INITIAL = {
    bar: bar.innerHTML,
    marks: marks.innerHTML,
    note: note.innerHTML,
    report: report.innerHTML,
    status: status ? status.textContent : "",
  };

  function reset() {
    bar.innerHTML = INITIAL.bar;
    marks.innerHTML = INITIAL.marks;
    note.innerHTML = INITIAL.note;
    report.innerHTML = INITIAL.report;
    if (status) status.textContent = INITIAL.status;
  }

  // Composition labels and affixes echo the user's own data
  // (e.g. `constant columns  46%  c, d`). Escape before any innerHTML.
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function pct(x) {
    return Math.round(x * 100) + "%";
  }

  function commas(n) {
    return n.toLocaleString("en-US");
  }

  /* ------------------------------------------------------------- the bar */

  // Segment count and labels vary by format: JSON and CSV give four,
  // logs give two. Cycle the existing palette instead of the fixed
  // .seg-keys/.seg-syn/.seg-val/.seg-ws classes, which are JSON-only.
  var PALETTE = [
    "var(--marker)",
    "var(--marker-soft)",
    "var(--paper)",
    "var(--blue-soft)",
  ];

  function renderRuler(p) {
    var comp = p.composition || [];

    if (!comp.length) {
      bar.innerHTML =
        '<div style="width:100%;background:var(--grid)">no composition</div>';
      marks.innerHTML = "";
      note.textContent = p.detail || "nothing to break down";
      return;
    }

    bar.innerHTML = comp
      .map(function (c, i) {
        var w = (c.pct * 100).toFixed(4) + "%";
        var fill = PALETTE[i % PALETTE.length];
        // Below ~6% there is no room for the number inside the segment.
        var label = c.pct >= 0.06 ? pct(c.pct) : "";
        return (
          '<div style="width:' +
          w +
          ";background:" +
          fill +
          '" title="' +
          esc(c.label + " — " + pct(c.pct) + " — " + c.note) +
          '">' +
          label +
          "</div>"
        );
      })
      .join("");

    marks.innerHTML = comp
      .map(function (c) {
        return (
          '<span style="width:' +
          (c.pct * 100).toFixed(4) +
          '%" title="' +
          esc(c.note) +
          '">' +
          esc(c.label) +
          "</span>"
        );
      })
      .join("");

    var n = esc(p.detail || p.format) + " — " + commas(p.chars) + " characters";
    if (p.compositionNormalized) n += " (normalised to 100%)";
    note.innerHTML = n;
  }

  /* ---------------------------------------------------------- the report */

  // Section-aware colouring. Percentages mean different things in the
  // composition block (.y) and the foldable block (.b), so the pass
  // tracks which block it is inside rather than matching blindly.
  function colorize(text) {
    var section = "head";

    return text
      .split("\n")
      .map(function (line) {
        var safe = esc(line);

        if (/^where the characters go/.test(line)) section = "comp";
        else if (/^foldable \(/.test(line)) section = "fold";
        else if (/^why nothing folded/.test(line)) section = "why";
        else if (/^verdict:/.test(line)) section = "verdict";

        if (section === "head") {
          return safe.replace(
            /(\(estimated;[^)]*\))/,
            '<span class="g">$1</span>'
          );
        }

        if (section === "comp") {
          return safe.replace(/(\d+%)/, '<span class="y">$1</span>');
        }

        if (section === "fold") {
          safe = safe.replace(/(-\d+%)/, '<span class="b">$1</span>');
          // The published CSV negative result — flag it, do not bury it.
          return safe.replace(
            /(pipeline-only[^<]*)$/,
            '<span class="y">$1</span>'
          );
        }

        if (section === "why") {
          return safe.replace(/^(\s+- .*)$/, '<span class="y">$1</span>');
        }

        if (section === "verdict") {
          var m = safe.match(/^verdict:\s*(.*)$/);
          if (!m) return safe;
          var cls = /^fold it/.test(m[1]) ? "g" : "y";
          return 'verdict: <span class="' + cls + '">' + m[1] + "</span>";
        }

        return safe;
      })
      .join("\n");
  }

  /* ------------------------------------------------------------ the loop */

  function render(text) {
    if (!text.trim()) {
      reset();
      return;
    }

    var t0 = performance.now();
    var p;
    try {
      p = cf.profile(text);
    } catch (e) {
      // profile() is not supposed to throw on any input. If it does,
      // that is a bug worth seeing rather than swallowing.
      report.innerHTML =
        '<span class="y">profiler error: ' + esc(e.message) + "</span>";
      status.textContent = "unexpected error — please open an issue";
      return;
    }
    var ms = Math.round(performance.now() - t0);

    renderRuler(p);
    report.innerHTML = colorize(cf.renderProfile(p));
    status.textContent =
      commas(text.length) + " characters profiled in " + ms + "ms — in your browser, nothing uploaded";
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      render(input.value);
    }, 250);
  }

  input.addEventListener("input", schedule);

  /* --------------------------------------------------------- input paths */

  var SAMPLES = {
    json: function () {
      var rows = [];
      for (var i = 0; i < 120; i++) {
        rows.push({
          id: 4800 + i,
          name: "user" + i,
          email: "user" + i + "@example.com",
          role: i % 7 === 0 ? "admin" : "member",
          city: "Madison",
          plan: "pro",
        });
      }
      return JSON.stringify(rows, null, 2);
    },
    logs: function () {
      var out = [];
      for (var i = 0; i < 120; i++) {
        out.push(
          "2026-06-26T07:26:" +
            String(i % 60).padStart(2, "0") +
            ".730Z ERROR [billing] reqId=" +
            (1898747 + i) +
            " token validated latency_ms=" +
            (700 + (i % 300)) +
            " status=500"
        );
      }
      return out.join("\n");
    },
    csv: function () {
      var out = ["id,name,city,plan"];
      for (var i = 0; i < 120; i++) {
        out.push([4800 + i, "user" + i, "madison", "pro"].join(","));
      }
      return out.join("\n");
    },
  };

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-sample]"),
    function (btn) {
      btn.addEventListener("click", function () {
        var make = SAMPLES[btn.getAttribute("data-sample")];
        if (!make) return;
        input.value = make();
        render(input.value);
      });
    }
  );

  var clear = document.getElementById("pf-clear");
  if (clear) {
    clear.addEventListener("click", function () {
      input.value = "";
      render("");
    });
  }

  var file = document.getElementById("pf-file");
  function readFile(f) {
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      input.value = String(r.result);
      render(input.value);
    };
    r.readAsText(f);
  }

  if (file) {
    file.addEventListener("change", function () {
      readFile(file.files && file.files[0]);
    });
  }

  if (wrap) {
    ["dragenter", "dragover"].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        e.preventDefault();
        wrap.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        e.preventDefault();
        wrap.classList.remove("drag");
      });
    });
    wrap.addEventListener("drop", function (e) {
      readFile(e.dataTransfer && e.dataTransfer.files[0]);
    });
  }
})();
