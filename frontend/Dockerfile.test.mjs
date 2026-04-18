import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
const nginxConfig = readFileSync(new URL("./nginx.conf", import.meta.url), "utf8");

function readHeader(config, headerName) {
  const escapedHeaderName = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = config.match(new RegExp(`add_header\\s+${escapedHeaderName}\\s+"([^"]+)"\\s+always;`, "i"));
  return match?.[1];
}

function readCspDirectives(policy) {
  return new Map(
    policy
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => Boolean(name))
      .map(([name, ...values]) => [name, values]),
  );
}

function assertCspDirectiveIncludes(directives, name, ...requiredValues) {
  const values = directives.get(name);

  assert.ok(values, `CSP should include ${name}`);
  for (const value of requiredValues) {
    assert.ok(values.includes(value), `CSP ${name} should include ${value}`);
  }
}

test("Dockerfile builds a production image on Node 20 and serves static assets", () => {
  assert.match(dockerfile, /FROM node:20(?:\.\d+)?-alpine AS build/i);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /FROM nginx:/i);
  assert.doesNotMatch(dockerfile, /npm run dev/);
});

test("production nginx sends browser hardening security headers", () => {
  const contentSecurityPolicy = readHeader(nginxConfig, "Content-Security-Policy");

  assert.ok(contentSecurityPolicy, "Content-Security-Policy header should be configured with always");
  const directives = readCspDirectives(contentSecurityPolicy);

  assertCspDirectiveIncludes(directives, "default-src", "'self'");
  assertCspDirectiveIncludes(directives, "base-uri", "'self'");
  assertCspDirectiveIncludes(directives, "object-src", "'none'");
  assertCspDirectiveIncludes(directives, "frame-ancestors", "'none'");
  assertCspDirectiveIncludes(directives, "script-src", "'self'");
  assertCspDirectiveIncludes(directives, "style-src", "'self'", "https://fonts.googleapis.com");
  assertCspDirectiveIncludes(directives, "font-src", "'self'", "https://fonts.gstatic.com");
  assertCspDirectiveIncludes(directives, "img-src", "'self'", "data:", "blob:");
  assertCspDirectiveIncludes(directives, "connect-src", "'self'", "https:", "wss:");

  assert.equal(readHeader(nginxConfig, "X-Frame-Options"), "DENY");
  assert.equal(readHeader(nginxConfig, "X-Content-Type-Options"), "nosniff");
  assert.equal(readHeader(nginxConfig, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /camera=\(\)/);
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /microphone=\(\)/);
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /geolocation=\(\)/);
});
