FROM node:20-slim

WORKDIR /app

# Copy only the files needed to run
COPY server.js ./
COPY src/ ./src/
COPY package.json ./

# Create persistent data directory
RUN mkdir -p /data

# HF Spaces requires port 7860
ENV PORT=7860
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["node", "server.js"]
