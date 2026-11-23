FROM node:22-alpine@sha256:b74031e546d7f4faf561d797ac1b76beccac856a042815ca77db4fd047581605 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_STORAGE_BUCKET=survey-files
ARG VITE_APP_RELEASE=local
ARG VITE_SENTRY_DSN
ARG OFFICE_EMBED_ORIGIN

RUN test -n "$VITE_SUPABASE_URL"
RUN node scripts/render-nginx-config.mjs nginx.conf /tmp/survey-nginx.conf
RUN --mount=type=secret,id=supabase_anon_key,required=true \
  VITE_SUPABASE_ANON_KEY="$(cat /run/secrets/supabase_anon_key)" npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

COPY --from=build /tmp/survey-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN sed -i '/^user[[:space:]]/d' /etc/nginx/nginx.conf \
  && touch /var/run/nginx.pid \
  && chown -R nginx:nginx /var/cache/nginx /var/run/nginx.pid /var/log/nginx

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
