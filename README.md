# Rubik's Cube

A configurable NxN (2×2 to 12×12) cube you can solve in the browser. It uses plain ES modules and Three.js from a CDN, with no build step.

## Run

ES modules don't load over `file://`, so serve the folder:

```sh
npm start              # npx serve .
# or: python -m http.server
```

## Features

- Cube size, turn speed, scramble length, sticker/body/background colours and key bindings, all saved in localStorage
- Drag a sticker to turn its layer; drag the background to orbit
- Keyboard notation: `R L U D F B M E S x y z`, Shift for counter-clockwise, a number prefix for inner layers (`3` then `R` → `3R`)
- Text input for algorithms (`R U R' U'`, `2Rw`, `r`, `M2`, …)
- Timer and move counter that start after a scramble and stop when the cube is solved
- Undo, and an auto-Solve that plays back the inverse of the scramble plus your moves

## Test

```sh
npm test
```
