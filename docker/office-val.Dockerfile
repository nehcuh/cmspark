# #611: frozen Linux ARM64 WASM validation, including declared Chinese fonts.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/cmspark/companion
COPY companion/package.json companion/package-lock.json ./
# postinstall builds macOS tray, which is irrelevant in this Linux validation image.
RUN npm ci --ignore-scripts
WORKDIR /opt/cmspark
CMD ["bash"]
