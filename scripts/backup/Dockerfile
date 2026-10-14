# Tools for scripts/backup-offsite.sh: 7-Zip for the encrypted archive and
# rclone for the Dropbox upload, so nothing has to be installed on the host.
#   docker build -t eqemu-backup-tools:1 scripts/backup
FROM alpine:3.20

RUN apk add --no-cache 7zip rclone ca-certificates

WORKDIR /work
