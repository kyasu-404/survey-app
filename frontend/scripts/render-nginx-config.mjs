import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function httpUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(url.host) ||
    url.port === "0"
  ) {
    throw new Error("Nginx CSP requires an HTTP(S) URL with a valid origin");
  }
  return url;
}

export function renderNginxConfig(template, { supabaseUrl, sentryDsn, officeEmbedOrigin }) {
  const api = httpUrl(supabaseUrl);
  if (api.username || api.password) {
    throw new Error("The Supabase URL must not contain credentials");
  }
  const socketProtocol = api.protocol === "https:" ? "wss:" : "ws:";
  const imageSources = [api.origin];
  const connectSources = [api.origin, socketProtocol + "//" + api.host];

  // The browser client remaps localhost to the current host for LAN deployments.
  if (["localhost", "127.0.0.1"].includes(api.hostname)) {
    const lanHost = "$host" + (api.port ? ":" + api.port : "");
    imageSources.push(api.protocol + "//" + lanHost);
    connectSources.push(api.protocol + "//" + lanHost, socketProtocol + "//" + lanHost);
  }
  if (sentryDsn) {
    connectSources.push(httpUrl(sentryDsn).origin);
  }

  let extraFrameSource = "";
  if (officeEmbedOrigin) {
    const office = httpUrl(officeEmbedOrigin);
    if (office.pathname !== "/" || office.search || office.hash || office.username || office.password) {
      throw new Error("OFFICE_EMBED_ORIGIN must be a bare HTTP(S) origin");
    }
    extraFrameSource = " " + office.origin;
  }

  return template
    .replaceAll("__SURVEY_EXTRA_FRAME_SOURCE__", extraFrameSource)
    .replaceAll("__SURVEY_API_IMG_SRC__", imageSources.join(" "))
    .replaceAll("__SURVEY_CONNECT_SRC__", [...new Set(connectSources)].join(" "));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  writeFileSync(output, renderNginxConfig(readFileSync(input, "utf8"), {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    sentryDsn: process.env.VITE_SENTRY_DSN,
    officeEmbedOrigin: process.env.OFFICE_EMBED_ORIGIN,
  }));
}
