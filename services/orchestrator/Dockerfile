FROM node:22-slim AS build
WORKDIR /app
COPY services/orchestrator/package*.json ./
RUN npm ci
COPY services/orchestrator/tsconfig.json ./
COPY services/orchestrator/src ./src
COPY services/orchestrator/scripts ./scripts
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY services/orchestrator/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/src/server.js"]
