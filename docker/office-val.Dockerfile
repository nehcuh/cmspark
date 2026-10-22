# #611: frozen Linux ARM64 WASM validation, including declared Chinese fonts.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/cmspark/companion
COPY companion/package.json companion/package-lock.json ./
# postinstall builds macOS tray, which is irrelevant in this Linux validation image.
RUN npm ci --ignore-scripts
WORKDIR /opt/cmspark
CMD ["bash"]
