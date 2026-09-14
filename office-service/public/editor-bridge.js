(function () {
  'use strict';
  let started = false;
  const notify = (type, data) => parent.postMessage({ type, data }, location.origin);
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'office-config' || started) return;
    started = true;
    const {config, apiJsUrl} = event.data.data;
    const script = document.createElement('script');
    script.src = apiJsUrl;
    script.onerror = () => notify('office-error', 'Редактор ONLYOFFICE временно недоступен.');
    script.onload = () => {
      try {
        const editor = new window.DocsAPI.DocEditor('editor', {...config,events:{
          onAppReady: () => notify('office-loaded'),
          onDocumentReady: () => notify('office-ready'),
          onError: e => notify('office-error', e.data?.errorDescription || 'Ошибка ONLYOFFICE'),
          onDocumentStateChange: e => notify('office-state', Boolean(e.data)),
        }});
        window.addEventListener('pagehide', () => editor.destroyEditor(), {once:true});
      } catch {notify('office-error', 'Не удалось открыть ONLYOFFICE');}
    };
    document.head.appendChild(script);
  });
  notify('office-frame-ready');
})();
