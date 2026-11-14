FROM node:22-alpine
WORKDIR /app
COPY server.js access-verifier.js reliability-diagnostics.js live.js config.yaml CHANGELOG.md /app/
COPY web/ /usr/share/pet-control/
EXPOSE 80 8080
CMD ["node", "--max-old-space-size=128", "/app/server.js"]
