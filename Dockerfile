
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --include=dev --bin-links=true

# Create executable links manually
RUN mkdir -p node_modules/.bin \
    && ln -sf ../vite/bin/vite.js node_modules/.bin/vite \
    && ln -sf ../esbuild/bin/esbuild node_modules/.bin/esbuild

# Verify both build tools
RUN node node_modules/vite/bin/vite.js --version
RUN node_modules/.bin/esbuild --version

COPY . .

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
