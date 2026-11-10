use wasm_bindgen::prelude::*;

/// Calculate one fixed-timestep movement step for the player.
///
/// The browser still owns collision detection, platform clamping, jump timing,
/// rendering, input, and all game rules. This function only performs the
/// numerical integration that used to run directly in JavaScript.
///
/// The returned Float64Array contains:
/// [next_x, next_y, horizontal_velocity, next_vertical_velocity]
#[wasm_bindgen]
pub fn step_player_motion(
    x: f64,
    y: f64,
    vertical_velocity: f64,
    axis: f64,
    dt: f64,
    speed: f64,
    gravity: f64,
    max_fall_speed: f64,
) -> Box<[f64]> {
    let horizontal_velocity = axis * speed;
    let next_x = x + horizontal_velocity * dt;

    let next_vertical_velocity =
        (vertical_velocity + gravity * dt).min(max_fall_speed);
    let next_y = y + next_vertical_velocity * dt;

    vec![
        next_x,
        next_y,
        horizontal_velocity,
        next_vertical_velocity,
    ]
    .into_boxed_slice()
}

#[cfg(test)]
mod tests {
    use super::step_player_motion;

    fn close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn right_input_moves_right_and_applies_gravity() {
        let step = step_player_motion(100.0, 50.0, 0.0, 1.0, 0.1, 300.0, 10.0, 900.0);

        close(step[0], 130.0);
        close(step[1], 50.1);
        close(step[2], 300.0);
        close(step[3], 1.0);
    }

    #[test]
    fn left_input_moves_left() {
        let step = step_player_motion(100.0, 50.0, 0.0, -1.0, 0.1, 300.0, 10.0, 900.0);

        close(step[0], 70.0);
        close(step[2], -300.0);
    }

    #[test]
    fn no_horizontal_input_keeps_horizontal_position() {
        let step = step_player_motion(100.0, 50.0, 0.0, 0.0, 0.1, 300.0, 10.0, 900.0);

        close(step[0], 100.0);
        close(step[2], 0.0);
    }

    #[test]
    fn falling_speed_is_capped() {
        let step = step_player_motion(0.0, 0.0, 895.0, 0.0, 0.1, 300.0, 100.0, 900.0);

        close(step[3], 900.0);
        close(step[1], 90.0);
    }
}
