FROM node:22-alpine
WORKDIR /app
COPY server.js access-verifier.js reliability-diagnostics.js config.yaml CHANGELOG.md /app/
COPY web/ /usr/share/pet-control/
CMD ["node", "--max-old-space-size=128", "/app/server.js"]
