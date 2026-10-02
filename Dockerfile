FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Placeholder only, so `next build` can import route modules. The real URL comes in at run time.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL=$DATABASE_URL npm run build

EXPOSE 3000
CMD ["sh", "-c", "npx prisma generate && npm run db:deploy && npm start"]
