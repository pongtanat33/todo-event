# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --frozen-lockfile
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3020
CMD ["node", "dist/index.js"]
