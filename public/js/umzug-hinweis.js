/*
 * umzug-hinweis.js – Sperrhinweis nach dem Umzug der OPL auf den internen Server.
 *
 * Legt sich ueber die ganze Seite (Board, Login, Roadmap) und verweist auf die
 * neue Adresse. Die Schreibsperre selbst setzt der Worker durch (OPL_GESPERRT).
 */
(function () {
  'use strict';

  var ZIEL = 'http://100.64.0.52:8000/#/opl';

  var CSS = [
    '.umzug{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'padding:16px;background:rgba(15,23,32,.82);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;}',
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
    '@media (prefers-color-scheme:dark){.umzug__karte{background:#1c2530;color:#e7edf3;}',
    '.umzug h2,.umzug p.umzug__en{color:#a9b6c3;}.umzug__hinweis{background:#26313d;}}',
    '@media (max-width:480px){.umzug__karte{padding:24px 18px 20px;}.umzug h1{font-size:20px;}}'
  ].join('');

  function zeigen() {
    if (document.getElementById('umzugHinweis')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement('div');
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
        '<p>Ab sofort wird die OPL auf dem internen Server weitergeführt. Diese Version ist gesperrt und wird nicht mehr aktualisiert.</p>' +
        '<p class="umzug__en" lang="en">From now on, the OPL is maintained on the internal server. This version is locked and will no longer be updated.</p>' +
        '<a class="umzug__link" href="' + ZIEL + '">' + ZIEL + '</a>' +
        '<div class="umzug__hinweis">' +
          '<p><strong>Hinweis:</strong> Benutzername und Startpasswort solltest du von David Rybinski bekommen haben. Bei Problemen gerne melden.</p>' +
          '<p class="umzug__en" lang="en"><strong>Note:</strong> You should have received your username and initial password from David Rybinski. If you have any problems, please get in touch.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);
    // Darunterliegende Seite nicht mehr bedienbar/scrollbar
    document.documentElement.style.overflow = 'hidden';
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el !== box && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') el.setAttribute('inert', '');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zeigen);
  else zeigen();
})();
