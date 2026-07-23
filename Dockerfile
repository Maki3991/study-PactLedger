FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    KALEIDOX_API_HOST=0.0.0.0 \
    KALEIDOX_API_PORT=8787 \
    KALEIDOX_SERVE_WEB=true \
    PANDA_PYTHON_BIN=/opt/panda-venv/bin/python

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/panda-venv

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/requirements-panda.txt ./requirements-panda.txt
RUN /opt/panda-venv/bin/pip install --no-cache-dir -r requirements-panda.txt

COPY web/ ./
RUN npm run build

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start:api"]
