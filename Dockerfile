FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY src/ ./src/

# HF Spaces requires port 7860
ENV PORT=7860
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["node", "server.js"]
