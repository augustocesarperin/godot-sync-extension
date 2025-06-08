# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.7] - 2025-06-08
### Changed
- Converted UI to a standalone JavaScript app, fixing critical loading and responsiveness bugs.
- Implemented a sequential queue for file sync, improving reliability during rapid changes.
- Added session persistence to save user settings (folders and extensions).

## [0.2.5] - 2025-05-11
### Changed
- Updated extension description on VS Code Marketplace.
### Fixed
- Fixed an issue in the user interface (WebView) where buttons and the log area were not found correctly.
- DOM element IDs in the WebView script (`main.js`) were aligned with the dynamically generated HTML.
- Removed excessive console logs.

## [0.2.0]
### Changed
- Optimized initial synchronization.
- Added UI warning about one-way synchronization.
- Improved error handling.


