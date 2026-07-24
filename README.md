# Shiplet database test app

A deliberately small Node.js application used to verify Shiplet's complete
Postgres workflow:

1. Import the repository.
2. Provision a free Render Postgres database from Shiplet.
3. Receive `DATABASE_URL` as an encrypted runtime secret.
4. Deploy and persist notes through redeploys.

The process exits immediately when `DATABASE_URL` is missing, making a false
positive deployment impossible.
