
# Make sure these directly line up with the README
ARG NODE_VERSION=22
ARG PNPM_VERSION="10.7.1"

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache git git-lfs
RUN git lfs install
RUN --mount=type=cache,target=/root/.npm npm install -g pnpm@${PNPM_VERSION}

FROM base AS app
COPY . /app
WORKDIR /app

FROM app AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM app AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM app AS final
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

WORKDIR /app
CMD ["node", "dist"]
