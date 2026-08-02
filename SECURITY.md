# Security Policy

## Scope

Bootstrap Grid Visualizer is an HTML-only tool. It reads the template you open
and writes changes back to that document through VS Code's edit API. It does
**not** execute your project's code, spawn processes, read outside the open
document, or make any network requests. This narrows the security surface to the
parsing and editing logic itself.

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not in a public issue.

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability). If that is unavailable, open a minimal
issue asking for a private contact channel — without disclosing details — and
we'll follow up.

Please include, where you can, a minimal template or repro and the extension and
VS Code versions. We'll acknowledge the report and keep you posted on a fix.

## Supported versions

Fixes land in the latest release. There is no long-term support branch;
please update to the newest version before reporting.
