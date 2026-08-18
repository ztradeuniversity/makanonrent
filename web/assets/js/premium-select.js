/* Premium custom dropdown — progressive enhancement over a native
   <select data-premium>. The native select stays in the DOM (hidden)
   as the source of truth: existing code keeps reading/writing
   select.value and listening for 'change' unmodified. This only
   replaces the POPUP's rendering, which a native <select> cannot be
   CSS-styled to match the theme. */
(function (win, doc) {
  'use strict';

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
    /* Low enough that a real sub-area list (a main area commonly carries
       dozens) always gets a search box, high enough that a 3-4 item list
       is not cluttered by one. */
    var SEARCH_THRESHOLD = 5;

    function normalize(v) {
      return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
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
        else if (t.indexOf(' ' + q) > -1) total += 40;
        else total += 10;
      }
      return total;
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

      if (terms.length) rows.sort(function (a, b) { return b.s - a.s; });

      if (!rows.length) {
        var none = doc.createElement('div');
        none.className = 'pms-none';
        none.textContent = 'No match for “' + query + '”';
        optionsHost.appendChild(none);
        return;
      }

      rows.forEach(function (r) {
        var item = doc.createElement('div');
        item.className = 'pms-opt' + (r.o.value === sel.value ? ' is-selected' : '');
        item.textContent = r.o.text;
        item.setAttribute('data-value', r.o.value);
        if (r.o.disabled) item.classList.add('is-disabled');
        optionsHost.appendChild(item);
      });
    }

    function buildList() {
      list.innerHTML = '';
      searchWrap = null; searchInput = null;

      if (sel.options.length > SEARCH_THRESHOLD) {
        searchWrap = doc.createElement('div');
        searchWrap.className = 'pms-search';
        searchInput = doc.createElement('input');
        searchInput.type = 'text';
        searchInput.setAttribute('placeholder', 'Type to search…');
        searchInput.setAttribute('aria-label', 'Search options');
        searchInput.autocomplete = 'off';
        searchWrap.appendChild(searchInput);
        list.appendChild(searchWrap);

        searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
        searchInput.addEventListener('input', function () { renderOptions(searchInput.value); });
        searchInput.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.focus(); return; }
          if (e.key === 'Enter') {
            e.preventDefault();
            var first = optionsHost.querySelector('.pms-opt:not(.is-disabled)');
            if (first) first.click();
          }
        });
      }

      optionsHost = doc.createElement('div');
      optionsHost.className = 'pms-opts';
      list.appendChild(optionsHost);

      renderOptions('');
    }

    function close() { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
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
