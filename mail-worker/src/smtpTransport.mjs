import { lookup } from "node:dns/promises";
import { BlockList, connect, isIP } from "node:net";
import nodemailer from "nodemailer";
import { createTransportOptions, decryptPassword } from "./config.mjs";

const excludedV4 = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
]) {
  excludedV4.addSubnet(address, bits);
}

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const excludedV6 = new BlockList();
for (const [address, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  excludedV6.addSubnet(address, bits, "ipv6");
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !excludedV4.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !excludedV6.check(address, "ipv6");
}

function getApprovedSocket({ host, port, connectionTimeout }, callback, { resolve, allowedPrivateHosts }) {
  const normalized = host.toLowerCase().replace(/\.+$/, "");
  let socket;
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (error) {
      socket?.destroy();
      callback(error);
    } else {
      socket.removeListener("error", finish);
      callback(null, { connection: socket });
    }
  };
  const timer = setTimeout(() => {
    finish(Object.assign(new Error("SMTP connection timed out"), { code: "ETIMEDOUT" }));
  }, connectionTimeout);
  const family = isIP(normalized);
  const resolveHost = family ? Promise.resolve([{ address: normalized, family }]) : resolve(host, { all: true });
  resolveHost.then(addresses => {
    if (finished) return;
    const approved = addresses.filter(({ address }) =>
      isIP(address) && (allowedPrivateHosts.has(normalized) || isPublicAddress(address)));
    if (approved.length === 0) {
      finish(Object.assign(new Error("SMTP server has no approved destination"), { code: "EDNS" }));
      return;
    }
    // Pin resolution for the actual connection while retaining the configured
    // hostname in Nodemailer for TLS SNI and peer certificate verification.
    socket = connect({
      host: family ? normalized : host,
      port,
      autoSelectFamily: true,
      lookup(_hostname, options, done) {
        const [{ address, family: approvedFamily }] = approved;
        if (options.all) done(null, approved);
        else done(null, address, approvedFamily);
      },
    });
    socket.once("error", finish);
    socket.once("connect", () => finish());
  }).catch(finish);
}

// Retain authenticated connections across polling batches. Sender/reply-to are
// message options; only a change to the SMTP connection requires a new pool.
export function createSmtpTransportManager({
  encryptionKey, concurrency, privateHosts = "", resolve = lookup, createTransport = nodemailer.createTransport,
}) {
  const allowedPrivateHosts = new Set(privateHosts.split(",")
    .map(host => host.trim().toLowerCase().replace(/\.+$/, "")).filter(Boolean));
  let transporter = null;
  let connectionKey = null;
  const close = () => {
    transporter?.close();
    transporter = null;
    connectionKey = null;
  };
  return {
    close,
    get(settings) {
      if (!settings?.enabled) { close(); return null; }
      const nextKey = JSON.stringify([
        settings.host, settings.port, settings.ssl_mode, settings.username, settings.password_encrypted,
        settings.allow_invalid_certificate === true,
      ]);
      if (nextKey !== connectionKey) {
        close();
        const password = decryptPassword(settings.password_encrypted, encryptionKey, settings);
        transporter = createTransport({
          ...createTransportOptions(settings, password),
          pool: true,
          getSocket: (options, callback) => getApprovedSocket(options, callback, { resolve, allowedPrivateHosts }),
          maxConnections: concurrency,
          maxMessages: 100,
        });
        connectionKey = nextKey;
      }
      return transporter;
    },
  };
}
