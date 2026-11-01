# Security and verification

## Online access

Supabase manages individual staff sessions and passwords. Each inventory request verifies the session and checks the current approved email list. Approval is based on the authenticated provider account, not an email supplied in an inventory request. Removing approval blocks existing sessions on their next data request. The database also verifies that the provider session still exists.

The database tables live in an unexposed private schema. Direct client table grants are revoked and row-level security defaults to deny. Narrow RPC functions require both approved staff identity and a separate server-only secret. A staff browser cannot submit arbitrary inventory snapshots directly. Administrator functions check the administrator role and protect the last active administrator.

The account-setup Edge Function uses its provider-managed service credential only on the server. It requires the server secret and an active approved address before creating a one-time setup/reset link. The website's setup endpoint additionally requires an authenticated administrator. Setup links are credentials: share them privately, never commit them, and generate a replacement if one expires or is exposed. Tokens are passed in URL fragments and removed from browser history when opened.

The browser stores the normal Supabase session on the device. Use trusted devices, sign out of shared computers, and keep administrator accounts limited. Initial account provisioning is performed by an administrator rather than relying on outgoing email. There is no self-service email reset flow.

## Request and data controls

- HTTPS is provided by the hosting services.
- API responses and browser assets use no-store caching and security headers.
- The content security policy restricts scripts to this site and connections to the configured Supabase project.
- Cross-site API requests are refused; changes require a same-origin request header and bounded object-shaped JSON.
- Inventory input is validated on the server, displayed text is escaped, supplier URL schemes are restricted, and CSV cells have formula protections.
- Version checks prevent concurrent writes from silently overwriting each other. Conflicts retry or return a controlled retry message.
- Successful cloud writes record the authenticated actor in a private audit table.
- No patient records are required. Use supply descriptions and aggregate daily patient totals only.

Provider project owners retain infrastructure access independently of the website's staff roles. Do not share Supabase or Vercel administrator access with ordinary staff or portfolio reviewers.

## Local access

The local server listens on loopback and has no user authentication. Anyone able to use its operating-system account can access the local inventory. It refuses unexpected hosts and cross-site requests. The data directory and local database files use restrictive file permissions. Cloud deployment does not automatically migrate local records.

## Verification scope and operational limits

Automated checks cover inventory arithmetic, local persistence, snapshot restoration, conflicting updates, rejected mutations, API request guards, JSON limits, and local file permissions. Live deployment checks cover authentication, staff authorization, revoked access, saved data, and provider access restrictions. These checks are targeted functional/security verification, not a comprehensive penetration test or a compliance certification.

Keep dependencies updated and review provider access, usage limits, and audit records. The free provider configuration does not include compromised-password screening in this implementation. Use long, unique passwords. Automated full database backup/restore, MFA enrollment UI, and monitoring alerts are not implemented; the inventory CSV is not a full backup. Project owners should arrange database exports and test restoration before relying on the app as the sole record.

References: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), and [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
