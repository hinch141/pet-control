FROM node:22-alpine
WORKDIR /app
COPY server.js access-verifier.js reliability-diagnostics.js live.js config.yaml CHANGELOG.md /app/
COPY web/ /usr/share/pet-control/
CMD ["node","/app/server.js"]
