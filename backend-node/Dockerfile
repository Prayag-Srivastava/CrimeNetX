FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

RUN npm ci || npm install

COPY prisma ./prisma

RUN npx prisma generate

EXPOSE 5000

CMD ["npm", "run", "dev"]