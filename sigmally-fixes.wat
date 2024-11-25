(module
	;; 16 pages for input (OgarII's maximum buffer size is 1MiB) + 11 pages for one tab
	(memory (import "main" "memory") 27)

	;; a cell takes up 128 bytes, as so:
	;; id: u32 @ 0x00    rgb: u32 @ 0x04    ox: f64 @ 0x08    oy: f64 @ 0x10
	;; or: f64 @ 0x18    jr: f64 @ 0x20    nx: f64 @ 0x28    ny: f64 @ 0x30
	;; nr: f64 @ 0x38    updated: f64 @ 0x40    born: f64 @ 0x48    dead_at: f64 @ 0x50
	;; dead_to: u32 @ 0x58    name_ptr: u32 @ 0x5c    skin_ptr: u32 @ 0x60    clan_ptr: u32 @ 0x64
	;; jagged: u8 @ 0x68    sub: u8 @ 0x69
	;;
	;; overall, 70 bytes. the other 58 (wasteful...) are only for padding
	;;
	;; some semantics:
	;; - dead_at is infinity if not dead
	;; - dead_to is zero if not dead (it's impossible for cells to have an id of 0)

	(func $settings.draw_delay (import "settings" "draw_delay") (result f64))
	(func $string.to_ref (import "string" "to_ref") (param $from i32) (param $to i32) (result i32))

	(global $tab.count (mut i32) (i32.const 1))
	(global $tab.max_cells (mut i32) (i32.const 1024))
	(global $tab.max_pellets (mut i32) (i32.const 4096))
	(global $tab.width_cells (mut i32) (i32.const 0x2_0000))
	(global $tab.width_misc (mut i32) (i32.const 0x1_0000))
	(global $tab.width_pellets (mut i32) (i32.const 0x8_0000))
	(global $tab.width_space (mut i32) (i32.const 0x0b_0000)) ;; sum of the three widths, must be a multiple of 0x1_0000



	;; returns a pointer to a fresh cell slot for the given $tab, or zero if not enough space
	(func $cell.allocate (export "cell.allocate") (param $tab i32) (param $is_pellet i32) (result i32)
		(local $base i32) (local $length_ptr i32) (local $length i32)

		;; $base = 0x10_0000 + ($tab.width_space * $tab)
		(local.set $base
			(i32.add
				(i32.const 0x10_0000)
				(i32.mul (global.get $tab.width_space) (local.get $tab))))

		;; $length_ptr = ($base + $tab.width_cells) + ($tab.width_pellets + (is_pellet ? 0 : 4))
		(local.set $length_ptr
			(i32.add
				(i32.add (local.get $base) (global.get $tab.width_cells))
				(i32.add
					(global.get $tab.width_pellets)
					(select (i32.const 0) (i32.const 4) (local.get $is_pellet)))))

		;; $length_val = load($length_ptr)
		(local.set $length (i32.load (local.get $length_ptr)))

		;; if $length >= (is_pellet ? tab.max_pellets : tab.max_cells):
		(i32.ge_u
			(local.get $length)
			(select (global.get $tab.max_pellets) (global.get $tab.max_cells) (local.get $is_pellet)))
		if
			;; there is not enough space, return zero
			(return (i32.const 0))
		end

		;; push as cell_ptr: $base + (is_pellet ? 0 : $tab.width_pellets) + (0x80 * $length)
		(i32.add
			(i32.add
				(local.get $base)
				(select (i32.const 0) (global.get $tab.width_pellets) (local.get $is_pellet)))
			(i32.mul (i32.const 0x80) (local.get $length)))

		;; store($length_ptr, $length + 1)
		(i32.store
			(local.get $length_ptr)
			(i32.add (local.get $length) (i32.const 1)))

		;; return top of stack (cell_ptr)
	)



	;; returns a pointer to the cell matching the given id, or 0 if not found
	(func $cell.by_id (export "cell.by_id") (param $tab i32) (param $id i32) (param $is_pellet i32) (result i32)
		(local $cell_id i32) (local $cell_ptr i32)

		;; $cell_ptr = 0x10_0000 + (($tab.width_space * $tab) + (is_pellet ? 0 : $tab.width_pellets))
		(local.set $cell_ptr
			(i32.add
				(i32.const 0x10_0000)
				(i32.add
					(i32.mul (global.get $tab.width_space) (local.get $tab))
					(select (i32.const 0) (global.get $tab.width_pellets) (local.get $is_pellet)))))

		loop $loop
			;; $cell_id = load($cell_ptr)
			(local.set $cell_id
				(i32.load (local.get $cell_ptr)))
			;; if $cell_id == $id:
			(i32.eq (local.get $cell_id) (local.get $id))
			if
				;; found the cell pointer, return it
				(return (local.get $cell_ptr))
			end

			;; if $cell_id == 0:
			(i32.eqz (local.get $cell_id))
			if
				;; reached the end of the cell space
				(return (i32.const 0))
			end

			;; $cell_ptr += 128
			(local.set $cell_ptr
				(i32.add (local.get $cell_ptr) (i32.const 128)))

			br $loop
		end

		i32.const 0
	)



	;; creates a brand new cell using the given parameters (in the same order as wsMessage), returns a pointer to it
	;; this function also resizes the tab space if necessary
	;; though still may return 0 if no more memory is left
	;; this assumes a cell with this id does not exist (otherwise it would be updated inline).
	(func $cell.create (export "cell.create") (param $tab i32) (param $now f64) (param $id i32) (param $x f64) (param $y f64) (param $r f64)
		(param $jagged i32) (param $sub i32) (param $clan_ptr i32) (param $rgb i32) (param $skin_ptr i32) (param $name_ptr i32)
		(result i32)
		(local $cell_ptr i32) (local $is_pellet i32)

		;; $is_pellet = (r <= 20)
		(local.set $is_pellet
			(f64.le (local.get $r) (f64.const 20)))

		;; #1: allocate the cell
		;; $cell_ptr = $cell.allocate($tab, $is_pellet)
		(local.set $cell_ptr
			(call $cell.allocate (local.get $tab) (local.get $is_pellet)))

		;; if $cell_ptr == 0:
		(i32.eqz (local.get $cell_ptr))
		if
			;; couldn't allocate; grow the tab space
			;; if $cell.grow_tab_space() == 0:
			(i32.eqz (call $cell.grow_tab_space))
			if
				;; can't allocate more memory.
				(return (i32.const 0))
			end

			;; with tab space just grown, cell.allocate is guaranteed to work
			;; $cell_ptr = $cell.allocate($tab, $is_pellet)
			(local.set $cell_ptr
				(call $cell.allocate (local.get $tab) (local.get $is_pellet)))
		end

		;; #2: initialize
		(i32.store offset=0x00 (local.get $cell_ptr) (local.get $id)) ;; cell.id = id
		(i32.store offset=0x04 (local.get $cell_ptr) (local.get $rgb)) ;; cell.rgb = rgb
		(f64.store offset=0x08 (local.get $cell_ptr) (local.get $x)) ;; cell.ox = x
		(f64.store offset=0x10 (local.get $cell_ptr) (local.get $y)) ;; cell.oy = y
		(f64.store offset=0x18 (local.get $cell_ptr) (local.get $r)) ;; cell.or = r
		(f64.store offset=0x20 (local.get $cell_ptr) (local.get $r)) ;; cell.jr = r
		(f64.store offset=0x28 (local.get $cell_ptr) (local.get $x)) ;; cell.nx = x
		(f64.store offset=0x30 (local.get $cell_ptr) (local.get $y)) ;; cell.ny = y
		(f64.store offset=0x38 (local.get $cell_ptr) (local.get $r)) ;; cell.nr = r
		(f64.store offset=0x40 (local.get $cell_ptr) (local.get $now)) ;; cell.updated = now
		(f64.store offset=0x48 (local.get $cell_ptr) (local.get $now)) ;; cell.born = now
		(f64.store offset=0x50 (local.get $cell_ptr) (f64.const inf)) ;; cell.dead_at = +inf
		(i32.store offset=0x58 (local.get $cell_ptr) (i32.const 0)) ;; cell.dead_to = 0
		(i32.store offset=0x5c (local.get $cell_ptr) (local.get $name_ptr)) ;; cell.name_ptr = name_ptr
		(i32.store offset=0x60 (local.get $cell_ptr) (local.get $skin_ptr)) ;; cell.skin_ptr = skin_ptr
		(i32.store offset=0x64 (local.get $cell_ptr) (local.get $clan_ptr)) ;; cell.clan_ptr = clan_ptr
		(i32.store8 offset=0x68 (local.get $cell_ptr) (local.get $jagged)) ;; cell.jagged = jagged
		(i32.store8 offset=0x69 (local.get $cell_ptr) (local.get $sub)) ;; cell.sub = sub

		;; return $cell_ptr
		local.get $cell_ptr
	)



	;; splices the cell at $cell_ptr, removing it from the cells list
	(func $cell.deallocate (export "cell.deallocate") (param $tab i32) (param $cell_ptr i32) (param $is_pellet i32)
		(local $base i32) (local $last_cell_ptr i32) (local $length_ptr i32) (local $new_length i32)

		;; $base = 0x10_0000 + ($tab.width_space * $tab)
		(local.set $base
			(i32.add
				(i32.const 0x10_0000)
				(i32.mul (global.get $tab.width_space) (local.get $tab))))

		;; $length_ptr = ($base + $tab.width_cells) + ($tab.width_pellets + (is_pellet ? 0 : 4))
		(local.set $length_ptr
			(i32.add
				(i32.add (local.get $base) (global.get $tab.width_cells))
				(i32.add
					(global.get $tab.width_pellets)
					(select (i32.const 0) (i32.const 4) (local.get $is_pellet)))))

		;; $new_length = load($length_ptr) - 1
		(local.set $new_length
			(i32.sub
				(i32.load (local.get $length_ptr))
				(i32.const 1)))

		;; $last_cell_ptr = $base + (is_pellet ? 0 : $tab.width_pellets) + (0x80 * $new_length)
		(local.set $last_cell_ptr
			(i32.add
				(i32.add
					(local.get $base)
					(select (i32.const 0) (global.get $tab.width_pellets) (local.get $is_pellet)))
				(i32.mul (i32.const 0x80) (local.get $new_length))))

		;; copy the last cell into its place
		;; if $cell_ptr != $last_cell_ptr:
		(i32.ne (local.get $cell_ptr) (local.get $last_cell_ptr))
		if
			;; misc.memcpy8($last_cell_ptr, $cell_ptr, 128)
			(call $misc.memcpy8
				(local.get $last_cell_ptr)
				(local.get $cell_ptr)
				(i32.const 128))
		end

		;; set the cell we just popped (last_cell_ptr) to have an id of 0
		;; store($last_cell_ptr, 0)
		(i32.store (local.get $last_cell_ptr) (i32.const 0))

		;; store($length_ptr, $new_length)
		(i32.store (local.get $length_ptr) (local.get $new_length))
	)



	(func $cell.first_cell_ptr (export "cell.first_cell_ptr") (param $tab i32) (result i32)
		;; return 0x10_0000 + (($tab.width_space * $tab) + $tab.width_pellets)
		(i32.add
			(i32.const 0x10_0000)
			(i32.add
				(i32.mul (global.get $tab.width_space) (local.get $tab))
				(global.get $tab.width_pellets)))
	)



	(func $cell.first_pellet_ptr (export "cell.first_pellet_ptr") (param $tab i32) (result i32)
		;; return 0x10_0000 + ($tab.width_space * $tab)
		(i32.add
			(i32.const 0x10_0000)
			(i32.mul (global.get $tab.width_space) (local.get $tab)))
	)



	;; returns a pointer to a cell or pellet with the given $id over the space starting at $cell_ptr,
	;; or zero if it doesn't exist.
	(func $cell.generic_by_id (param $id i32) (param $cell_ptr i32) (result i32)
		(local $cell_id i32)

		loop $loop
			;; $cell_id = load($cell_ptr)
			(local.set $cell_id
				(i32.load (local.get $cell_ptr)))
			;; if $cell_id == $id:
			(i32.eq (local.get $cell_id) (local.get $id))
			if
				;; found the cell pointer, return it
				(return (local.get $cell_ptr))
			end

			;; if $cell_id == 0:
			(i32.eqz (local.get $cell_id))
			if
				;; reached the end of the cell space
				(return (i32.const 0))
			end

			;; $cell_ptr += 128
			(local.set $cell_ptr
				(i32.add (local.get $cell_ptr) (i32.const 128)))

			br $loop
		end

		i32.const 0
	)



	;; if a tab runs out of cell or pellet slots, all tab spaces should be expanded.
	;; ~doubles the size of all tab spaces and copies data appropriately, or returns 0
	;; if unsuccessful.
	(func $cell.grow_tab_space (export "cell.grow_tab_space") (result i32)
		(local $pages i32) (local $i i32)
		(local $from_base i32) (local $to_base i32)

		;; #1 : ~double the size (grow by the current # of cell and pellet pages)
		;; push as ok: memory.grow(($tab.width_cells + $tab.width_pellets) * $tab.count) >> 16)
		(memory.grow
			(i32.shr_u
				(i32.mul
					(i32.add (global.get $tab.width_cells) (global.get $tab.width_pellets))
					(global.get $tab.count))
				(i32.const 16)))

		;; if ok == -1:
		(i32.eq (i32.const -1))
		if
			;; couldn't allocate more memory, unfortunately
			(return (i32.const 0))
		end

		;; #2 : copy all tab data
		;; $i = $tab.count - 1
		(local.set $i
			(i32.add (global.get $tab.count) (i32.const -1)))
		loop $loop ;; no precondition necessary; tab count is always greater than 0
			;; $from_base = 0x10_0000 + ($tab.width_space * $i)
			(local.set $from_base
				(i32.add
					(i32.const 0x10_0000)
					(i32.mul (global.get $tab.width_space) (local.get $i))))

			;; $to_base = 0x10_0000 + (($tab.width_space * 2) * $i)
			(local.set $to_base
				(i32.add
					(i32.const 0x10_0000)
					(i32.mul
						(i32.mul (global.get $tab.width_space) (i32.const 2))
						(local.get $i))))

			;; copy misc data first
			;; $misc.memcpy8(
			;;     $from_base + ($tab.width_cells + $tab.width_pellets),
			;;     $to_base + ($tab.width_cells + $tab.width_pellets) * 2,
			;;     0x1_0000
			;; )
			(call $misc.memcpy8
				(i32.add
					(local.get $from_base)
					(i32.add
						(global.get $tab.width_cells)
						(global.get $tab.width_pellets)))
				(i32.add
					(local.get $to_base)
					(i32.mul
						(i32.add
							(global.get $tab.width_cells)
							(global.get $tab.width_pellets))
						(i32.const 2)))
				(i32.const 0x1_0000))

			;; copy cell data next
			;; $misc.memcpy8($from_base + $tab.width_pellets, $to_base + $tab.width_pellets * 2, $tab.width_cells)
			(call $misc.memcpy8
				(i32.add
					(local.get $from_base)
					(global.get $tab.width_pellets))
				(i32.add
					(local.get $to_base)
					(i32.mul
						(global.get $tab.width_pellets)
						(i32.const 2)))
				(global.get $tab.width_cells))

			;; copy pellet data last
			;; $misc.memcpy8($from_base, $to_base, $tab.width_pellets)
			(call $misc.memcpy8
				(local.get $from_base)
				(local.get $to_base)
				(global.get $tab.width_pellets))

			;; tee $i -= 1
			(local.tee $i
				(i32.add (local.get $i) (i32.const -1)))
			;; if i >= 0: continue
			(i32.ge_s (i32.const 0))
			br_if $loop
		end

		;; #3 : double and adjust space constants
		;; $tab.max_cells *= 2
		(global.set $tab.max_cells
			(i32.mul (global.get $tab.max_cells) (i32.const 2)))
		;; $tab.max_pellets *= 2
		(global.set $tab.max_pellets
			(i32.mul (global.get $tab.max_pellets) (i32.const 2)))
		;; $tab.width_cells *= 2
		(global.set $tab.width_cells
			(i32.mul (global.get $tab.width_cells) (i32.const 2)))
		;; $tab.width_pellets *= 2
		(global.set $tab.width_pellets
			(i32.mul (global.get $tab.width_pellets) (i32.const 2)))
		;; $tab.width_space = ($tab.width_cells + $tab.width_pellets) + $tab.width_misc
		(global.set $tab.width_space
			(i32.add
				(i32.add (global.get $tab.width_cells) (global.get $tab.width_pellets))
				(global.get $tab.width_misc)))

		;; return 1 when successful
		i32.const 1
	)



	(func $cell.num_cells (export "cell.num_cells") (param $tab i32) (result i32)
		;; return load((0x10_0000 + ($tab.width_space * $tab)) + (($tab.width_pellets + $tab.width_cells) + 4))
		(i32.load
			(i32.add
				(i32.add
					(i32.const 0x10_0000)
					(i32.mul (global.get $tab.width_space) (local.get $tab)))
				(i32.add
					(i32.add (global.get $tab.width_pellets) (global.get $tab.width_cells))
					(i32.const 4))))
	)



	(func $cell.num_pellets (export "cell.num_pellets") (param $tab i32) (result i32)
		;; return load((0x10_0000 + ($tab.width_space * $tab)) + ($tab.width_pellets + $tab.width_cells))
		(i32.load
			(i32.add
				(i32.add
					(i32.const 0x10_0000)
					(i32.mul (global.get $tab.width_space) (local.get $tab)))
				(i32.add (global.get $tab.width_pellets) (global.get $tab.width_cells))))
	)



	;; returns the animation alpha for xyr for a given cell
	(func $cell.xyr_alpha (export "cell.xyr_alpha") (param $cell_ptr i32) (param $now f64) (param $draw_delay f64) (result f64)
		;; push (now - cell.updated) / draw_delay
		(f64.div
			(f64.sub
				(local.get $now)
				(f64.load offset=0x40 (local.get $cell_ptr)))
			(local.get $draw_delay))
		;; return min(max(pop, 0), 1)
		(f64.min
			(f64.max (f64.const 0))
			(f64.const 1))
	)



	;; memcpy, 8 bytes at a time. size must be a nonzero multiple of 8
	(func $misc.memcpy8 (export "misc.memcpy8") (param $from i32) (param $to i32) (param $size i32)
		(local $from_end i32)

		;; $from_end = $from + $size
		(local.set $from_end
			(i32.add (local.get $from) (local.get $size)))

		loop $loop
			;; store($to, load($from))
			(i64.store (local.get $to) (i64.load (local.get $from)))
			;; $to += 8
			(local.set $to (i32.add (local.get $to) (i32.const 8)))
			;; tee $from += 8
			(local.tee $from (i32.add (local.get $from) (i32.const 8)))
			;; if from_local < $from_end: continue
			(i32.lt_u (local.get $from_end))
			br_if $loop
		end
	)



	;; finds the first byte starting from $o that is zero, and returns the address after it
	;; used to find the next byte after a zero-terminated string
	(func $misc.until_zero (export "misc.until_zero") (param $o i32) (result i32)
		loop $loop
			;; push byte: read u8 at $o
			(i32.load8_u (local.get $o))
			;; $o += 1
			(local.set $o (i32.add (local.get $o) (i32.const 1)))
			;; if byte != 0: continue
			br_if $loop
		end

		local.get $o
	)



	;; generates UBO contents for rendering the given cell, returns a pointer to the start of that data
	(func $render.cell_ubo (export "render.cell_ubo") (param $cell_ptr i32) (param $is_pellet i32) (param $now f64)
		(param $draw_delay f64)
		(result i32)
		(local $alpha f64) (local $old f64) (local $new f64) (local $ubo_ptr i32) (local $xyr_alpha f64)

		;; $ubo_ptr = 0xf_ff80
		(local.set $ubo_ptr (i32.const 0xf_ff80))

		;; $alpha = (now - cell.born) / 100
		(local.set $alpha
			(f64.div
				(local.get $now)
				(f64.load offset=0x48 (local.get $cell_ptr)))
			(f64.const 100))

		;; if cell.dead_at != inf
		(f64.ne
			(f64.load offset=0x50 (local.get $cell_ptr))
			(f64.const inf))
		if
			;; $alpha = min($alpha, 1 - (($now - cell.dead_at) / 100))
			(local.set $alpha
				(f64.min
					(local.get $alpha)
					(f64.sub
						(f64.const 1)
						(f64.div
							(f64.sub
								(local.get $now)
								(f64.load offset=0x50 (local.get $cell_ptr)))
							(f64.const 100)))))
		end

		;; ubo.cell_alpha = min(max($alpha as f32, 0), 1)
		(f32.store offset=0x58 (local.get $ubo_ptr)
			(f32.min
				(f32.max
					(f32.demote_f64 (local.get $alpha)) (f32.const 0))
				(f32.const 1)))

		;; $xyr_alpha = ($now - cell.updated) / $draw_delay
		(local.set $xyr_alpha
			(f64.div
				(f64.sub
					(local.get $now)
					(f64.load offset=0x40 (local.get $cell_ptr)))
				(local.get $draw_delay)))

		;; $xyr_alpha = min(max($xyr_alpha, 0), 1)
		(local.set $xyr_alpha
			(f64.min
				(f64.max (local.get $xyr_alpha) (f64.const 0))
				(f64.const 1)))

		;; TODO: nx and ny should be from deadTo

		;; old = cell.ox
		(local.set $old
			(f64.load offset=0x08 (local.get $cell_ptr)))
		;; new = cell.nx
		(local.set $new
			(f64.load offset=0x28 (local.get $cell_ptr)))
		;; ubo.cell_xy.x = (old + ((new - old) * xyr_alpha)) as f32
		(f32.store offset=0x08 (local.get $ubo_ptr)
			(f32.demote_f64
				(f64.add
					(local.get $old)
					(f64.mul
						(f64.sub (local.get $new) (local.get $old))
						(local.get $xyr_alpha)))))

		;; old = cell.oy
		(local.set $old
			(f64.load offset=0x10 (local.get $cell_ptr)))
		;; new = cell.ny
		(local.set $new
			(f64.load offset=0x30 (local.get $cell_ptr)))
		;; ubo.cell_xy.y = (old + ((new - old) * xyr_alpha)) as f32
		(f32.store offset=0x0c (local.get $ubo_ptr)
			(f32.demote_f64
				(f64.add
					(local.get $old)
					(f64.mul
						(f64.sub (local.get $new) (local.get $old))
						(local.get $xyr_alpha)))))

		;; TODO: no jelly physics assumed
		;; old = cell.or
		(local.set $old
			(f64.load offset=0x18 (local.get $cell_ptr)))
		;; new = cell.nr
		(local.set $new
			(f64.load offset=0x38 (local.get $cell_ptr)))
		;; new = old + ((new - old) * xyr_alpha)
		(local.set $new
			(f64.add
				(local.get $old)
				(f64.mul
					(f64.sub (local.get $new) (local.get $old))
					(local.get $xyr_alpha))))
		;; ubo.cell_radius = $new as f32
		(f32.store offset=0x00 (local.get $ubo_ptr)
			(f32.demote_f64 (local.get $new)))
		;; ubo.cell_radius_skin = $new as f32
		(f32.store offset=0x04 (local.get $ubo_ptr)
			(f32.demote_f64 (local.get $new)))

		;; ubo.cell_outline_subtle_color.a = 0
		(f32.store offset=0x2c (local.get $ubo_ptr) (f32.const 0))
		;; ubo.cell_outline_unsplittable_color.a = 0
		(f32.store offset=0x3c (local.get $ubo_ptr) (f32.const 0))
		;; ubo.cell_outline_active_color.a = 0
		(f32.store offset=0x4c (local.get $ubo_ptr) (f32.const 0))
		;; (TODO) ubo.cell_outline_active_thickness = $active_thickness
		;; (f32.store offset=0x50 (local.get $ubo_ptr) (local.get $active_thickness))
		;; ubo.cell_skin_enabled = 0 (NO SKIN SUPPORT YET)
		(i32.store offset=0x54 (local.get $ubo_ptr) (i32.const 0))

		;; if cell.jagged:
		(i32.load8_u offset=0x68 (local.get $cell_ptr))
		if
			;; set to a temporary color, because no skins

			;; ubo.cell_color.r = 0.8
			(f32.store offset=0x10 (local.get $ubo_ptr) (f32.const 0.8))
			;; ubo.cell_color.g = 0.5
			(f32.store offset=0x14 (local.get $ubo_ptr) (f32.const 0.5))
			;; ubo.cell_color.b = 0.5
			(f32.store offset=0x18 (local.get $ubo_ptr) (f32.const 0.5))
			;; ubo.cell_color.a = 0.5
			(f32.store offset=0x1c (local.get $ubo_ptr) (f32.const 0.5))

			;; return early
			(return (local.get $ubo_ptr))
		end

		;; TODO: no custom food or cell colors
		;; ubo.cell_color.r = (cell.Rgb as f32) / 255
		(f32.store offset=0x10 (local.get $ubo_ptr)
			(f32.div
				(f32.convert_i32_u
					(i32.load8_u offset=0x04 (local.get $cell_ptr)))
				(f32.const 255)))
		;; ubo.cell_color.g = (cell.rGb as f32) / 255
		(f32.store offset=0x14 (local.get $ubo_ptr)
			(f32.div
				(f32.convert_i32_u
					(i32.load8_u offset=0x05 (local.get $cell_ptr)))
				(f32.const 255)))
		;; ubo.cell_color.b = (cell.rgB as f32) / 255
		(f32.store offset=0x18 (local.get $ubo_ptr)
			(f32.div
				(f32.convert_i32_u
					(i32.load8_u offset=0x06 (local.get $cell_ptr)))
				(f32.const 255)))
		;; ubo.cell_color.a = 1
		(f32.store offset=0x1c (local.get $ubo_ptr) (f32.const 1))

		;; TODO: no subtle outlines

		;; TODO: no unsplittable outlines

		;; TODO: no active outlines

		(return (local.get $ubo_ptr))
	)



	;; creates memory for a new tab
	(func $tab.allocate (export "tab.allocate") (result i32)
		;; #1 : grow memory
		;; ok = memory.grow($tab.width_space >> 16)
		(memory.grow
			(i32.shr_u (global.get $tab.width_space) (i32.const 16)))
		;; if ok == -1:
		(i32.eq (i32.const -1))
		if
			;; couldn't allocate more memory, unfortunately
			(return (i32.const 0))
		end

		;; return 1 when successful
		i32.const 1
	)



	;; deletes *all* cells
	(func $tab.clear (export "tab.clear") (param $tab i32)
		(local $cell_ptr i32)

		;; start with deleting pellets
		;; $cell_ptr = 0x10_0000 + ($tab.width_space * $tab)
		(local.set $cell_ptr
			(i32.add
				(i32.const 0x10_0000)
				(i32.mul (global.get $tab.width_space) (local.get $tab))))
		block $block1 loop $loop1
			;; if cell.id == 0: break
			(i32.eqz
				(i32.load offset=0x00 (local.get $cell_ptr)))
			br_if $block1

			;; cell.id = 0
			(i32.store offset=0x00 (local.get $cell_ptr) (i32.const 0))

			;; $cell_ptr += 128
			(local.set $cell_ptr (i32.add (local.get $cell_ptr) (i32.const 128)))

			;; continue
			br $loop1
		end end

		;; then, delete cells
		;; $cell_ptr = 0x10_0000 + (($tab.width_space * $tab) + $tab.width_pellets)
		(local.set $cell_ptr
			(i32.add
				(i32.const 0x10_0000)
				(i32.add
					(i32.mul (global.get $tab.width_space) (local.get $tab))
					(global.get $tab.width_pellets))))
		block $block2 loop $loop2
			;; if cell.id == 0: break
			(i32.eqz
				(i32.load offset=0x00 (local.get $cell_ptr)))
			br_if $block2

			;; cell.id = 0
			(i32.store offset=0x00 (local.get $cell_ptr) (i32.const 0))

			;; $cell_ptr += 128
			(local.set $cell_ptr (i32.add (local.get $cell_ptr) (i32.const 128)))

			;; continue
			br $loop2
		end end

		;; set pellets length to 0
		;; store(0x10_0000 + (($tab.width_space * $tab) + ($tab.width_pellets + $tab.width_cells)), 0)
		(i32.store
			(i32.add
				(i32.const 0x10_0000)
				(i32.add
					(i32.mul (global.get $tab.width_space) (local.get $tab))
					(i32.add (global.get $tab.width_pellets) (global.get $tab.width_cells))))
			(i32.const 0))
		;; set cells length to 0
		;; store(0x10_0000 + (($tab.width_space * $tab) + (($tab.width_pellets + $tab.width_cells) + 4)), 0)
		(i32.store
			(i32.add
				(i32.const 0x10_0000)
				(i32.add
					(i32.mul (global.get $tab.width_space) (local.get $tab))
					(i32.add
						(i32.add (global.get $tab.width_pellets) (global.get $tab.width_cells))
						(i32.const 4))))
			(i32.const 0))
	)



	;; deletes all cells that died more than 300ms ago (i.e. are now totally invisible)
	(func $tab.cleanup (export "tab.cleanup") (param $tab i32) (param $now f64)
		(local $cell_ptr i32)

		;; start with cleaning up pellets
		;; $cell_ptr = 0x10_0000 + ($tab.width_space * $tab)
		(local.set $cell_ptr
			(i32.add
				(i32.const 0x10_0000)
				(i32.mul (global.get $tab.width_space) (local.get $tab))))

		block $block1 loop $loop1
			;; if load($cell_ptr + cell::id) == 0: break
			(i32.eqz
				(i32.load (local.get $cell_ptr)))
			br_if $block1

			;; if load($cell_ptr + cell::dead_at) + 300 < now
			(f64.lt
				(f64.add
					(f64.load offset=0x50 (local.get $cell_ptr))
					(f64.const 300))
				(local.get $now))
			if
				;; cell.deallocate($tab, $cell_ptr, yes is a pellet)
				(call $cell.deallocate
					(local.get $tab)
					(local.get $cell_ptr)
					(i32.const 1))
				;; don't increment cell_ptr because the pellet there was just swapped
			else
				(local.set $cell_ptr
					(i32.add (local.get $cell_ptr) (i32.const 128)))
			end

			;; continue
			br $loop1
		end end

		;; now clean up cells
		;; $cell_ptr = (0x10_0000 + $tab.width_pellets) + ($tab.width_space * $tab)
		(local.set $cell_ptr
			(i32.add
				(i32.add (i32.const 0x10_0000) (global.get $tab.width_pellets))
				(i32.mul (global.get $tab.width_space) (local.get $tab))))

		block $block2 loop $loop2
			;; if load($cell_ptr + cell::id) == 0: break
			(i32.eqz
				(i32.load (local.get $cell_ptr)))
			br_if $block2

			;; if load($cell_ptr + cell::dead_at) + 300 < now
			(f64.lt
				(f64.add
					(f64.load offset=0x50 (local.get $cell_ptr))
					(f64.const 300))
				(local.get $now))
			if
				;; cell.deallocate($tab, $cell_ptr, not a pellet)
				(call $cell.deallocate
					(local.get $tab)
					(local.get $cell_ptr)
					(i32.const 0))
				;; don't increment cell_ptr because the cell there was just swapped
			else
				(local.set $cell_ptr
					(i32.add (local.get $cell_ptr) (i32.const 128)))
			end

			;; continue
			br $loop2
		end end
	)



	;; sorts all cells (not pellets) in-place in a tab according to their current radius, from smallest to biggest
	;; we use insertion sort here, as the tab is almost always sorted (or very close to being sorted), so it
	;; usually performs at O(n)
	(func $tab.sort (export "tab.sort") (param $tab i32) (param $now f64)
		(local $alpha f64) (local $cell_base i32) (local $draw_delay f64) (local $length i32) (local $i i32) (local $j i32)
		(local $i_radius f64) (local $i_id i32)

		;; $cell_base = 0x10_0000 + (($tab.width_space * $tab) + ($tab.width_pellets))
		(local.set $cell_base
			(i32.add
				(i32.const 0x10_0000)
				(i32.add
					(i32.mul (global.get $tab.width_space) (local.get $tab))
					(global.get $tab.width_pellets))))

		;; $length = $cell.num_cells($tab)
		(local.set $length
			(call $cell.num_cells (local.get $tab)))

		;; i = 1
		(local.set $i (i32.const 1))
		block $block1 loop $loop1
			;; if $i >= $length: break
			(i32.ge_u (local.get $i) (local.get $length))
			br_if $block1

			;; copy current cell somewhere else (end of temp buffer)
			;; $misc.memcpy8($cell_base + ($i * 128), 0xf_ff80, 128)
			(call $misc.memcpy8
				(i32.add
					(local.get $cell_base)
					(i32.mul (local.get $i) (i32.const 128)))
				(i32.const 0xf_ff80)
				(i32.const 128))

			;; $i_id = cell[i].id
			(local.set $i_id
				(i32.load offset=0x00
					(i32.add
						(local.get $cell_base)
						(i32.mul (local.get $i) (i32.const 128)))))

			;; $i_radius = cell[i].nr
			(local.set $i_radius
				(f64.load offset=0x38
					(i32.add
						(local.get $cell_base)
						(i32.mul (local.get $i) (i32.const 128)))))

			;; j = i - 1
			(local.set $j
				(i32.sub (local.get $i) (i32.const 1)))

			block $block2 loop $loop2
				;; if j < 0: break
				(i32.lt_s (local.get $j) (i32.const 0))
				br_if $block2

				;; if (cell[j].nr < $i_radius): break, placed correctly
				;; TODO: consider cell IDs, xyr alpha
				(f64.lt
					(f64.load offset=0x38
						(i32.add
							(local.get $cell_base)
							(i32.mul (local.get $j) (i32.const 128))))
					(local.get $i_radius))
				br_if $block2

				;; if (cell[j].nr == $i_radius and cell[j].id < $i_id): break, placed correctly
				(i32.and
					(f64.eq
						(f64.load offset=0x38
							(i32.add
								(local.get $cell_base)
								(i32.mul (local.get $j) (i32.const 128))))
						(local.get $i_radius))
					(i32.lt_u
						(i32.load offset=0x00
							(i32.add
								(local.get $cell_base)
								(i32.mul (local.get $j) (i32.const 128))))
						(local.get $i_id)))
				br_if $block2

				;; cell[j + 1] = cell[j]
				;; $misc.memcpy8(&cell[j], &cell[j + 1], 128)
				(call $misc.memcpy8
					(i32.add
						(local.get $cell_base)
						(i32.mul (local.get $j) (i32.const 128)))
					(i32.add
						(local.get $cell_base)
						(i32.mul 
							(i32.add (local.get $j) (i32.const 1))
							(i32.const 128)))
					(i32.const 128))

				;; j -= 1
				(local.set $j (i32.sub (local.get $j) (i32.const 1)))

				br $loop2
			end end

			;; cell[j + 1] = current cell
			;; $misc.memcpy8(0xf_ff80, &cell[j + 1], 128)
			(call $misc.memcpy8
				(i32.const 0xf_ff80)
				(i32.add
					(local.get $cell_base)
					(i32.mul 
						(i32.add (local.get $j) (i32.const 1))
						(i32.const 128)))
				(i32.const 128))

			;; i += 1
			(local.set $i (i32.add (local.get $i) (i32.const 1)))

			br $loop1
		end end
	)



	;; reads the websocket message stored @ 0x0 and handles all cell updates.
	;; returns 0 if not successful (e.g. not enough space)
	(func $ws.handle_update (export "ws.handle_update") (param $tab i32) (param $now f64) (result i32)
		(local $count i32) (local $flags i32) (local $i i32) (local $id1 i32) (local $id2 i32) (local $o i32)
		(local $x f64) (local $y f64) (local $r f64) (local $jagged i32) (local $sub i32) (local $cell_ptr i32)
		(local $name_ref i32) (local $skin_ref i32) (local $clan_ref i32) (local $rgb i32)
		(local $is_pellet i32) (local $alpha f64) (local $inv_alpha f64)
		(local $draw_delay f64)

		;; $draw_delay = $settings.draw_delay()
		(local.set $draw_delay (call $settings.draw_delay))

		;; $o = 1
		(local.set $o (i32.const 1))

		;; #1: kills (TODO)
		;; $count = read u16 at $o
		(local.set $count
			(i32.load16_u (local.get $o)))
		;; $o += 2
		(local.set $o (i32.add (local.get $o) (i32.const 2)))
		block $block1 loop $loop1
			;; if $count == 0: break
			(i32.eqz (local.get $count))
			br_if $block1

			;; $count -= 1
			(local.set $count (i32.sub (local.get $count) (i32.const 1)))

			;; $id1 (killer) = read u32 at $o
			(local.set $id1 (i32.load (local.get $o)))
			;; $o += 4
			(local.set $o (i32.add (local.get $o) (i32.const 4)))

			;; $id2 (killed) = read u32 at $o
			(local.set $id2 (i32.load (local.get $o)))
			;; $o += 4
			(local.set $o (i32.add (local.get $o) (i32.const 4)))

			;; $cell_ptr = $cell.by_id($id2 (killed), yes is pellet)
			(local.set $cell_ptr
				(call $cell.by_id (local.get $tab) (local.get $id2) (i32.const 1)))
			;; if $cell_ptr == 0
			(i32.eqz (local.get $cell_ptr))
			if
				;; $cell_ptr = $cell.by_id($id2 (killed), not a pellet)
				(local.set $cell_ptr
					(call $cell.by_id (local.get $tab) (local.get $id2) (i32.const 0)))

				;; if $cell_ptr == 0: continue
				(i32.eqz (local.get $cell_ptr))
				br_if $loop1
			end

			;; cell.dead_at = now
			(f64.store offset=0x50 (local.get $cell_ptr) (local.get $now))
			;; cell.updated = now
			(f64.store offset=0x40 (local.get $cell_ptr) (local.get $now))
			;; cell.dead_to = $id1
			(i32.store offset=0x58 (local.get $cell_ptr) (local.get $id1))

			;; TODO: manage mine, clanmates, foodEaten

			;; continue
			br $loop1
		end end

		;; #2: adds and updates (TODO)
		block $block2 loop $loop2
			;; $id1 = read u32 at $o
			(local.set $id1
				(i32.load (local.get $o)))
			;; $o += 4
			(local.set $o (i32.add (local.get $o) (i32.const 4)))

			;; if $id1 == 0: break
			(i32.eqz (local.get $id1))
			br_if $block2

			;; $x = read s16 at $o, then cast to f64
			(local.set $x
				(f64.convert_i32_s
					(i32.load16_s (local.get $o))))
			;; $o += 2
			(local.set $o (i32.add (local.get $o) (i32.const 2)))

			;; $y = read s16 at $o, then cast to f64
			(local.set $y
				(f64.convert_i32_s
					(i32.load16_s (local.get $o))))
			;; $o += 2
			(local.set $o (i32.add (local.get $o) (i32.const 2)))

			;; $r = read u16 at $o, then cast to f64 (not an s16)
			(local.set $r
				(f64.convert_i32_u
					(i32.load16_u (local.get $o))))
			;; $o += 2
			(local.set $o (i32.add (local.get $o) (i32.const 2)))

			;; $flags = read u8 at $o
			(local.set $flags (i32.load8_u (local.get $o)))
			;; $jagged = !!($flags & 0x11)
			(local.set $jagged
				(i32.eqz (i32.eqz
					(i32.and (local.get $flags) (i32.const 0x11)))))

			;; skip isUpdate (unused) (1 byte)
			;; skip isPlayer (unused) (1 byte)
			;; $o += 3
			(local.set $o (i32.add (local.get $o) (i32.const 3)))

			;; $sub 
			(local.set $sub
				(i32.eqz (i32.eqz
					(i32.load8_u (local.get $o)))))
			;; $o += 1
			(local.set $o (i32.add (local.get $o) (i32.const 1)))

			;; read clan
			;; $clan_ref = $string.to_ref($o, $o = $misc.until_zero($o))
			(local.set $clan_ref
				(call $string.to_ref
					(local.get $o)
					(local.tee $o
						(call $misc.until_zero (local.get $o)))))

			;; if flags & 0x02:
			(i32.and (local.get $flags) (i32.const 0x02))
			if
				;; align red to be @ 0x04 in the cell
				;; $rgb = (read u8 at $o)
				(local.set $rgb (i32.load8_u (local.get $o)))
				;; $o += 1
				(local.set $o (i32.add (local.get $o) (i32.const 1)))

				;; align green to be @ 0x05 in the cell
				;; $rgb |= (read u8 at $o) << 8
				(local.set $rgb
					(i32.or
						(local.get $rgb)
						(i32.shl
							(i32.load8_u (local.get $o))
							(i32.const 8))))
				;; $o += 1
				(local.set $o (i32.add (local.get $o) (i32.const 1)))

				;; align blue to be @ 0x06 in the cell
				;; $rgb |= (read u8 at $o) << 16
				(local.set $rgb
					(i32.or
						(local.get $rgb)
						(i32.shl
							(i32.load8_u (local.get $o))
							(i32.const 16))))
				;; $o += 1
				(local.set $o (i32.add (local.get $o) (i32.const 1)))
			end

			;; if flags & 0x04:
			(i32.and (local.get $flags) (i32.const 0x04))
			if
				;; read skin
				;; $skin_ref = $string.to_ref($o, $o = $misc.until_zero($o))
				(local.set $skin_ref
					(call $string.to_ref
						(local.get $o)
						(local.tee $o
							(call $misc.until_zero (local.get $o)))))
			end

			;; if flags & 0x08:
			(i32.and (local.get $flags) (i32.const 0x08))
			if
				;; read name
				;; $name_ref = $string.to_ref($o, $o = $misc.until_zero($o))
				(local.set $name_ref
					(call $string.to_ref
						(local.get $o)
						(local.tee $o
							(call $misc.until_zero (local.get $o)))))
			end

			;; create a new player, or update an existing one
			;; $is_pellet = r <= 20
			(local.set $is_pellet (f64.le (local.get $r) (f64.const 20)))
			;; $cell_ptr = $cell.by_id($tab, $id, $r <= 20)
			(local.set $cell_ptr (call $cell.by_id (local.get $tab) (local.get $id1) (local.get $is_pellet)))

			block $create
				;; if cell_ptr != 0:
				local.get $cell_ptr
				if
					;; cell already exists; if it's not dead, then only update it
					;; if cell.dead_at > now: exit $create
					(f64.gt
						(f64.load offset=0x50 (local.get $cell_ptr))
						(local.get $now))
					br_if $create

					;; cell already exists and is dead; deallocate it first before replacing it
					(call $cell.deallocate (local.get $tab) (local.get $cell_ptr) (local.get $is_pellet))
				end

				;; create a new cell
				(call $cell.create
					(local.get $tab) (local.get $now) (local.get $id1) (local.get $x) (local.get $y) (local.get $r)
					(local.get $jagged) (local.get $sub) (local.get $clan_ref) (local.get $rgb)
					(local.get $skin_ref) (local.get $name_ref))
				drop

				;; continue
				br $loop2
			end

			;; $alpha = $cell.xyr_alpha($cell_ptr, $now, $draw_delay)
			(local.set $alpha
				(call $cell.xyr_alpha (local.get $cell_ptr) (local.get $now) (local.get $draw_delay)))
			;; $inv_alpha = 1 - $alpha
			(local.set $inv_alpha
				(f64.sub (f64.const 1) (local.get $alpha)))

			;; cell.ox += (cell.nx - cell.ox) * alpha
			;; OR cell.ox = cell.ox * inv_alpha + cell.nx * alpha
			(f64.store offset=0x08 (local.get $cell_ptr)
				(f64.add
					(f64.mul
						(f64.load offset=0x08 (local.get $cell_ptr))
						(local.get $inv_alpha))
					(f64.mul
						(f64.load offset=0x28 (local.get $cell_ptr))
						(local.get $alpha))))

			;; cell.oy = cell.oy * inv_alpha + cell.ny * alpha
			(f64.store offset=0x10 (local.get $cell_ptr)
				(f64.add
					(f64.mul
						(f64.load offset=0x10 (local.get $cell_ptr))
						(local.get $inv_alpha))
					(f64.mul
						(f64.load offset=0x30 (local.get $cell_ptr))
						(local.get $alpha))))

			;; cell.or = cell.or * inv_alpha + cell.nr * alpha
			(f64.store offset=0x18 (local.get $cell_ptr)
				(f64.add
					(f64.mul
						(f64.load offset=0x18 (local.get $cell_ptr))
						(local.get $inv_alpha))
					(f64.mul
						(f64.load offset=0x38 (local.get $cell_ptr))
						(local.get $alpha))))

			;; cell.jr = r
			(f64.store offset=0x20 (local.get $cell_ptr)
				(local.get $r))

			;; cell.nx = x
			(f64.store offset=0x28 (local.get $cell_ptr) (local.get $x))
			;; cell.ny = y
			(f64.store offset=0x30 (local.get $cell_ptr) (local.get $y))
			;; cell.nr = r
			(f64.store offset=0x38 (local.get $cell_ptr) (local.get $r))

			;; cell.updated = now
			(f64.store offset=0x40 (local.get $cell_ptr) (local.get $now))

			;; cell.clan_ref = clan_ref
			(i32.store offset=0x64 (local.get $cell_ptr) (local.get $clan_ref))

			;; if flags & 0x02
			(i32.and (local.get $flags) (i32.const 0x02))
			if
				;; cell.rgb = rgb
				(i32.store offset=0x04 (local.get $cell_ptr) (local.get $rgb))
			end

			;; if flags & 0x04:
			(i32.and (local.get $flags) (i32.const 0x04))
			if
				;; cell.name_ref = name_ref
				(i32.store offset=0x5c (local.get $cell_ptr) (local.get $name_ref))
			end

			;; if flags & 0x08:
			(i32.and (local.get $flags) (i32.const 0x08))
			if
				;; cell.skin_ref = skin_ref
				(i32.store offset=0x60 (local.get $cell_ptr) (local.get $skin_ref))
			end

			;; TODO: jagged, sub, all the other properties if they change

			;; continue
			br $loop2
		end end

		;; #3: deletes (TODO)
		;; $count = read u16 at $o
		(local.set $count
			(i32.load16_u (local.get $o)))
		;; $o += 2
		(local.set $o (i32.add (local.get $o) (i32.const 2)))
		block $block3 loop $loop3
			;; if $count == 0: break
			(i32.eqz (local.get $count))
			br_if $block3

			;; $count -= 1
			(local.set $count (i32.sub (local.get $count) (i32.const 1)))

			;; $id1 = read u32 at $o
			(local.set $id1
				(i32.load (local.get $o)))
			;; $o += 4
			(local.set $o (i32.add (local.get $o) (i32.const 4)))

			;; $cell_ptr = $cell.by_id($tab, $id1, yes is pellet)
			(local.set $cell_ptr
				(call $cell.by_id (local.get $tab) (local.get $id1) (i32.const 1)))
			;; if $cell_ptr == 0:
			(i32.eqz (local.get $cell_ptr))
			if
				;; $cell_ptr = $cell.by_id($tab, $id1, not a pellet)
				(local.set $cell_ptr
					(call $cell.by_id (local.get $tab) (local.get $id1) (i32.const 0)))
				;; if $cell_ptr == 0: continue
				(i32.eqz (local.get $cell_ptr))
				br_if $loop3
			end

			;; cell.dead_at = $now
			(f64.store offset=0x50 (local.get $cell_ptr) (local.get $now))
			;; cell.updated = $now
			(f64.store offset=0x40 (local.get $cell_ptr) (local.get $now))

			br $loop3
		end end

		;; return o
		local.get $o
	)
)