FROM node:20-alpine AS build
WORKDIR /app

# Work around lockfile entries that referenced local tarballs during earlier exploration.
RUN apk add --no-cache jq

COPY web/package.json web/package-lock.json ./

# Ensure @rspc deps resolve from the npm registry inside Docker.
RUN jq '(.packages["node_modules/@rspc/client"].resolved)="https://registry.npmjs.org/@rspc/client/-/client-0.3.1.tgz" | (.packages["node_modules/@rspc/solid-query"].resolved)="https://registry.npmjs.org/@rspc/solid-query/-/solid-query-0.3.1.tgz"' \
      package-lock.json > package-lock.json.tmp \
  && mv package-lock.json.tmp package-lock.json

RUN npm ci

COPY web/ ./
RUN npm run build

FROM nginx:1.25-alpine AS runtime
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
