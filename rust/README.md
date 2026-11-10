# Frog Jumper Rust experiment

This is a small hybrid Rust + WebAssembly experiment for the existing Frog Jumper game.

## What Rust does

Rust currently calculates one player's numeric movement step:

- horizontal velocity from the left/right input axis;
- horizontal position integration;
- gravity and the maximum falling speed;
- vertical position integration.

The existing JavaScript game remains responsible for everything else: input, jump buffering, coyote time, collision detection, platform movement, clamping, coins, enemies, menus, rendering, sound, and multiplayer. This keeps the experiment small and makes it easy to compare the old JavaScript behavior with the Rust calculation.

If the WebAssembly package is missing or cannot load, the game automatically uses its original JavaScript movement calculation.

## Build on Windows

Install the stable Rust toolchain from the official Rust installation instructions, then open a terminal in the repository folder and run:

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
cargo test --manifest-path rust/Cargo.toml
wasm-pack build rust --target web --release
```

The last command creates `rust/pkg/`. The game loads `rust/pkg/frog_jumper_rust.js` and its matching WebAssembly file when the package is available.

## Run the website locally

Serve the repository folder over HTTP (do not open the HTML file directly, because browser ES-module loading requires a local web server). For example, when Python is installed:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000/` in a desktop browser.

## Manual GitHub Actions build

The `Build Rust WebAssembly experiment` workflow can be started manually from the Actions tab while this branch is selected. It runs the Rust unit tests, builds the browser package, and uploads `rust/pkg/` as a workflow artifact.

## Important experiment rule

WebAssembly is not automatically faster for a tiny calculation. Calling across the JavaScript/WebAssembly boundary and returning a new typed array has a cost. This branch is for learning and measurement; keep the Rust version only if testing shows that it is useful and the movement stays identical.
