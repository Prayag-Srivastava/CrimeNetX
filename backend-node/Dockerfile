# CrimeNetX — Node REST + WebSocket backend

FROM node:20-alpine

RUN apk update && apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

RUN npm ci || npm install

COPY prisma ./prisma

COPY tsconfig.json .

COPY src ./src

COPY data ./data

RUN npx prisma generate && npm run build

EXPOSE 5000

# migrations run via docker-compose command
# (prisma migrate deploy && npm run start)

CMD ["npm", "run", "start"]