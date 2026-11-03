# metalgym88

Gym workout tracker — product of the [djlabs platform](https://api.djlabs.cl).

metalgym88 is an [AGPL-3.0](LICENSE) fork of the open source
[openGym](https://github.com/DuarteSantos8/openGym) frontend (by DuarteSantos8), adapted as a
platform product with unified djlabs accounts, platform credits and payments, and an AI
assistant over the user's own workout data. See [NOTICE.md](NOTICE.md).

## Stack

- React 19 + Vite 8, Zustand 5 state management, react-router (HashRouter)
- vitest test suites (port of the openGym domain tests)
- Offline-first: full app functionality without a connection (localStorage as client source
  of truth); the AI assistant requires connectivity and consumes platform credits

## Platform integration

The app talks to the platform API (`api.djlabs.cl`):

- **Auth** — `POST /auth/magic-link`, `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me?heart=metalgym88`
  (JWT httpOnly cookies, credentials included; heart-scoped)
- **Gym data sync** — `GET` / `PUT /opengym/data` (per-user JSON document store;
  offline-first, debounced push, `_ts` last-write-wins)
- **Wallet & credits** — `GET /credits/balance`, `GET /credits/movements`,
  `GET /payments/limits`, `POST /payments/orders` (`Idempotency-Key` header, Flow redirect)
- **AI assistant** — `POST /opengym/ai` (credit-metered per operation; reads the user's
  stored gym data server-side)

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # vitest suites
npm run build    # production bundle (dist/)
```

## License

GNU AGPL-3.0-or-later — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
