-- Runs once, on the very first start of the db container (empty volume).
-- ddf_test: wiped by the test suite. ddf_dev: used by `npm run dev` for staging smoke runs.
create database ddf_test;
create database ddf_dev;
