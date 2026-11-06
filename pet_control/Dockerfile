ARG BUILD_FROM=nginx:stable-alpine
FROM ${BUILD_FROM}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
