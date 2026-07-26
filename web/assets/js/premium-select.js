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

    function buildList() {
      list.innerHTML = '';
      Array.prototype.forEach.call(sel.options, function (o) {
        var item = doc.createElement('div');
        item.className = 'pms-opt' + (o.value === sel.value ? ' is-selected' : '');
        item.textContent = o.text;
        item.setAttribute('data-value', o.value);
        if (o.disabled) item.classList.add('is-disabled');
        list.appendChild(item);
      });
    }

    function close() { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    function open() {
      if (sel.disabled) return;
      buildList();
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
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
