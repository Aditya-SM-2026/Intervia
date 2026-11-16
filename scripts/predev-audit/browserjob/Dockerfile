FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY run.js browser-mic.wav ./
CMD ["node", "run.js"]
