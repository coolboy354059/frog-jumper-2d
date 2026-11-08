# Frog Jumper — Godot rebuild

This folder contains the separate Godot version of Frog Jumper. The original browser game remains in the repository root and is not replaced by this prototype.

## Open the project

1. Install **Godot 4 Standard** (not the .NET build).
2. Open Godot Project Manager.
3. Choose **Import**.
4. Select this folder's `project.godot` file.
5. Open the project and press **F6** only if the main scene is selected, or press **F6** after opening `scenes/main.tscn`. Press **F6** to run the current scene; use **F6** after selecting the main scene, or set it as the project's main scene and press **F6**. Press **F6** runs current scene; **F5** runs the project.

## Current prototype

- Red placeholder Froggy drawn in code.
- Basic left/right movement and jumping.
- A few temporary platforms.
- Keyboard controls: A/D or arrow keys to move; Space/W/Up to jump.
- Fall reset to the starting point.

## Next work

This is only the first technical prototype, not a recreation of all original game features yet. Next: compare the original game's visuals and physics, refine Froggy's appearance and animation, recreate the level layout, then add coins, enemies, menus, game modes, saving, touch controls, and browser export testing.

## Web target

The project is configured with the Compatibility renderer for broad platform support. A Web export still requires matching Godot export templates and the Godot Web export preset. Test the exported build in a browser before treating mobile web support as complete.
