
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev
RUN npm ls vite && ls -l node_modules/.bin/vite

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
