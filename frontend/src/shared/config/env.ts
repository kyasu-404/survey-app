const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function readRequiredEnv(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable ${name}. Set ${name} before starting the frontend.`);
  }

  return value;
}

export function resolveSupabaseUrl(
  configuredUrl: string,
  currentLocationHref?: string,
  isDev = import.meta.env.DEV,
) {
  const normalizedConfiguredUrl = trimTrailingSlash(configuredUrl);

  if (!isDev || !currentLocationHref) {
    return normalizedConfiguredUrl;
  }

  try {
    const supabaseUrl = new URL(normalizedConfiguredUrl);
    const currentUrl = new URL(currentLocationHref);

    if (!LOCAL_HOSTNAMES.has(supabaseUrl.hostname) || LOCAL_HOSTNAMES.has(currentUrl.hostname)) {
      return normalizedConfiguredUrl;
    }

    supabaseUrl.hostname = currentUrl.hostname;
    return trimTrailingSlash(supabaseUrl.toString());
  } catch {
    return normalizedConfiguredUrl;
  }
}

const currentLocationHref = typeof window !== "undefined" ? window.location.href : undefined;

export const SUPABASE_URL = resolveSupabaseUrl(
  readRequiredEnv(import.meta.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL"),
  currentLocationHref,
);

export const SUPABASE_ANON_KEY = readRequiredEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, "VITE_SUPABASE_ANON_KEY");

export const SUPABASE_STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ?? "survey-files";
