# Security Review

This review covers the repository's desktop filesystem and IPC boundaries,
compiler launch paths, collaboration HTTP/WebSocket authorization, credential
storage, model downloads, renderer HTML entry points, CLI update verification,
and dependency audit. It is a source review with regression tests, not a claim
that every vulnerability has been eliminated or a production penetration test.

## Fixed Findings

| Area                        | Verified problem                                                                                                          | Change                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaboration authorization | A public client ID was sufficient to inherit another collaborator's role.                                                 | Bind permissions to a SHA-256 digest of the private session credential. Reject mismatched or unbound identities.                                                       |
| Read-only collaboration     | Viewers could mutate documents using Yjs sync step 2.                                                                     | Reject both update-bearing message types and avoid soliciting sync step 2 from viewers.                                                                                |
| Permission changes          | Open sockets retained their original role; concurrent metadata writes could lose changes.                                 | Disconnect changed identities and serialize operations per project.                                                                                                    |
| Removal                     | A removed identity could immediately rejoin using its existing share token.                                               | Retain a denied permission entry bound to that identity.                                                                                                               |
| Live document quotas        | Size checks ran after mutation and broadcast, and WebSocket edits bypassed file/project byte quotas.                      | Validate an isolated candidate document and shared quotas before committing an update. Bound pending messages, outgoing buffers, room count, and awareness identities. |
| Bearer-token exposure       | Share credentials appeared in application and nginx request paths.                                                        | Redact share routes, including encoded paths, and omit referrers from nginx access logs.                                                                               |
| Rate limiting               | Direct deployments trusted spoofable forwarded headers by default.                                                        | Default proxy trust off; the provided nginx configuration overwrites forwarded client IPs.                                                                             |
| Desktop file access         | Several reads, writes, imports, moves, and compiler output paths used lexical containment only.                           | Centralize canonical component checks, including dangling links and missing output paths.                                                                              |
| Compiler invocation         | A filename starting with a dash could be interpreted as an option; shared compilation skipped workspace trust.            | Pass absolute input paths and require the existing trust decision before shared local compilation.                                                                     |
| Electron IPC                | Privileged handlers did not centrally authenticate the calling frame.                                                     | Require a registered application window, its main frame, and its expected renderer URL for desktop, AI, and terminal handlers.                                         |
| Credential storage          | Linux's weak fallback could pass the availability check; concurrent writes could lose keys.                               | Reject `basic_text` and `unknown` backends and serialize vault mutations.                                                                                              |
| Model downloads             | Catalog verification expectations were not passed to the downloader; oversized streams were written before checking size. | Pass catalog limits/checksums, enforce streaming bounds, validate filenames, and use exclusive random temporary files.                                                 |

Tests cover impersonation, legacy permissions, prototype-like IDs, viewer writes,
permission downgrades, removal, concurrent permission updates, oversized live
edits, valid editor synchronization, awareness limits, log redaction, symlink
escapes, compiler arguments, IPC sender identity, vault concurrency, and invalid
model downloads. The existing onboarding regression now checks the profile
input instead of an obsolete heading.

## Deployment And Migration

- Existing project owners retain access through their private owner session.
  Existing non-owner permission records without a session binding fail closed:
  there is no trustworthy way to infer their private session from a public ID.
  Re-invite affected collaborators with fresh client IDs, then restore their
  roles as the owner. A collaborator can remove only the `latexdo.cloud.client`
  local-storage key and reload to create a fresh ID; keep `latexdo.cloud.session`
  so ownership of their own projects is preserved.
- Share URLs remain bearer invitations. A holder can enroll a new identity.
  Rotate a share link when it is compromised; denying one identity is not a ban
  on the person who possesses that link. Existing log archives may contain old
  tokens and need operational retention review.
- Deploy `collaborations/security.mjs` alongside `server.mjs`. Both the installer
  and Dockerfile include it. No running service was changed by this review.
- Enable `LATEXDO_COLLAB_TRUST_PROXY=true` only behind a controlled proxy that
  overwrites `X-Forwarded-For`. Direct and Docker defaults now use the socket IP.
- Shared projects require a local trust decision before invoking external TeX
  tools. Linux users without a secure keyring must configure one to save keys.

## Boundaries And Remaining Work

- External TeX, LuaTeX, Asymptote, Git, and terminal processes are not OS-sandboxed.
  Trust only project authors whose executable content you accept. Filesystem
  containment checks do not prevent a separate local process from racing a
  symlink replacement after validation.
- Collaboration sessions and invitations are bearer credentials, not verified
  user accounts. The metadata locks apply to one server process; multiple
  writers sharing a data directory require transactional storage.
- Model catalog SHA-256 values are currently null. Size verification is now
  enforced, but cryptographic artifact integrity requires publishing trusted
  hashes in the catalog. No checksum values were invented.
- The custom WebSocket parser remains intentionally limited (no fragmented
  messages). Replacing it with a maintained protocol implementation and testing
  under sustained adversarial load remains a larger follow-up.
- No live deployment, native compiler exploit run, Windows/Linux packaged test,
  or claim of complete security certification is included. CI configuration,
  commits, and pushes are outside this change.

## Local Verification

- Full coverage run: 147 test files passed; 11,759 tests passed and one skipped.
- Existing coverage thresholds passed: 80.94% lines, 79.05% statements,
  83.93% functions, and 69.25% branches within the configured coverage scope.
- Production build, TypeScript checks, supply-chain checks, and the isolated
  Electron startup smoke test passed. Lint passed with existing warnings.
- `npm audit` reported zero known dependency vulnerabilities.
- No CI files, commits, pushes, or deployed services were changed.

## Protocol References

- [Yjs sync protocol and read-only enforcement](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)
- [Electron safeStorage backend behavior](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)
