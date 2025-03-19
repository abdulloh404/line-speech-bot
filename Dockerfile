FROM node:22

RUN apt-get update && apt-get install -y ffmpeg
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 8808
CMD ["node", "dist/index.js"]
