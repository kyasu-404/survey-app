FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

RUN sed -i '/^user[[:space:]]/d' /etc/nginx/nginx.conf \
  && touch /var/run/nginx.pid \
  && chown -R nginx:nginx /var/cache/nginx /var/run/nginx.pid /var/log/nginx

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
