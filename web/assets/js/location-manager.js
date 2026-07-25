/* MakanOnRent — Location Data Bank Manager (page controller).
   Drives location-manager.html: province → city, paste → parse →
   editable preview → publish. All parsing/persistence lives in
   location-bank.js; this file is UI only. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, LOC = win.MOR_LOC, BANK = win.MOR_BANK, UI = win.MOR_UI;
  var $ = function (id) { return doc.getElementById(id); };

  /* Working set: [{ main, subs: [] }] — the editable preview model. */
  var groups = [];

  var IC = {
    up:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    del:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  /* ── STEP 1 · province → city ───────────────────────────── */
  var provSel = $('lmProvince'), citySel = $('lmCity');

  LOC.getChildren('pk', { types: ['province'] })
    .sort(function (a, b) { return a.name.localeCompare(b.name); })
    .forEach(function (p) { provSel.appendChild(new Option(p.name, p.id)); });

  provSel.addEventListener('change', function () {
    citySel.innerHTML = '';
    if (!provSel.value) {
      citySel.appendChild(new Option('Select province first', ''));
      citySel.disabled = true;
      refreshSummary();
      return;
    }
    citySel.appendChild(new Option('Select city', ''));
    LOC.getChildren(provSel.value, { types: ['city'] })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (c) { citySel.appendChild(new Option(c.name, c.id)); });
    citySel.disabled = false;
    refreshSummary();
  });

  citySel.addEventListener('change', function () { refreshSummary(); renderBank(); renderPending(); });

  /* ── STEP 2 · parse ─────────────────────────────────────── */
  $('lmParse').addEventListener('click', function () {
    groups = BANK.parse($('lmPaste').value);
    renderPreview();
    refreshSummary();
    msg(groups.length ? '' : 'Nothing recognised in that text — check the format above.', groups.length ? '' : 'is-error');
  });

  $('lmClear').addEventListener('click', function () {
    $('lmPaste').value = '';
    groups = [];
    renderPreview();
    refreshSummary();
    msg('');
  });

  /* ── STEP 3 · editable preview ──────────────────────────── */
  function esc(v) { return UI.esc(v); }

  function renderPreview() {
    var host = $('lmPreview');
    if (!groups.length) {
      host.innerHTML = '<div class="lm-empty">Nothing parsed yet — paste your areas above and press <b>Parse &amp; Preview</b>.</div>';
      return;
    }

    host.innerHTML = groups.map(function (g, gi) {
      var subs = g.subs.map(function (s, si) {
        return '<div class="lm-sub">' +
          '<span class="lm-branch" aria-hidden="true">' + (si === g.subs.length - 1 ? '└──' : '├──') + '</span>' +
          '<input class="lm-name" data-g="' + gi + '" data-s="' + si + '" value="' + esc(s) + '" aria-label="Sub area name" />' +
          '<button class="lm-ico" type="button" data-act="sub-up" data-g="' + gi + '" data-s="' + si + '"' + (si === 0 ? ' disabled' : '') + ' aria-label="Move up">' + IC.up + '</button>' +
          '<button class="lm-ico" type="button" data-act="sub-down" data-g="' + gi + '" data-s="' + si + '"' + (si === g.subs.length - 1 ? ' disabled' : '') + ' aria-label="Move down">' + IC.down + '</button>' +
          '<button class="lm-ico is-danger" type="button" data-act="sub-del" data-g="' + gi + '" data-s="' + si + '" aria-label="Delete sub area">' + IC.del + '</button>' +
        '</div>';
      }).join('');

      return '<div class="lm-group">' +
        '<div class="lm-main">' +
          '<span class="lm-tag">Main Area</span>' +
          '<input class="lm-name" data-g="' + gi + '" data-main="1" value="' + esc(g.main) + '" aria-label="Main area name" />' +
          '<span class="lm-count">' + g.subs.length + ' sub</span>' +
          '<button class="lm-ico is-danger" type="button" data-act="main-del" data-g="' + gi + '" aria-label="Delete main area">' + IC.del + '</button>' +
        '</div>' +
        '<div class="lm-subs">' + subs +
          '<button class="lm-addsub" type="button" data-act="sub-add" data-g="' + gi + '">' + IC.plus + 'Add sub area</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* Delegated — the preview re-renders constantly, so nothing binds
     to an individual row. */
  $('lmPreview').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var gi = Number(b.getAttribute('data-g'));
    var si = Number(b.getAttribute('data-s'));
    var act = b.getAttribute('data-act');

    if (act === 'main-del') groups.splice(gi, 1);
    else if (act === 'sub-del') groups[gi].subs.splice(si, 1);
    else if (act === 'sub-add') groups[gi].subs.push('New sub area');
    else if (act === 'sub-up') swap(groups[gi].subs, si, si - 1);
    else if (act === 'sub-down') swap(groups[gi].subs, si, si + 1);

    renderPreview();
    refreshSummary();
  });

  /* Live rename — kept in the model as the admin types. */
  $('lmPreview').addEventListener('input', function (e) {
    var el = e.target.closest('.lm-name');
    if (!el) return;
    var gi = Number(el.getAttribute('data-g'));
    if (el.hasAttribute('data-main')) groups[gi].main = el.value;
    else groups[gi].subs[Number(el.getAttribute('data-s'))] = el.value;
  });

  function swap(arr, a, b) {
    if (b < 0 || b >= arr.length) return;
    var t = arr[a]; arr[a] = arr[b]; arr[b] = t;
  }

  /* ── STEP 4 · publish ───────────────────────────────────── */
  function cleanGroups() {
    return groups
      .map(function (g) {
        return {
          main: String(g.main || '').trim(),
          subs: g.subs.map(function (s) { return String(s || '').trim(); }).filter(Boolean)
        };
      })
      .filter(function (g) { return g.main; });
  }

  function refreshSummary() {
    var clean = cleanGroups();
    var subs = clean.reduce(function (n, g) { return n + g.subs.length; }, 0);
    var ready = !!citySel.value && clean.length > 0;

    $('lmSummary').textContent = clean.length
      ? clean.length + ' main area' + (clean.length === 1 ? '' : 's') + ' · ' + subs + ' sub area' + (subs === 1 ? '' : 's')
      : 'Nothing to publish';
    $('lmSummarySub').textContent = !clean.length ? 'Parse some areas first.'
      : (!citySel.value ? 'Choose a city in step 1.'
        : 'Will publish under ' + citySel.options[citySel.selectedIndex].text + '.');
    $('lmPublish').disabled = !ready;
  }

  function msg(text, cls) {
    var el = $('lmMsg');
    el.textContent = text || '';
    el.className = 'lm-msg' + (cls ? ' ' + cls : '');
  }

  $('lmPublish').addEventListener('click', function () {
    var clean = cleanGroups();
    var res = BANK.publish(citySel.value, clean);
    if (!res.ok) { msg(res.error, 'is-error'); return; }

    var subs = clean.reduce(function (n, g) { return n + g.subs.length; }, 0);
    msg('Published — ' + clean.length + ' main area' + (clean.length === 1 ? '' : 's') +
        ' and ' + subs + ' sub area' + (subs === 1 ? '' : 's') + ' are now searchable across the site.', 'is-ok');

    groups = [];
    $('lmPaste').value = '';
    renderPreview();
    refreshSummary();
    renderBank();
  });

  /* ── published bank list ────────────────────────────────── */
  function renderBank() {
    var bank = BANK.read();
    var rows = bank.entries.filter(function (e) {
      return !citySel.value || e.cityId === citySel.value;
    });

    $('lmBankCount').textContent = bank.entries.length
      ? bank.entries.length + ' main area' + (bank.entries.length === 1 ? '' : 's') + ' published' +
        (citySel.value ? ' · showing ' + rows.length + ' in this city' : '')
      : 'Empty — nothing published yet.';

    $('lmBank').innerHTML = rows.length
      ? rows.map(function (e) {
          return '<div class="lm-bank-row">' +
            '<div class="lm-grow"><b>' + esc(e.main) + '</b><br>' +
            '<span>' + esc(e.cityName || '') + ' · ' + (e.subs || []).length + ' sub areas</span></div>' +
            '<button class="lm-mini is-no" type="button" data-unpub="' + esc(e.main) + '" data-city="' + esc(e.cityId) + '">Unpublish</button>' +
          '</div>';
        }).join('')
      : '';
  }

  $('lmBank').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unpub]');
    if (!b) return;
    BANK.unpublish(b.getAttribute('data-city'), b.getAttribute('data-unpub'));
    renderBank();
    msg('Unpublished. The area and its sub areas no longer appear in search.', 'is-ok');
  });

  /* ── pending user suggestions (sub areas only) ──────────── */
  function renderPending() {
    var pending = LOC.getPendingSuggestions();
    $('lmPendingCard').hidden = !pending.length;
    if (!pending.length) return;

    $('lmPending').innerHTML = pending.map(function (p) {
      return '<div class="lm-pending-row">' +
        '<div class="lm-grow"><b>' + esc(p.name) + '</b>' +
        '<div class="lm-crumb">' + esc(p.breadcrumb.slice(1).join(' › ')) + '</div></div>' +
        '<button class="lm-mini is-ok" type="button" data-approve="' + esc(p.id) + '">Approve</button>' +
        '<button class="lm-mini is-no" type="button" data-reject="' + esc(p.id) + '">Reject</button>' +
      '</div>';
    }).join('');
  }

  $('lmPending').addEventListener('click', function (e) {
    var ok = e.target.closest('[data-approve]');
    var no = e.target.closest('[data-reject]');
    if (ok) { LOC.approveLocation(ok.getAttribute('data-approve')); msg('Suggestion approved — it is now live in search.', 'is-ok'); }
    else if (no) { LOC.rejectLocation(no.getAttribute('data-reject')); msg('Suggestion rejected.', 'is-ok'); }
    else return;
    renderPending();
  });

  /* ── boot ───────────────────────────────────────────────── */
  $('yr').textContent = new Date().getFullYear();
  renderPreview();
  refreshSummary();
  renderBank();
  renderPending();
})(window, document);
