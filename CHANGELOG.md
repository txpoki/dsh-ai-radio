# Changelog

## 0.1.1

- Fix DSH activation hanging with `pending (waiting for services: required, optional)`: declare dependencies using Cordis's supported service-name array.
- Add a real Cordis-loader lifecycle test, including delayed service availability, activation and cleanup. The test can run against the runtime bundled with the installed DSH Desktop.
- Keep a closed radio overlay unmounted during startup or connection failure, so it cannot cover DSH's toolbar or block plugin management.

## 0.1.0

- Initial personal AI radio implementation.
