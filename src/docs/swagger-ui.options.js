// Custom Swagger UI options: a "Sections" jump menu + a "Back to top" button.
// Injected via swagger-ui-express setup() (customCss + customJsStr).

const customCss = `
  #sw-menu { position: fixed; top: 14px; right: 18px; z-index: 9999; font-family: sans-serif; }
  #sw-menu-btn {
    background: #4990e2; color: #fff; border: none; padding: 9px 15px;
    border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
    box-shadow: 0 2px 6px rgba(0,0,0,.2);
  }
  #sw-menu-btn:hover { background: #357ABD; }
  #sw-menu-list {
    display: none; position: absolute; right: 0; margin-top: 6px; background: #fff;
    border: 1px solid #e3e3e3; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.15);
    max-height: 72vh; overflow-y: auto; min-width: 230px; padding: 6px;
  }
  #sw-menu-list.open { display: block; }
  #sw-menu-list a {
    display: block; padding: 8px 12px; color: #3b4151; text-decoration: none;
    border-radius: 6px; font-size: 13px; white-space: nowrap;
  }
  #sw-menu-list a:hover { background: #f0f6ff; color: #4990e2; }
  #backToTop {
    position: fixed; bottom: 28px; right: 28px; z-index: 9999; display: none;
    width: 46px; height: 46px; border: none; border-radius: 50%; background: #4990e2;
    color: #fff; font-size: 22px; line-height: 46px; cursor: pointer;
    box-shadow: 0 3px 10px rgba(0,0,0,.25);
  }
  #backToTop:hover { background: #357ABD; }
`;

const customJsStr = `
  (function () {
    function build() {
      var tags = document.querySelectorAll('.opblock-tag');
      if (!tags.length) { return setTimeout(build, 400); }
      if (document.getElementById('sw-menu')) { return; }

      var menu = document.createElement('div'); menu.id = 'sw-menu';
      var btn = document.createElement('button'); btn.id = 'sw-menu-btn'; btn.type = 'button';
      btn.textContent = '☰ Sections';
      var list = document.createElement('div'); list.id = 'sw-menu-list';

      tags.forEach(function (t) {
        var src = t.querySelector('a span') || t.querySelector('a') || t;
        var label = ((src.textContent || '').trim().split('\\n')[0]) || '';
        if (!label) { return; }
        var a = document.createElement('a'); a.href = '#'; a.textContent = label;
        a.addEventListener('click', function (e) {
          e.preventDefault();
          t.scrollIntoView({ behavior: 'smooth', block: 'start' });
          list.classList.remove('open');
        });
        list.appendChild(a);
      });

      btn.addEventListener('click', function (e) { e.stopPropagation(); list.classList.toggle('open'); });
      document.addEventListener('click', function (e) { if (!menu.contains(e.target)) { list.classList.remove('open'); } });
      menu.appendChild(btn); menu.appendChild(list); document.body.appendChild(menu);

      var top = document.createElement('button'); top.id = 'backToTop'; top.type = 'button';
      top.textContent = '↑'; top.title = 'Back to top';
      top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      document.body.appendChild(top);
      window.addEventListener('scroll', function () {
        top.style.display = (window.scrollY > 300) ? 'block' : 'none';
      });
    }
    if (document.readyState !== 'loading') { build(); }
    else { document.addEventListener('DOMContentLoaded', build); }
  })();
`;

export const swaggerUiOptions = {
  customSiteTitle: 'LiveChat API Docs',
  customCss,
  customJsStr,
  swaggerOptions: {
    persistAuthorization: true, // keep your token across page reloads
  },
};
