extends Node2D

const PLAYER_SCENE := preload("res://scenes/player.tscn")

func _ready() -> void:
	_setup_input()
	_build_level()
	var player = PLAYER_SCENE.instantiate()
	player.position = Vector2(110, 390)
	add_child(player)
	_add_hud()

func _setup_input() -> void:
	_add_key_action("move_left", [KEY_A, KEY_LEFT])
	_add_key_action("move_right", [KEY_D, KEY_RIGHT])
	_add_key_action("jump", [KEY_SPACE, KEY_W, KEY_UP])

func _add_key_action(action_name: String, keys: Array) -> void:
	if not InputMap.has_action(action_name):
		InputMap.add_action(action_name)
	for key in keys:
		var event := InputEventKey.new()
		event.keycode = key
		InputMap.action_add_event(action_name, event)

func _build_level() -> void:
	# Temporary test platforms. We'll replace these with recreated original levels.
	_add_platform(Vector2(480, 510), Vector2(1100, 60), Color("#477d42"))
	_add_platform(Vector2(310, 405), Vector2(190, 22), Color("#69a84e"))
	_add_platform(Vector2(570, 330), Vector2(180, 22), Color("#69a84e"))
	_add_platform(Vector2(810, 250), Vector2(180, 22), Color("#69a84e"))
	queue_redraw()

func _add_platform(at: Vector2, dimensions: Vector2, tint: Color) -> void:
	var body := StaticBody2D.new()
	body.position = at
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = dimensions
	collision.shape = shape
	body.add_child(collision)
	var visual := Polygon2D.new()
	visual.polygon = PackedVector2Array([
		Vector2(-dimensions.x / 2, -dimensions.y / 2),
		Vector2(dimensions.x / 2, -dimensions.y / 2),
		Vector2(dimensions.x / 2, dimensions.y / 2),
		Vector2(-dimensions.x / 2, dimensions.y / 2)
	])
	visual.color = tint
	body.add_child(visual)
	add_child(body)

func _add_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var title := Label.new()
	title.text = "FROG JUMPER  •  GODOT REBUILD"
	title.position = Vector2(24, 18)
	title.add_theme_font_size_override("font_size", 20)
	title.add_theme_color_override("font_color", Color("#ffffff"))
	layer.add_child(title)
	var help := Label.new()
	help.text = "A / D or ← / →  Move     SPACE / W / ↑  Jump"
	help.position = Vector2(24, 48)
	help.add_theme_font_size_override("font_size", 15)
	help.add_theme_color_override("font_color", Color("#ffffff"))
	layer.add_child(help)

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Vector2(2200, 1200)), Color("#77bce8"))
	# Soft clouds for a cheerful placeholder backdrop.
	for cloud_x in [170, 500, 850, 1120]:
		var cloud_y := 115.0 + float(cloud_x % 3) * 24.0
		draw_circle(Vector2(cloud_x, cloud_y), 27, Color("#eaf8ff"))
		draw_circle(Vector2(cloud_x + 27, cloud_y - 8), 34, Color("#eaf8ff"))
		draw_circle(Vector2(cloud_x + 58, cloud_y), 25, Color("#eaf8ff"))
