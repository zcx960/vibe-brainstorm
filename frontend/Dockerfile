# ---- Stage 1: build the SPA ----
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci || npm install

# Build.
COPY . .
RUN npm run build

# ---- Stage 2: serve with nginx ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
