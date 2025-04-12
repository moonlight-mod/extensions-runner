# TODO: pin this better
FROM node:22 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@10

FROM base AS builder
COPY . /app
WORKDIR /app
CMD [ "node", "builder/index.mjs" ]
