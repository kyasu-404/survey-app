import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { createSmtpTransportManager } from '../src/smtpTransport.mjs';

const key = randomBytes(32);
function encrypted(password) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  return `v1:${iv.toString('base64')}:${Buffer.concat([cipher.update(password), cipher.final(), cipher.getAuthTag()]).toString('base64')}`;
}
const settings = { enabled: true, host: '127.0.0.1', port: 25, ssl_mode: 'none', username: 'test', password_encrypted: encrypted('test') };

test('SMTP pools survive polling batches and sender changes; connection changes and disabling close them', () => {
  const transports = [], options = [];
  const manager = createSmtpTransportManager({ encryptionKey: key.toString('base64'), concurrency: 3, createTransport: config => {
    options.push(config);
    const transport = { closed: false, close() { this.closed = true; } };
    transports.push(transport);
    return transport;
  } });
  const first = manager.get(settings);
  assert.equal(manager.get({ ...settings }), first);
  assert.equal(manager.get({ ...settings, from_name: 'Changed sender' }), first);
  assert.equal(options[0].pool, true);
  assert.equal(options[0].maxConnections, 3);
  assert.equal(options[0].maxMessages, 100);
  assert.equal(options[0].tls.rejectUnauthorized, true);
  const second = manager.get({ ...settings, password_encrypted: encrypted('rotated') });
  assert.notEqual(second, first);
  assert.equal(first.closed, true);
  assert.equal(options[1].auth.pass, 'rotated');
  assert.equal(manager.get({ ...settings, enabled: false }), null);
  assert.equal(second.closed, true);
  const third = manager.get(settings);
  manager.close();
  assert.equal(third.closed, true);
});

test('successive mail batches reuse a single authenticated TCP connection', async t => {
  let connections = 0, authentications = 0, messages = 0;
  const sockets = new Set();
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 fixture ESMTP\r\n');
    let buffer = '', data = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') { data = false; messages++; socket.write('250 queued\r\n'); }
        } else if (line.startsWith('EHLO')) socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) { authentications++; socket.write('235 authenticated\r\n'); }
        else if (line === 'DATA') { data = true; socket.write('354 send message\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const manager = createSmtpTransportManager({ encryptionKey: key.toString('base64'), concurrency: 1 });
  t.after(async () => { manager.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const localSettings = { ...settings, port: server.address().port };
  for (let batch = 0; batch < 3; batch++) {
    const transporter = manager.get(localSettings);
    await transporter.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: `Batch ${batch}`, text: 'Local SMTP fixture' });
  }
  assert.equal(messages, 3);
  assert.equal(connections, 1);
  assert.equal(authentications, 1);
});
