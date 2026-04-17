#!/bin/bash
# Start image server without proxy

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

cd /home/sunshuheng/Downloads/open-notebook/images
exec python3 -m http.server 8888 --bind 0.0.0.0
