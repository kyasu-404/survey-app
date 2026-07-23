FROM node:22-alpine@sha256:b74031e546d7f4faf561d797ac1b76beccac856a042815ca77db4fd047581605 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_STORAGE_BUCKET=survey-files
ARG VITE_APP_RELEASE=local

RUN test -n "$VITE_SUPABASE_URL"
RUN --mount=type=secret,id=supabase_anon_key,required=true \
  VITE_SUPABASE_ANON_KEY="$(cat /run/secrets/supabase_anon_key)" npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

RUN sed -i '/^user[[:space:]]/d' /etc/nginx/nginx.conf \
  && touch /var/run/nginx.pid \
  && chown -R nginx:nginx /var/cache/nginx /var/run/nginx.pid /var/log/nginx

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
