/* Premium custom dropdown — progressive enhancement over a native
   <select data-premium>. The native select stays in the DOM (hidden)
   as the source of truth: existing code keeps reading/writing
   select.value and listening for 'change' unmodified. This only
   replaces the POPUP's rendering, which a native <select> cannot be
   CSS-styled to match the theme. */
(function (win, doc) {
  'use strict';

  /* Distinguishes one enhanced select's option ids from another's, which
     aria-activedescendant needs to be unambiguous on a page carrying
     City + Main Location + Sub Location at once. */
  enhance.seq = 0;

  function enhance(sel) {
    sel.style.position = 'absolute';
    sel.style.opacity = '0';
    sel.style.pointerEvents = 'none';
    sel.tabIndex = -1;

    var wrap = doc.createElement('div');
    wrap.className = 'pms';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pms-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    /* The native select is hidden but still labelled; carry that label to
       the control the user actually reaches. */
    var lbl = sel.getAttribute('aria-label') ||
      (sel.id && doc.querySelector('label[for="' + sel.id + '"]') || {}).textContent;
    if (lbl) trigger.setAttribute('aria-label', String(lbl).trim());
    wrap.appendChild(trigger);

    var list = doc.createElement('div');
    list.className = 'pms-list';
    list.hidden = true;
    wrap.appendChild(list);

    function label() {
      var o = sel.options[sel.selectedIndex];
      trigger.textContent = o ? o.text : '';
      trigger.classList.toggle('is-placeholder', !sel.value);
    }

    /* ── type-to-filter ──────────────────────────────────────────
       A city can carry 80+ main locations (each canonical name plus every
       alias) and a main area thousands of sub areas, which is more than a
       scroll list can serve. The filter is deliberately generic — it reads
       the <option> text, so it needs no knowledge of the location engine,
       and because getMainAreaOptions() already emits each ALIAS as its own
       option, typing "AIT" or "ایل" matches without any alias-specific code
       here. Canonical identity is untouched: the option's value is still
       whatever the page put there. */
    var searchWrap = null, searchInput = null, optionsHost = null;
    /* Counted over REAL options — the placeholder is not something anyone
       searches for, so a main location offering three sub locations was
       being judged a four-item list and denied a search box. Above three
       real choices the box earns its space; at or below it would only
       clutter a list the eye already takes in at once. */
    var SEARCH_THRESHOLD = 3;
    var uid = 'pms' + (++enhance.seq);

    function normalize(v) {
      return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /* A word boundary is anything that is not a letter or digit, in Latin
       OR Arabic script. Using this instead of a literal space is what lets
       "iqbal" rank as a word-start inside "Nasheman-e-Iqbal" and "block"
       inside "Block-B", rather than being demoted to a mid-word substring. */
    function isBoundary(ch) {
      return !/[a-z0-9؀-ۿݐ-ݿ]/.test(ch);
    }

    function startsAWord(t, q) {
      var from = 0, at;
      while ((at = t.indexOf(q, from)) > -1) {
        if (at === 0 || isBoundary(t.charAt(at - 1))) return true;
        from = at + 1;
      }
      return false;
    }

    /* Every whitespace-separated term must appear, so "dha ph" narrows the
       way a person expects. Ranking prefers a whole-value prefix, then a
       word-start, then any substring — "D" puts "DHA Defence" above
       "Divine Gardens" only when it genuinely starts the value. */
    function score(text, terms) {
      var t = normalize(text);
      if (!terms.length) return 1;
      var total = 0;
      for (var i = 0; i < terms.length; i++) {
        var q = terms[i];
        var at = t.indexOf(q);
        if (at === -1) return 0;
        if (t === q) total += 100;
        else if (at === 0) total += 60;
        else if (startsAWord(t, q)) total += 40;
        else total += 10;
      }
      return total;
    }

    function esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* Marks what the typing actually matched, so a long society name shows
       WHY it is in the list. Ranges are merged before wrapping so two
       overlapping terms ("dha", "ha") cannot produce nested <mark>. */
    function highlight(text, terms) {
      if (!terms.length) return esc(text);
      var lower = String(text).toLowerCase();
      var ranges = [];
      terms.forEach(function (q) {
        var from = 0, at;
        while ((at = lower.indexOf(q, from)) > -1) {
          ranges.push([at, at + q.length]);
          from = at + q.length;
        }
      });
      if (!ranges.length) return esc(text);
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [ranges[0].slice()];
      for (var i = 1; i < ranges.length; i++) {
        var last = merged[merged.length - 1];
        if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
        else merged.push(ranges[i].slice());
      }
      var out = '', cursor = 0;
      merged.forEach(function (r) {
        out += esc(text.slice(cursor, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>';
        cursor = r[1];
      });
      return out + esc(text.slice(cursor));
    }

    function renderOptions(query) {
      var terms = normalize(query).split(' ').filter(Boolean);
      optionsHost.innerHTML = '';

      var rows = [];
      Array.prototype.forEach.call(sel.options, function (o) {
        /* The placeholder ("Select city") is never a search result. */
        var isPlaceholder = !o.value;
        if (isPlaceholder && terms.length) return;
        var s = terms.length ? score(o.text, terms) : 1;
        if (!s) return;
        rows.push({ o: o, s: s, placeholder: isPlaceholder });
      });

      /* Stable within a score band: equal-ranked options keep the order the
         Location Data Bank gave them, so the list never reshuffles
         arbitrarily between keystrokes. */
      if (terms.length) rows.sort(function (a, b) { return b.s - a.s; });

      if (!rows.length) {
        var none = doc.createElement('div');
        none.className = 'pms-none';
        none.textContent = 'No match for “' + query + '”';
        optionsHost.appendChild(none);
        setActive(-1);
        return;
      }

      rows.forEach(function (r, i) {
        var item = doc.createElement('div');
        item.className = 'pms-opt' + (r.o.value === sel.value ? ' is-selected' : '');
        item.id = uid + '-o' + i;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', r.o.value === sel.value ? 'true' : 'false');
        item.innerHTML = highlight(r.o.text, terms);
        item.setAttribute('data-value', r.o.value);
        if (r.o.disabled) item.classList.add('is-disabled');
        optionsHost.appendChild(item);
      });

      /* With a query, the top match is pre-armed so Enter takes it without
         an arrow press. Without one, the current selection is where the
         arrows start from. */
      setActive(terms.length ? 0 : Math.max(0, indexOfSelected()));
    }

    /* ── active option (keyboard) ─────────────────────────────── */
    var activeIndex = -1;

    function items() {
      return optionsHost ? optionsHost.querySelectorAll('.pms-opt:not(.is-disabled)') : [];
    }

    function indexOfSelected() {
      var all = items();
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-value') === sel.value) return i;
      }
      return -1;
    }

    function setActive(i) {
      var all = items();
      Array.prototype.forEach.call(all, function (el) { el.classList.remove('is-active'); });
      activeIndex = (all.length && i >= 0) ? Math.min(i, all.length - 1) : -1;
      if (activeIndex < 0) {
        if (searchInput) searchInput.removeAttribute('aria-activedescendant');
        return;
      }
      var el = all[activeIndex];
      el.classList.add('is-active');
      if (searchInput) searchInput.setAttribute('aria-activedescendant', el.id);
      /* Keeps the arrow-driven cursor inside the scrolling panel without
         scrolling the page behind it. */
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    function move(delta) {
      var all = items();
      if (!all.length) return;
      var next = activeIndex < 0
        ? (delta > 0 ? 0 : all.length - 1)
        : (activeIndex + delta + all.length) % all.length;
      setActive(next);
    }

    function commitActive() {
      var all = items();
      var el = (activeIndex > -1 && all[activeIndex]) || all[0];
      if (el) el.click();
    }

    function buildList() {
      list.innerHTML = '';
      searchWrap = null; searchInput = null;

      var realOptions = 0;
      Array.prototype.forEach.call(sel.options, function (o) { if (o.value) realOptions++; });

      if (realOptions > SEARCH_THRESHOLD) {
        searchWrap = doc.createElement('div');
        searchWrap.className = 'pms-search';
        searchInput = doc.createElement('input');
        searchInput.type = 'text';
        searchInput.setAttribute('placeholder', 'Type to search…');
        searchInput.setAttribute('aria-label', 'Search options');
        searchInput.setAttribute('role', 'combobox');
        searchInput.setAttribute('aria-expanded', 'true');
        searchInput.setAttribute('aria-autocomplete', 'list');
        searchInput.setAttribute('aria-controls', uid + '-opts');
        searchInput.autocomplete = 'off';
        searchWrap.appendChild(searchInput);
        list.appendChild(searchWrap);

        searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
        searchInput.addEventListener('input', function () { renderOptions(searchInput.value); });
      }

      optionsHost = doc.createElement('div');
      optionsHost.className = 'pms-opts';
      optionsHost.id = uid + '-opts';
      optionsHost.setAttribute('role', 'listbox');
      list.appendChild(optionsHost);

      /* Hovering re-arms the keyboard cursor, so mouse and keys never
         disagree about which row Enter would take. */
      optionsHost.addEventListener('mousemove', function (e) {
        var it = e.target.closest('.pms-opt:not(.is-disabled)');
        if (!it) return;
        var all = items();
        for (var i = 0; i < all.length; i++) if (all[i] === it) { setActive(i); return; }
      });

      renderOptions('');
    }

    /* One handler for the whole control: the keys must work whether focus
       sits in the search box or — on a short list that has none — on the
       trigger itself. */
    wrap.addEventListener('keydown', function (e) {
      if (list.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          if (doc.activeElement === trigger) { e.preventDefault(); open(); }
        }
        return;
      }
      if (e.key === 'ArrowDown')      { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); }
      else if (e.key === 'Home')      { e.preventDefault(); setActive(0); }
      else if (e.key === 'End')       { e.preventDefault(); setActive(items().length - 1); }
      else if (e.key === 'Enter')     { e.preventDefault(); commitActive(); }
      else if (e.key === 'Escape')    { e.stopPropagation(); close(); trigger.focus(); }
      else if (e.key === 'Tab')       { close(); }
    });

    function close() {
      list.hidden = true;
      activeIndex = -1;
      trigger.setAttribute('aria-expanded', 'false');
    }
    function open() {
      if (sel.disabled) return;
      buildList();
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      /* Focus only on a pointer-capable viewport: on a phone this would
         raise the keyboard over the very list the user wants to scan. */
      if (searchInput && win.matchMedia && win.matchMedia('(min-width: 768px)').matches) {
        searchInput.focus();
      }
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      list.hidden ? open() : close();
    });
    list.addEventListener('click', function (e) {
      var item = e.target.closest('.pms-opt');
      if (!item || item.classList.contains('is-disabled')) return;
      sel.value = item.getAttribute('data-value');
      /* Setting .value is not a DOM mutation (no attribute/childList
         change), so the MutationObserver below never fires for it —
         update the trigger label explicitly here. */
      label();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    });
    doc.addEventListener('click', close);

    /* Options are populated/mutated by home.js after this runs
       (cities/mains/subs load asynchronously) — MutationObserver keeps
       the trigger label and disabled state in sync automatically. */
    new MutationObserver(function () {
      label();
      trigger.disabled = sel.disabled;
    }).observe(sel, { attributes: true, childList: true, subtree: true, attributeFilter: ['disabled'] });

    label();
    trigger.disabled = sel.disabled;
  }

  function boot() {
    Array.prototype.forEach.call(doc.querySelectorAll('select[data-premium]'), enhance);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
