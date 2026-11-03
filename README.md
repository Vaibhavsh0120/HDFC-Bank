# HDFC Bank

A cross-platform personal banking project built with Django REST Framework, Astro, React and MySQL. Accounts and funds are fictional.

## Local setup

Create a Python 3.12 virtual environment, install `backend/requirements.txt`, then run `python backend/manage.py migrate` and `python backend/manage.py runserver`. In another terminal, run `npm ci` and `npm run dev` in `frontend`. Local development defaults to SQLite. Copy the example environment files to configure MySQL or a different API origin.

Run backend tests with `python backend/manage.py test banking` and frontend checks with `npm run check` and `npm run build`.

## Hosting

The Render Blueprint contains separate web and API services. Configure the API's database credentials, Aiven CA secret file and CORS origin. Configure the static site's `PUBLIC_API_URL` with the HTTPS API origin. Run migrations and create a Django superuser for the admin interface.

## Mobile releases

Set the GitHub repository variable `PUBLIC_API_URL` to the HTTPS API origin, then manually run the Mobile release workflow with a version and platform. Android packages are debug-signed. iOS packages are unsigned and need Apple signing and provisioning before installation.

## Environment backup

The encrypted `.env.age` contains the deployment environment. Run `ageu` in the repository root to decrypt it with the configured age identity. Run `agel` to refresh the encrypted copy after changing `.env`. Keep the identity private and outside the repository.

## Project design

Balance changes and transaction records are committed together. Each request has a unique identifier so retries return the existing transaction. Transfers lock accounts in a consistent order. Django administration supports account status management and ledger review.
