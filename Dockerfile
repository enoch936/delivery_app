FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/api/package.json services/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN npm ci
COPY services/api services/api
COPY packages packages
RUN npm run build --workspace @delivery-app/domain --workspace @delivery-app/validation --workspace @delivery-app/api-contracts \
  && npm run build --workspace @delivery-app/api \
  && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=development
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/services/api/package.json services/api/package.json
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/packages packages
EXPOSE 3000
CMD ["node", "services/api/dist/main.js"]
