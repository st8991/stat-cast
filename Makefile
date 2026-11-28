.PHONY: up down logs backfill psql sample test dbt lint web web-test deploy

up:            ## start Postgres + Airflow at http://localhost:8080
	docker compose up -d --build

down:          ## stop the stack (add -v to also drop the database volume)
	docker compose down

logs:
	docker compose logs -f airflow

backfill:      ## run the DAG for each day of the sample week inside the container
	for d in 2025-06-02 2025-06-03 2025-06-04 2025-06-05 2025-06-06 2025-06-07 2025-06-08 2025-06-09; do \
	  docker compose exec -T airflow airflow dags test statcast_daily -c "{\"game_date\": \"$$d\"}" > /dev/null && echo "$$d ok"; \
	done

psql:          ## open a SQL shell on the warehouse
	docker compose exec postgres psql -U statcast -d statcast

sample:        ## regenerate the synthetic sample (deterministic)
	python scripts/make_sample.py

test:          ## Python tests (Postgres tests run if WAREHOUSE_* points at a database)
	pytest -q

dbt:           ## dbt build against WAREHOUSE_* from your shell
	eval "$$(PYTHONPATH=src python -m statcast_pipeline warehouse-env)" && DBT_PROFILES_DIR=dbt dbt build --project-dir dbt

lint:
	ruff check .

web:           ## run the web app (Next.js) against WAREHOUSE_* from your shell, http://localhost:3000
	cd web && npm install && npm run dev

web-test:      ## typecheck + vitest for the web app (warehouse tests run if WAREHOUSE_* reaches built marts)
	cd web && npm run lint && npm test

deploy:        ## build with OpenNext and deploy to Cloudflare Workers (needs wrangler login + Hyperdrive id)
	cd web && npm run deploy
