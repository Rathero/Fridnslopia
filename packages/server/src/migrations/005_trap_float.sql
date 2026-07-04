-- 3D trap slots use floating-point coordinates (lateral lane x, position z),
-- unlike the 2D tile grid. Widen the trap slot columns from int to double.
alter table traps alter column slot_x type double precision;
alter table traps alter column slot_y type double precision;
