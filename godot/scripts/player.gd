extends CharacterBody2D
## First-pass platformer controller for the Godot rebuild.

const MOVE_SPEED := 300.0
const JUMP_VELOCITY := -540.0
const GRAVITY := 1450.0

var facing := 1.0

func _physics_process(delta: float) -> void:
	var direction := Input.get_axis("move_left", "move_right")
	if direction != 0.0:
		facing = sign(direction)
		velocity.x = direction * MOVE_SPEED
	else:
		velocity.x = move_toward(velocity.x, 0.0, MOVE_SPEED * 8.0 * delta)

	if not is_on_floor():
		velocity.y += GRAVITY * delta
	elif Input.is_action_just_pressed("jump"):
		velocity.y = JUMP_VELOCITY

	if global_position.y > 1100.0:
		global_position = Vector2(110.0, 300.0)
		velocity = Vector2.ZERO

	move_and_slide()
	queue_redraw()

func _draw() -> void:
	# A simple original placeholder drawing of the red starter frog.
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(facing, 1.0))
	draw_ellipse(Vector2(0, -18), Vector2(23, 19), Color("#d93636"))
	draw_circle(Vector2(-13, -34), 9.0, Color("#e94b4b"))
	draw_circle(Vector2(13, -34), 9.0, Color("#e94b4b"))
	draw_circle(Vector2(-13, -35), 5.0, Color.WHITE)
	draw_circle(Vector2(13, -35), 5.0, Color.WHITE)
	draw_circle(Vector2(-12, -35), 2.5, Color("#202020"))
	draw_circle(Vector2(14, -35), 2.5, Color("#202020"))
	draw_arc(Vector2(0, -17), 9.0, 0.25, PI - 0.25, 16, Color("#641d27"), 2.0)
	draw_ellipse(Vector2(-13, -2), Vector2(10, 5), Color("#b92835"))
	draw_ellipse(Vector2(13, -2), Vector2(10, 5), Color("#b92835"))

func draw_ellipse(center: Vector2, radius: Vector2, color: Color) -> void:
	var points := PackedVector2Array()
	for i in range(25):
		var angle := TAU * float(i) / 24.0
		points.append(center + Vector2(cos(angle) * radius.x, sin(angle) * radius.y))
	draw_colored_polygon(points, color)
