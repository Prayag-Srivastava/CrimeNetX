# CrimeNetX frontend — development image

FROM node:20-alpine

WORKDIR /app

# Dependencies
COPY frontend/package.json frontend/package-lock.json* ./

RUN npm ci || npm install

EXPOSE 3000

CMD ["npm", "run", "dev"]