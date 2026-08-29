FROM node:20-alpine AS base
WORKDIR /app

# Install native build tools required by bcrypt (C++ addon)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-timeout 600000 \
    && npm install --legacy-peer-deps

COPY . .

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "src/server.js"]
