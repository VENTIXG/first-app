// The 3-D Studio is a built app (studio/dist, `npm run build:studio`). When a
// page is served without that build (a plain copy of the repository) or opened
// from file://, links to it would lead nowhere: replace them with an
// explanation instead of a dead route. The desktop app always contains it.
(function () {
  var links = document.querySelectorAll('a[href$="studio/dist/index.html"]');
  if (!links.length) return;
  function show(text) {
    var box = document.getElementById('studio-unavailable');
    if (!box) {
      box = document.createElement('p');
      box.id = 'studio-unavailable';
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:560px;' +
        'margin:0;padding:12px 16px;border-radius:10px;background:#14202c;color:#eef3f8;font:14px/1.45 system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:1000';
      document.body.appendChild(box);
    }
    box.textContent = text;
    clearTimeout(show.timer);
    show.timer = setTimeout(function () { box.remove(); }, 8000);
  }
  function disable(reason) {
    links.forEach(function (a) {
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('data-unavailable', 'true');
      a.title = reason;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        show(reason);
      });
    });
  }
  var reason = 'The 3-D Studio is not built in this copy. Run "npm start" (or "npm run build:studio" ' +
    'and serve the folder over HTTP), or use the desktop app.';
  if (location.protocol === 'file:') { disable(reason); return; }
  fetch(links[0].getAttribute('href'), { method: 'HEAD', cache: 'no-store' })
    .then(function (r) { if (!r.ok) disable(reason); })
    .catch(function () { disable(reason); });
})();
