# Security policy

## Reporting

duang is currently a private, pre-release repository. Report a vulnerability with a **sanitized
issue in this private repository** and request maintainer triage. Include the affected commit,
OS/Electron/FastAgent versions, a minimal reproduction and the observed impact.

Do not attach credentials, private conversations, project contents or an exploit containing such
data. If sensitive material is necessary, ask the maintainers to arrange a separate private transfer
channel before sharing it. Repository issues are visible to every collaborator with read access.

GitHub's private vulnerability-reporting UI is not available for this repository's current setup.
Before making the repository public, maintainers must establish a private reporting channel and
update this policy; ordinary public issues must not become the vulnerability-reporting channel.

## Scope

- Electron main/preload/renderer isolation and navigation boundaries.
- Credential selection, storage access, OAuth handling and accidental disclosure.
- Workspace/scaffolding/registry operations that can overwrite or expose data.
- Session/control isolation, cross-conversation data leakage and unsafe replay of tool work.
- Repository automation that can expose secrets or execute untrusted PR code with write access.

Agents intentionally execute authorized tools and may modify their workspace. Stopping a run is not
rollback, and author-controlled tools are not sandboxed by this client. Distinguish those declared
capabilities from a bypass of duang's trust boundaries.

Security fixes target the current development branch; there are no supported packaged release
lines yet. Vulnerability alerts do not replace review of these boundaries. No CI job should read a
developer's auth file or use real model credentials. If a credential is exposed, revoke/rotate it at
the provider rather than merely deleting it from an issue or Git commit.
