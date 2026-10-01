FROM node:20-alpine
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Placeholder only, so `next build` can import route modules. The real URL comes in at run time.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL=$DATABASE_URL npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start"]
