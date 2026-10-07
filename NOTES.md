# Assessment notes

## Phase 1: Make it run

### Local setup

1. Cloned the starter repository and retained its existing Git history.
2. Installed the starter dependencies and configured a local `.env` from `.env.example` with `DATABASE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN`. Credential values remain outside Git.
3. Created a Neon PostgreSQL database in AWS Asia Pacific (Singapore), `aws-ap-southeast-1`.
4. Ran `npx prisma db push` to synchronize the coordination schema.
5. Ran `npx prisma generate` to create the database client required by the application.
6. Started the application with `npm run dev`.

### Setup diagnosis and verification

- API routes initially failed with `Cannot find module '.prisma/client/default'`, and TypeScript reported that `@prisma/client` had no `PrismaClient` export. Prisma 7 no longer generates the client automatically during `db push`; explicit generation resolved the missing-client blocker. The existing production build script already includes generation. [Prisma CLI reference](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#db-push)
- After client generation, the globe loads and responds to interaction, and polling appears to run locally. The development log shows `GET /` returning HTTP 200.
- Local development observations with the Singapore database: app entry completes in under one second and `/api/signal` requests complete in under 100 ms. No controlled benchmark has been run.
- Baseline lint passed. TypeScript passed after generating Prisma Client. A production build and the complete two-participant chat/video flow still need verification; local startup does not complete Phase 1.

### Database and deployment decisions

- Selected Neon Singapore (`aws-ap-southeast-1`) to keep the database near the development and testing environment and limit network delay during local debugging. [Neon regions](https://neon.com/docs/introduction/regions)
- Planned Vercel functions in Singapore (`sin1`) to keep the deployed API close to the database. This is particularly relevant to polling, which performs several sequential database operations. [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region), [Vercel regions](https://vercel.com/docs/regions)
- This pairing is available on Neon Free and Vercel Hobby within their usage limits. Hobby supports one chosen function region. [Neon free-tier availability](https://neon.com/blog/making-pricing-more-predictable), [Vercel region configuration](https://vercel.com/docs/project-configuration/vercel-json#regions)
- Retained the starter's Prisma ORM and `pg` adapter to keep setup changes focused.
- Vercel project creation is deferred until the new public GitHub repository exists. Deployment, environment-variable configuration, and the actual deployed function region remain pending.

## Phase 2: Make it good

Pending. No visual direction has been selected or implemented.

## Phase 3: Make it secure

Pending. No security changes have been implemented.

## Phase 4: Make it better

Pending. No additional feature has been selected or implemented.
