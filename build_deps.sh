#!/usr/bin/env bash
# Dependency build script for the PS5 Payload SDK inside Docker (libmicrohttpd only)
set -e

export PATH="/opt/ps5-payload-sdk/bin:$PATH"

TEMPDIR=$(mktemp -d)
trap 'rm -rf -- "$TEMPDIR"' EXIT

cd $TEMPDIR

# Common compiler tools mapped to SDK wrappers
export CC=prospero-clang
export CXX=prospero-clang++
export AR=prospero-ar
export NM=prospero-nm
export RANLIB=prospero-ranlib

echo "=== Building libmicrohttpd 1.0.1 ==="
# Try multiple mirrors with retries (GNU FTP can be unreliable in CI)
MIRRORS=(
  "https://mirrors.kernel.org/gnu/libmicrohttpd/libmicrohttpd-1.0.1.tar.gz"
  "https://mirror.math.princeton.edu/pub/gnu/libmicrohttpd/libmicrohttpd-1.0.1.tar.gz"
  "https://ftp.gnu.org/gnu/libmicrohttpd/libmicrohttpd-1.0.1.tar.gz"
)
DOWNLOADED=0
for mirror in "${MIRRORS[@]}"; do
  echo "Trying $mirror ..."
  if wget --tries=3 --timeout=15 -O libmicrohttpd.tar.gz "$mirror"; then
    DOWNLOADED=1
    break
  fi
  echo "Failed, trying next mirror..."
done
if [ "$DOWNLOADED" -ne 1 ]; then
  echo "Error: Could not download libmicrohttpd from any mirror."
  exit 1
fi
tar xf libmicrohttpd.tar.gz
cd libmicrohttpd-1.0.1
./configure --host=x86_64-pc-freebsd12 \
            --disable-shared --enable-static \
            --disable-curl --disable-examples \
            --prefix=/opt/ps5-payload-sdk/target
make -j$(nproc)
make install

echo "libmicrohttpd successfully built and installed!"
