# Security Policy

## Privacy by design

`dsh-network-settings` runs network checks locally on your machine:

- No network configuration, IP address, Hosts content, proxy address, or
  diagnostic report is uploaded anywhere.
- No telemetry or analytics are collected.
- Diagnostic reports and snapshots are redacted before being written locally:
  API keys, tokens, cookies, `Authorization` / `Proxy-Authorization` values,
  passwords, and URL/proxy credentials are stripped or replaced with `***`.

## Permissions

- Detection and page-open operations never request administrator rights.
- User-scoped changes (WinINet user proxy, WinHTTP user proxy, User
  environment variables, current DSH process) run without UAC.
- Machine-scoped changes request elevation only when you explicitly execute
  that specific operation.
- The plugin never disables TLS verification, never sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, never disables the firewall, never deletes
  virtual adapters, never clears Hosts, and never modifies other Windows
  users.

## Reporting a vulnerability

Please do not open a public issue for suspected security vulnerabilities.
Contact the maintainers privately and include:

- affected version(s)
- steps to reproduce
- impact
- suggested fix (optional)

We will acknowledge within 7 days and publish a fix with credit after it is
released.
