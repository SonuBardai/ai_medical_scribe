lint:
	ruff check --fix

fmt:
	ruff format

style:
	$(MAKE) lint
	$(MAKE) fmt

install:
	pipenv install --dev

venv:
	pipenv shell

shell:
	pipenv run python manage.py shell

run:
	pipenv run python manage.py runserver