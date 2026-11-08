FROM node:22-alpine
WORKDIR /app
COPY server.js access-verifier.js /app/
COPY web/ /usr/share/pet-control/
CMD ["node","/app/server.js"]
