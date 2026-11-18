import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp } from '../../src/app.mjs';

export const formId = '20000000-0000-4000-8000-000000000001';
export const otherFormId = '20000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000001';
export const organizationId = '40000000-0000-4000-8000-000000000001';
export const responseId = index => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const attachment = (object, name = 'Документ.pdf') => ({ name, content: `public/${formId}/${object}` });
export const form = {
  id: formId,
  title: 'Сбор документов',
  schema: { pages: [{ elements: [
    { type: 'matrixdynamic', name: 'entries', detailElements: [{ type: 'organization', name: 'school' }] },
    { type: 'file', name: 'files' },
  ] }] },
};

async function listen(cleanup, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

export async function createArchiveFixture(cleanup, {
  savedForm = form, answers = [], disabled = false, storage = {},
  publicAppUrl = 'http://forms.test', employeeToken = 'employee',
} = {}) {
  const requests = [];
  const supabaseUrl = await listen(cleanup, async (req, res) => {
    const url = new URL(req.url, 'http://supabase.test');
    const json = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const request = { path: url.pathname, headers: req.headers };
    requests.push(request);
    if (req.headers.authorization !== `Bearer ${employeeToken}` || req.headers.apikey !== 'public-key') {
      return json({ message: 'Invalid authorization', code: '42501' }, 403);
    }
    if (url.pathname === '/rest/v1/forms') return json(url.searchParams.get('id') === `eq.${savedForm.id}` ? [savedForm] : []);
    if (url.pathname === '/rest/v1/education_organizations') {
      return json([{ id: organizationId, alias: 'ГБОУ', number: '373', is_archived: true }]);
    }
    if (url.pathname === '/rest/v1/rpc/export_form_responses') {
      let body = '';
      for await (const chunk of req) body += chunk;
      request.body = JSON.parse(body);
      const ids = request.body.p_response_ids;
      return json(answers.filter(answer => request.body.p_form_id === savedForm.id && (!ids || ids.includes(answer.id))));
    }
    const object = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?survey-files\/public\/[^/]+\/(.+)$/)?.[1];
    const file = object && storage[decodeURIComponent(object)];
    if (!file) return json({ message: 'File not found' }, 404);
    if (typeof file === 'function') return file(res);
    res.end(file);
  });
  const app = createApp({
    pool: { query: async sql => {
      assert.match(sql, /public\.profiles/);
      return { rows: [{ id: userId, is_disabled: disabled }] };
    } },
    supabase: { storage: { from: () => ({}) }, auth: { getUser: async token => ({
      data: { user: token === employeeToken ? { id: userId } : null }, error: null,
    }) } },
    env: {
      PUBLIC_APP_URL: publicAppUrl,
      ONLYOFFICE_SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLIC_URL: 'https://api.forms.test',
      SUPABASE_ANON_KEY: 'public-key',
    },
  });
  const base = `${await listen(cleanup, app)}/api/office`;
  return {
    base,
    requests,
    prepare: (body = {}, token = 'employee', id = formId) => fetch(`${base}/forms/${id}/response-archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    download: (ticket, cookie, options) => fetch(`${base}/response-archives/${ticket}`, {
      headers: cookie ? { Cookie: cookie } : {}, ...options,
    }),
  };
}
