-- Runs once, the first time the Postgres volume is created.
-- The "airflow" database (Airflow's metadata) is created by POSTGRES_DB;
-- the warehouse gets its own database and role.
create role statcast with login password 'statcast';
create database statcast owner statcast;
