/* ══════════════════════════════════════════════════════════════
   MakanOnRent — Smart Location Search (reusable component)
   ------------------------------------------------------------------
   One autocomplete UI, mounted onto any `.loc-wrap` markup:

     <div class="loc-wrap">
       <div class="control loc-field">
         <svg>…pin…</svg>
         <input type="text" id="…" autocomplete="off"
                role="combobox" aria-expanded="false" aria-autocomplete="list">
         <button type="button" class="loc-clear" hidden aria-label="Clear">&times;</button>
       </div>
       <div class="loc-panel" role="listbox" hidden></div>
     </div>

   MOR_LOC_SEARCH.mount(inputEl, { getScope, onSelect, placeholder })
   Every page listed in the Phase 6 brief consumes this same mount
   function against the same MOR_LOC data — no page has its own
   autocomplete logic.
   ══════════════════════════════════════════════════════════════ */
(function (win, doc) {
  'use strict';

  var LOC = win.MOR_LOC;
  var UI = win.MOR_UI;
  var esc = (UI && UI.esc) || function (v) { return String(v == null ? '' : v); };

  var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

  function mount(input, opts) {
    opts = opts || {};
    var wrap = input.closest('.loc-wrap');
    var panel = wrap.querySelector('.loc-panel');
    var clearBtn = wrap.querySelector('.loc-clear');

    var currentItems = [];
    var activeIndex = -1;
    var selected = null;
    /* Set after a Main Area is chosen so the very next list shows that
       area's Sub Areas — the City → Main Area → Sub Area flow, inside
       the existing single field (no new UI). Cleared on any typing. */
    var drillParent = null;

    function itemHTML(node, idx) {
      var crumb = node.breadcrumb.slice(1);
      return '<div class="loc-item" role="option" data-idx="' + idx + '">' +
        '<span class="loc-pin" aria-hidden="true">' + PIN + '</span>' +
        '<span class="loc-text"><b>' + esc(node.label) + '</b>' +
        (crumb.length ? '<span class="loc-crumb">' + crumb.map(esc).join(' › ') + '</span>' : '') +
        '</span></div>';
    }
    function sectionHTML(label, items, offset) {
      if (!items.length) return '';
      return '<div class="loc-section-label">' + esc(label) + '</div>' +
        items.map(function (n, i) { return itemHTML(n, offset + i); }).join('');
    }
    function emptyHTML(msg, offerSuggest) {
      return '<div class="loc-empty">' + esc(msg) +
        (offerSuggest
          ? '<button type="button" class="loc-suggest" data-suggest>' + PLUS + 'Suggest New Location</button>'
          : '') +
        '</div>';
    }

    function open() { panel.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    /* Empty field. With a city selected we list that city's Main Areas
       (step 2 of the flow); otherwise the usual recent + popular. */
    function showIdle() {
      var scopeId = opts.getScope ? opts.getScope() : null;
      var scope = scopeId ? LOC.getById(scopeId) : null;

      if (scope && scope.type === 'city') {
        var mains = LOC.getMainAreas(scope.id).map(LOC.decorate);
        if (mains.length) {
          currentItems = mains;
          panel.innerHTML = sectionHTML('Areas in ' + scope.name, mains, 0);
          open();
          return;
        }
      }

      var recent = LOC.getRecent(), popular = LOC.getPopular();
      currentItems = recent.concat(popular);
      panel.innerHTML = currentItems.length
        ? sectionHTML('Recent', recent, 0) + sectionHTML('Popular', popular, recent.length)
        : emptyHTML('Start typing a city, society or area.');
      open();
    }

    /* Sub Areas of the Main Area just picked (step 3 of the flow). */
    function showDrill(node) {
      var subs = LOC.getSubAreas(node.id).map(LOC.decorate);
      if (!subs.length) { close(); return false; }
      drillParent = node;
      currentItems = subs;
      activeIndex = -1;
      panel.innerHTML = sectionHTML('Sub areas in ' + node.name, subs, 0);
      open();
      return true;
    }

    function showResults(q) {
      /* Typing inside a drilled-in Main Area stays inside it. */
      var scope = drillParent ? drillParent.id : (opts.getScope ? opts.getScope() : null);
      currentItems = LOC.search(q, { scopeId: scope, types: opts.types || null });
      panel.innerHTML = currentItems.length
        ? currentItems.map(itemHTML).join('')
        : emptyHTML('No location found for “' + esc(q) + '”.', true);
      open();
    }

    function highlight() {
      var els = panel.querySelectorAll('.loc-item');
      els.forEach(function (el, i) { el.classList.toggle('is-active', i === activeIndex); });
      var el = els[activeIndex];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function pick(node) {
      selected = node;
      input.value = node.label;
      clearBtn.hidden = false;
      LOC.addRecent(node.id);
      if (opts.onSelect) opts.onSelect(node);

      /* A Main Area is already a valid selection; if it has Sub Areas
         we offer them as the next step instead of closing, so the
         admin-published hierarchy is actually walkable. */
      var raw = LOC.getById(node.id);
      var isMain = raw && LOC.MAIN_AREA_TYPES.indexOf(raw.type) > -1;
      if (isMain && !opts.types && showDrill(raw)) return;

      drillParent = null;
      close();
    }

    /* One delegated listener — survives every re-render. */
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-suggest]')) { openSuggestDialog(input.value.trim()); return; }
      var it = e.target.closest('.loc-item');
      if (!it) return;
      var node = currentItems[Number(it.getAttribute('data-idx'))];
      if (node) pick(node);
    });

    /* ── Suggest New Location — the one path that grows the tree
       from outside the fixture. Creates a real MOR_LOC node with
       status:'pending'; it becomes selectable everywhere the moment
       an admin calls MOR_LOC.approveLocation() — no other code
       changes. Reuses this same component, mounted a second time,
       to let the owner search for the parent location. */
    var suggestDlg = null;
    function openSuggestDialog(prefillName) {
      if (!suggestDlg) suggestDlg = buildSuggestDialog();
      close(); // the field's own panel
      suggestDlg.reset(prefillName);
      suggestDlg.dlg.open();
    }

    function buildSuggestDialog() {
      var dlg = UI.buildDialog((input.id || 'loc') + '-suggest',
        '<div class="modal-ic" aria-hidden="true">' + PLUS + '</div>' +
        '<h3>Suggest a Sub Area</h3>' +
        '<p>Can’t find your block or street? Tell us which area it sits in and our team will add it after a quick check.</p>' +
        '<form class="modal-form loc-suggest-form" novalidate>' +
          '<div class="loc-suggest-field">' +
            '<label>Sub area name</label>' +
            '<div class="control"><input type="text" data-f="name" placeholder="e.g. Block K, Street 7" autocomplete="off" required /></div>' +
          '</div>' +
          '<div class="loc-suggest-field">' +
            '<label>Which main area is it in?</label>' +
            '<div class="loc-wrap">' +
              '<div class="control loc-field">' + PIN +
                '<input type="text" data-f="parent" autocomplete="off" placeholder="Search the main area…" role="combobox" aria-expanded="false" aria-autocomplete="list" />' +
                '<button type="button" class="loc-clear" hidden aria-label="Clear">&times;</button>' +
              '</div>' +
              '<div class="loc-panel" role="listbox" hidden></div>' +
            '</div>' +
          '</div>' +
          '<div class="loc-suggest-field">' +
            '<label>Note <span class="loc-suggest-hint">(optional)</span></label>' +
            '<textarea class="loc-note" data-f="note" rows="2" placeholder="Anything that helps us find it"></textarea>' +
          '</div>' +
          '<p class="form-msg" role="status" aria-live="polite"></p>' +
          '<button class="btn-gold" type="submit">Submit for Review</button>' +
        '</form>');
      dlg.el.setAttribute('aria-label', 'Suggest a new location');

      var form = dlg.el.querySelector('form');
      var nameEl = form.querySelector('[data-f="name"]');
      var noteEl = form.querySelector('[data-f="note"]');
      var msg = form.querySelector('.form-msg');
      var parentNode = null;
      /* types restricts this picker to Main Areas — users may suggest
         Sub Areas only, never a new Main Area (enforced again in
         MOR_BANK.suggestSubArea, so the UI is not the only guard). */
      var parentPicker = mount(form.querySelector('[data-f="parent"]'), {
        types: LOC.MAIN_AREA_TYPES,
        onSelect: function (node) { parentNode = node; }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = nameEl.value.trim();
        if (!name) { msg.textContent = 'Please enter a sub area name.'; msg.className = 'form-msg is-error'; nameEl.focus(); return; }
        if (!parentNode) { msg.textContent = 'Please search and pick the main area it belongs to.'; msg.className = 'form-msg is-error'; return; }

        var res = (win.MOR_BANK && win.MOR_BANK.suggestSubArea)
          ? win.MOR_BANK.suggestSubArea({ name: name, parentId: parentNode.id, note: noteEl.value.trim() })
          : { ok: false, error: 'Suggestions are unavailable right now.' };

        if (!res.ok) { msg.textContent = res.error; msg.className = 'form-msg is-error'; return; }
        msg.textContent = 'Thanks — submitted for review.';
        msg.className = 'form-msg is-ok';
        setTimeout(dlg.close, 1200);
      });

      return {
        dlg: dlg,
        reset: function (prefillName) {
          form.reset();
          nameEl.value = prefillName || '';
          parentPicker.clear();
          parentNode = null;
          msg.textContent = ''; msg.className = 'form-msg';
        }
      };
    }

    input.addEventListener('input', function () {
      var v = input.value;
      clearBtn.hidden = !v;
      if (selected && v !== selected.label) {
        selected = null;
        drillParent = null;
        if (opts.onSelect) opts.onSelect(null);
      }
      var q = v.trim();
      activeIndex = -1;
      if (!q) showIdle(); else showResults(q);
    });

    input.addEventListener('focus', function () {
      if (!input.value.trim()) showIdle();
    });

    input.addEventListener('keydown', function (e) {
      if (panel.hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); input.value.trim() ? showResults(input.value.trim()) : showIdle(); }
        return;
      }
      var max = currentItems.length - 1;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(max, activeIndex + 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); highlight(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var node = currentItems[activeIndex > -1 ? activeIndex : 0];
        if (node) pick(node);
      } else if (e.key === 'Escape') { close(); }
    });

    doc.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });

    clearBtn.addEventListener('click', function () {
      input.value = ''; clearBtn.hidden = true; selected = null;
      if (opts.onSelect) opts.onSelect(null);
      showIdle(); input.focus();
    });

    if (opts.placeholder) input.placeholder = opts.placeholder;

    return {
      setValue: function (node) {
        selected = node;
        input.value = node ? node.label : '';
        clearBtn.hidden = !node;
      },
      clear: function () { input.value = ''; clearBtn.hidden = true; selected = null; }
    };
  }

  win.MOR_LOC_SEARCH = { mount: mount };
})(window, document);
