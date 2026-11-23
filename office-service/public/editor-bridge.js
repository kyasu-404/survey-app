(function () {
  'use strict';
  let started = false;
  const configuredOrigin = typeof SURVEY_APP_ORIGIN === 'string' && SURVEY_APP_ORIGIN ? SURVEY_APP_ORIGIN : location.origin;
  const allowedParentOrigins = new Set([configuredOrigin, location.origin]);
  let targetParentOrigin = configuredOrigin;
  const notify = (type, data) => parent.postMessage({ type, data }, targetParentOrigin);
  window.addEventListener('message', function (event) {
    if (!allowedParentOrigins.has(event.origin) || event.source !== parent || event.data?.type !== 'office-config' || started) return;
    targetParentOrigin = event.origin;
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
  for (const origin of allowedParentOrigins) {
    parent.postMessage({ type: 'office-frame-ready', data: undefined }, origin);
  }
})();
