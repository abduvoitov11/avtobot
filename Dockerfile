FROM mcr.microsoft.com/playwright:focal

WORKDIR /usr/src/app

COPY package.json ./

RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV TZ=Asia/Tashkent

CMD ["node", "index.js"]

