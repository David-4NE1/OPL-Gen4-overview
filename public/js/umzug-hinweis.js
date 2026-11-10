/*
 * umzug-hinweis.js – Sperrhinweis nach dem Umzug der OPL auf den
 * Pre-Series Development Server.
 *
 * Legt sich ueber die ganze Seite (Login, Board, Roadmap) und verweist auf die
 * neue Adresse. Admins koennen die alte OPL danach nur lesend weiter oeffnen.
 * Durchgesetzt wird die Sperre im Worker (OPL_GESPERRT): Aenderungen lehnt er
 * fuer alle ab, Lesen erlaubt er nur noch Admins (und dem Lese-Token).
 */
(function () {
  'use strict';

  var ZIEL = 'http://100.64.0.52:8000/#/opl';

  var CSS = [
    '.umzug{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'padding:16px;background:rgba(15,23,32,.82);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;}',
    '.umzug[hidden]{display:none;}',
    '.umzug__karte{width:min(640px,100%);max-height:100%;overflow:auto;background:#fff;color:#1d2733;border-radius:14px;',
    'box-shadow:0 20px 60px rgba(0,0,0,.35);padding:32px 32px 26px;text-align:center;}',
    '.umzug__icon{font-size:44px;line-height:1;margin-bottom:10px;}',
    '.umzug h1{font-size:23px;margin:0 0 4px;}',
    '.umzug h2{font-size:16px;font-weight:600;color:#5b6775;margin:0 0 18px;}',
    '.umzug p{font-size:15px;line-height:1.5;margin:0 0 6px;}',
    '.umzug p.umzug__en{color:#5b6775;margin-bottom:18px;}',
    '.umzug__link{display:inline-block;margin:6px 0 20px;padding:12px 22px;border-radius:10px;background:#c8102e;color:#fff;',
    'font-weight:600;font-size:16px;text-decoration:none;word-break:break-all;}',
    '.umzug__link:hover{background:#a50d26;}',
    '.umzug__hinweis{text-align:left;background:#f3f5f8;border-left:4px solid #c8102e;border-radius:8px;padding:12px 14px;}',
    '.umzug__hinweis p{font-size:14px;margin:0 0 4px;}',
    '.umzug__hinweis p.umzug__en{margin:0;}',
    '.umzug__admin{margin-top:16px;font-size:13px;}',
    '.umzug__admin button{background:none;border:0;padding:4px;color:#5b6775;text-decoration:underline;cursor:pointer;font:inherit;}',
    '.umzug__admin button.umzug__weiter{color:#fff;background:#4a5563;text-decoration:none;border-radius:8px;padding:8px 14px;}',
    '.umzug-banner{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147482000;max-width:calc(100% - 24px);',
    'background:#c8102e;color:#fff;border-radius:10px;padding:8px 14px;font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;',
    'box-shadow:0 6px 20px rgba(0,0,0,.25);text-align:center;}',
    '.umzug-banner a{color:#fff;}',
    // Schreibfunktionen fuer den Admin-Lesezugriff ausblenden (Server lehnt sie ohnehin ab)
    'body.opl-gesperrt .nur-bearbeiten,body.opl-gesperrt [data-act="reset"],body.opl-gesperrt [data-act="admin"],',
    'body.opl-gesperrt #adminMenuDivider,body.opl-gesperrt #btnRelease{display:none !important;}',
    '@media (prefers-color-scheme:dark){.umzug__karte{background:#1c2530;color:#e7edf3;}',
    '.umzug h2,.umzug p.umzug__en,.umzug__admin button{color:#a9b6c3;}.umzug__hinweis{background:#26313d;}}',
    '@media (max-width:480px){.umzug__karte{padding:24px 18px 20px;}.umzug h1{font-size:20px;}}'
  ].join('');

  var box = null;
  var frei = false; // Admin hat "weiter (nur lesen)" gewaehlt

  function aufbauen() {
    if (box) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.classList.add('opl-gesperrt');

    box = document.createElement('div');
    box.id = 'umzugHinweis';
    box.className = 'umzug';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'umzugTitel');
    box.innerHTML =
      '<div class="umzug__karte">' +
        '<div class="umzug__icon" aria-hidden="true">📦</div>' +
        '<h1 id="umzugTitel">Die OPL ist umgezogen</h1>' +
        '<h2 lang="en">The OPL has moved</h2>' +
        '<p>Ab sofort wird die OPL auf dem Pre-Series Development Server weitergeführt. Diese Version ist gesperrt und wird nicht mehr aktualisiert.</p>' +
        '<p class="umzug__en" lang="en">From now on, the OPL is maintained on the Pre-Series Development server. This version is locked and will no longer be updated.</p>' +
        '<a class="umzug__link" href="' + ZIEL + '">' + ZIEL + '</a>' +
        '<div class="umzug__hinweis">' +
          '<p><strong>Hinweis:</strong> Benutzername und Startpasswort solltest du von <strong>David Rybinski (david.rybinski@neura-robotics.com)</strong> bekommen haben. Bei Problemen gerne melden.</p>' +
          '<p class="umzug__en" lang="en"><strong>Note:</strong> You should have received your username and initial password from <strong>David Rybinski (david.rybinski@neura-robotics.com)</strong>. If you have any problems, please get in touch.</p>' +
        '</div>' +
        '<div class="umzug__admin" id="umzugAdmin"></div>' +
      '</div>';
    document.body.appendChild(box);
  }

  // Seite unter dem Hinweis sperren bzw. wieder freigeben
  function sperren(an) {
    box.hidden = !an;
    document.documentElement.style.overflow = an ? 'hidden' : '';
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === box || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.classList.contains('umzug-banner')) return;
      if (an) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  function adminZeile(html, klick) {
    var z = document.getElementById('umzugAdmin');
    z.innerHTML = html;
    var b = z.querySelector('button');
    if (b) b.addEventListener('click', klick);
  }

  function banner() {
    if (document.querySelector('.umzug-banner')) return;
    var b = document.createElement('div');
    b.className = 'umzug-banner';
    b.innerHTML = '🔒 Archiv, nur lesen / read-only – aktuelle OPL: <a href="' + ZIEL + '">' + ZIEL + '</a>';
    document.body.appendChild(b);
  }

  function adminFrei() {
    frei = true;
    sperren(false);
    banner();
  }

  // Zustand nach Anmeldung: Admins duerfen weiter (nur lesend), alle anderen nicht
  function angemeldet(istAdmin) {
    aufbauen();
    if (frei && istAdmin) return;
    if (istAdmin) {
      adminZeile('<button type="button" class="umzug__weiter">Als Admin weiter (nur lesen)</button>', adminFrei);
      sperren(true);
    } else {
      adminZeile('', null);
      sperren(true);
    }
  }

  function start() {
    aufbauen();
    sperren(true);
    var hatLogin = !!document.getElementById('loginForm');
    fetch('/api/auth', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
      if (a && a.authenticated) { angemeldet(!!a.isAdmin); return; }
      if (hatLogin) {
        // Nicht angemeldet: Admin kann sich ueber das Login darunter anmelden
        adminZeile('<button type="button">Admin-Anmeldung (Archiv, nur lesen)</button>', function () {
          sperren(false);
          var f = document.getElementById('loginEmail');
          if (f) f.focus();
        });
      }
    }).catch(function () { /* Hinweis bleibt */ });
  }

  window.OPLUmzug = { angemeldet: angemeldet };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
