/*
 * WhiteRock chat bubble. Paste ONE line into any web page, just before </body>:
 *
 *   <script src="https://applications-2026-kohl.vercel.app/chat-bubble.js" data-ws="uk" data-src="website" defer></script>
 *
 *   data-ws     the country chat to open (uk, canada, ...). It must be switched on in the portal.
 *   data-src    where these visitors came from (website, instagram, flyer, ...), used in the portal's reports.
 *   data-label  optional: the words on the button (default "Chat with an adviser").
 */
(function () {
  var tag = document.currentScript || document.querySelector('script[src*="chat-bubble.js"]');
  if (!tag || document.getElementById('wr-chat-root')) return;
  var origin = new URL(tag.src, location.href).origin;
  var ws = (tag.getAttribute('data-ws') || 'uk').toLowerCase();
  var src = tag.getAttribute('data-src') || 'website';
  var label = tag.getAttribute('data-label') || 'Chat with an adviser';
  var NAVY = '#0d1f4d';

  var root = document.createElement('div');
  root.id = 'wr-chat-root';
  root.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

  var chatIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var closeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', 'false');
  btn.style.cssText = 'display:flex;align-items:center;gap:10px;border:0;cursor:pointer;background:' + NAVY + ';color:#fff;border-radius:999px;padding:14px 20px;font:600 15px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 30px rgba(13,31,77,.35)';
  function paintButton(open) {
    btn.innerHTML = (open ? closeIcon : chatIcon) + '<span>' + (open ? 'Close' : label.replace(/</g, '&lt;')) + '</span>';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  paintButton(false);

  var panel = document.createElement('div');
  panel.style.cssText = 'display:none;position:absolute;right:0;bottom:64px;width:min(400px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(13,31,77,.35);border:1px solid rgba(13,31,77,.12)';
  var frame = null;

  function open() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'Chat with a WhiteRock adviser';
      frame.allow = 'clipboard-write';
      frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
      frame.src = origin + '/hello/' + encodeURIComponent(ws) + '?embed=1&src=' + encodeURIComponent(src);
      panel.appendChild(frame);
    }
    panel.style.display = 'block';
    paintButton(true);
  }
  function close() { panel.style.display = 'none'; paintButton(false); }
  btn.addEventListener('click', function () { (panel.style.display === 'block' ? close : open)(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.style.display === 'block') close(); });

  root.appendChild(panel);
  root.appendChild(btn);
  document.body.appendChild(root);
})();
