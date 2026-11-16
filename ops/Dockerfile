FROM alpine:3.21
RUN apk add --no-cache bash curl coreutils findutils gzip postgresql17-client rclone tzdata
COPY loop.sh /loop.sh
RUN chmod +x /loop.sh
CMD ["/loop.sh"]
