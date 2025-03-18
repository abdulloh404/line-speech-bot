FROM node:22

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 8806
CMD ["node", "dist/index.js"]
