# Integration Test Project

The Stage 5 fake transport suite proves handshake, auth/version failure, snapshot normalization, preconditions, idempotency, uncertainty, disconnect, and reconciliation deterministically.

Run the read-only real OBS fixture with OBS Studio 30+ WebSocket enabled by setting OBSCURPILOT_OBS_INTEGRATION=1 before npm run test:integration.

The fixture uses OBS_WEBSOCKET_URL (default ws://127.0.0.1:4455) and OBS_WEBSOCKET_PASSWORD.
