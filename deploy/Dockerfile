# OPL 4NE1 Gen4 – Server ohne Fremdabhängigkeiten.
# Bauen:   docker build -t opl-gen4 -f deploy/Dockerfile .
# Starten: docker run -d -p 8787:8787 -v opl-daten:/data -e OPL_DATA=/data --name opl opl-gen4
FROM node:20-alpine

WORKDIR /app
COPY . /app
# Datenordner liegt bewusst ausserhalb des Projektordners (Volume).
RUN rm -rf /app/data /app/node_modules /app/.git && mkdir -p /data

ENV PORT=8787 HOST=0.0.0.0 OPL_DATA=/data NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
