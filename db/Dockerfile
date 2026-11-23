# Postgres plus the first-boot SQL. Baked in, not mounted: see "No folder links" in docker-compose.yml.
FROM postgres:17-alpine
COPY schema.sql /docker-entrypoint-initdb.d/10-schema.sql
COPY test-db.sql /docker-entrypoint-initdb.d/20-test-db.sql
