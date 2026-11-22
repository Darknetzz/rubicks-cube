# Changelog

## [v1.0.0] - 2026-11-22

First release.

- Configurable NxN Rubik's cube in the browser: free trackball camera, drag to turn layers, undo/redo, timer, save/load and share links.
- Colour schemes: Western, Japanese (including mirrored), custom; paint mode to copy a real cube.
- Real-cube mode: MCP server that tracks a physical 3×3 cube, solves it (optimal IDA*, then Kociemba), teaches the beginner method stage by stage, and syncs the page live with next-move arrows.
- Multiple cubes on one server, each picked by a code.
- Docker image: `darknetz/rubiks-cube` on Docker Hub and `ghcr.io/darknetzz/rubiks-cube` on GHCR.
