
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev
RUN npm config get bin-links
RUN npm root
RUN ls -la node_modules/vite/bin
RUN node -e "console.log(require('./node_modules/vite/package.json').bin)"
RUN npm exec -- vite --version

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
