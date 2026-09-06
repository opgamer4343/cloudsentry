# Frontend image: build the static React app, then serve it with nginx.
# VITE_API_BASE_URL is baked in at build time (Vite env vars aren't readable
# at runtime) - point it at wherever the browser can reach the backend, not
# the backend's in-Docker-network hostname.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
