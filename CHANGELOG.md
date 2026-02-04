# Changelog

## [Unreleased]

### Added

- Added OpenSandbox integration hooks (internal sandbox routes, code interpreter plugin, and OpenSandbox config entry).
- Added sandbox reuse/teardown helpers to enable shared sessions and explicit termination.

### Changed

- Updated skills API docs (runtime enum, risk_level values, env_requirements keys, type wording).
- Skill runtime execution now reuses sandboxes per session and cleans prior workspace before cloning.

### Fixed

- Fixed OpenSandbox manager initialization, session isolation, and internal sandbox error handling.
