# Jammy versiyasi ancha barqaror va xatosiz ishlaydi
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Standart ishchi papka
WORKDIR /usr/src/app

# Faqat kerakli kutubxonalarni o'rnatish (tezroq build bo'lishi uchun)
COPY package*.json ./
RUN npm install --omit=dev

# Barcha kodlarni nusxalash
COPY . .

# Muhit o'zgaruvchilari
ENV NODE_ENV=production
ENV TZ=Asia/Tashkent

# Botni ishga tushirish
CMD ["node", "index.js"]
