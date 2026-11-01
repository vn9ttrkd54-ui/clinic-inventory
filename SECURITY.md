# Security review and staff access plan

Reviewed October 30, 2026. This review covers the local inventory prototype. Remote staff sign-in and a hosted deployment have not been implemented or tested.

## Verified current access

- The running server listens on `127.0.0.1:3001`, not a public or clinic-network interface.
- Requests with unexpected hostnames are refused. Browser cross-site API reads and writes are refused, and writes require the app's custom request header.
- The local API does not authenticate people. Anyone able to use this computer's account, or run a local program under it, can access the inventory. A custom header is not a password or staff identity check.
- The data directory is now owner-only (`0700`) and both existing SQLite files are owner-readable/writable (`0600`). New database files and journals inherit restrictive permissions. Contents were not reset or migrated.

## Changes made

- Tightened existing local data-file permissions and made that protection part of server startup.
- Applied cross-site request checks to API reads as well as writes.
- Added a no-referrer policy, same-origin resource policy, frame protection, and disabled unused camera, microphone, and location permissions.
- Strengthened the existing content security policy to disallow embedded objects and frames.
- Validated that submitted JSON is an object, bounded request bodies to 64 KiB of received bytes, and preserved Unicode characters split across network chunks.
- Return a controlled client error for malformed encoded paths.
- Excluded environment files and common private-key files from source control.

The source review also confirmed parameterized SQL queries, HTML escaping of displayed input, validation of supplier URL schemes, CSV formula protection, and static-file routing confined to the public directory. Those observations are not a guarantee against all vulnerabilities.

## Validation

- `npm test`: 19 checks passed, covering inventory behavior, persistence, request guards, input parsing, and file permissions.
- `npm run security:check`: 18 HTTP checks passed against the restarted local server. Checks cover private-file requests, encoded path traversal, foreign origins and hosts, missing write protections, invalid and oversized bodies, malformed paths, unsupported methods, and required response headers.
- Both clinic and sample inventory API snapshots were unchanged before and after the HTTP checks.

These are source review and targeted local tests, not a comprehensive penetration test or verification of a future hosting provider.

## Agreed remote access model

The user selected access from anywhere using an approved list of staff email addresses.

1. Use a maintained authentication provider for email verification and session handling. Only invited or explicitly approved accounts may access clinic records; possession of the website URL grants no access.
2. Enforce approval on the server or database for every inventory read, write, and export. A hidden page or client-side email check alone is insufficient.
3. Keep management of approved accounts restricted to the clinic's designated administrator. Removing approval must block subsequent data requests, including requests from an existing session.
4. Use HTTPS, protected server-side credentials, and persistent storage with tested backups. The current local SQLite files cannot simply be copied into an ephemeral hosting filesystem and relied on for persistence.
5. Test signed-out requests, an authenticated but unapproved account, an approved staff account, and a removed staff account before staff begin remote use. Verify that export and direct API calls follow the same rules as the screen.

The existing activity log records actions, not the identity of a staff member. Recording the authenticated actor belongs in the remote version. No staff accounts or invitations have been created, and no inventory data has been uploaded.

References: [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
