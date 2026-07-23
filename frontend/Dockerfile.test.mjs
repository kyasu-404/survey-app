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

test("Dockerfile builds a production image on supported Node 22 and serves static assets", () => {
  assert.match(dockerfile, /FROM node:22(?:\.\d+)?-alpine@sha256:[a-f0-9]{64} AS build/i);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /ARG VITE_SUPABASE_URL/);
  assert.match(dockerfile, /test -n "\$VITE_SUPABASE_URL"/);
  assert.doesNotMatch(dockerfile, /^(?:ARG|ENV)\s+VITE_SUPABASE_ANON_KEY/im);
  assert.doesNotMatch(dockerfile, /^(?:ARG|ENV)\s+VITE_PUBLIC_SUPABASE_ANON_KEY/im);
  assert.match(dockerfile, /--mount=type=secret,id=supabase_anon_key,required=true/);
  assert.match(dockerfile, /VITE_SUPABASE_ANON_KEY="\$\(cat \/run\/secrets\/supabase_anon_key\)" npm run build/);
  assert.match(dockerfile, /FROM nginx:[^\s]+@sha256:[a-f0-9]{64}/i);
  assert.doesNotMatch(dockerfile, /npm run dev/);
});

test("production image runs nginx as a non-root user on an unprivileged port", () => {
  assert.match(dockerfile, /^USER\s+(?!root\b)\S+/im);
  assert.match(dockerfile, /^EXPOSE\s+8080\b/im);
  assert.match(nginxConfig, /^\s*listen\s+8080;/im);
  assert.doesNotMatch(nginxConfig, /^\s*listen\s+80;/im);
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
  assertCspDirectiveIncludes(directives, "style-src", "'self'");
  assertCspDirectiveIncludes(directives, "font-src", "'self'", "data:", "https://fonts.gstatic.com");
  assert.ok(!directives.get("style-src")?.includes("https://fonts.googleapis.com"));
  assertCspDirectiveIncludes(directives, "img-src", "'self'", "data:", "blob:");
  assertCspDirectiveIncludes(
    directives,
    "connect-src",
    "'self'",
    "http://$host:8000",
    "ws://$host:8000",
    "https:",
    "wss:",
  );

  assert.equal(readHeader(nginxConfig, "X-Frame-Options"), "DENY");
  assert.equal(readHeader(nginxConfig, "X-Content-Type-Options"), "nosniff");
  assert.equal(readHeader(nginxConfig, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /camera=\(\)/);
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /microphone=\(\)/);
  assert.match(readHeader(nginxConfig, "Permissions-Policy") ?? "", /geolocation=\(\)/);
});
